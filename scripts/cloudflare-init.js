#!/usr/bin/env node
/**
 * One-command Cloudflare deployment initializer for Osler.
 *
 * Deploys BOTH layers in a single run:
 *   Layer 1 — static client-side site  → Cloudflare Pages (Next.js export)
 *   Layer 2 — server-side backend      → Cloudflare Worker (auth, D1, R2, sync)
 *
 * Idempotent: safe to re-run. It detects already-created resources (D1 DB,
 * R2 bucket, existing wrangler.toml database_id) and skips them.
 *
 * Prerequisites:
 *   1. Node 20.9+ (Next.js 16 requires it) and a Cloudflare account.
 *   2. Auth: either `npx wrangler login` once in this repo (browser flow), or
 *      set CLOUDFLARE_API_TOKEN=<token> (and optionally CLOUDFLARE_ACCOUNT_ID).
 *
 * Usage:
 *   node scripts/cloudflare-init.js \
 *     --origin https://osler.your-domain.com \
 *     [--worker-url https://osler-cloud.<acct>.workers.dev] \
 *     [--worker-name osler-cloud] \
 *     [--project osler] [--d1 osler-cloud] [--r2 osler-content] \
 *     [--env-file ./cloudflare-secrets.env] [--skip-pages] [--skip-worker]
 *
 * Flags:
 *   --origin       Production origin of the web app (CORS allowlist). Required.
 *                  Also written as site.url (public site URL) and APP_ORIGIN
 *                  (email link base) on every run.
 *   --worker-name  Deployed Worker name (wrangler.toml top-level `name`).
 *                  Change it when provisioning a second instance in the same
 *                  Cloudflare account so the two don't overwrite each other.
 *   --worker-url   Expected public Worker URL. If omitted, it is read from the
 *                  `wrangler deploy` output after the Worker is deployed. If
 *                  supplied, it must match the deployed URL exactly.
 *   --project      Cloudflare Pages project name (default "osler").
 *   --d1           D1 database name (default "osler-cloud").
 *   --r2           R2 bucket name (default "osler-content") — also bound into
 *                  the Worker's wrangler.toml CONTENT binding.
 *   --env-file     Optional file of NAME=value lines; each name is set as a
 *                  Worker secret (e.g. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *                  RESEND_API_KEY, TURNSTILE_SECRET_KEY, GEMINI_ENCRYPTION_KEY,
 *                  or a custom JWT_SECRET).
 *   --skip-build   Reuse an existing frontend `out/` directory (no `npm run build`).
 *   --skip-pages   Deploy only the Worker backend.
 *   --skip-worker  Deploy only the Pages frontend (worker must already exist —
 *                  pass --worker-url, or a usable cloud.apiUrl must already be
 *                  present in public/osler.config.json).
 *
 * After it finishes, run the printed SQL to promote your first user to admin.
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WORKER_DIR = path.join(ROOT, "cloudflare", "worker");
const WRANGLER_TOML = path.join(WORKER_DIR, "wrangler.toml");
const CONFIG_JSON = path.join(ROOT, "public", "osler.config.json");

// ── CLI flags ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { origin: null, workerUrl: null, workerName: "osler-cloud", project: "osler", d1: "osler-cloud", r2: "osler-content", envFile: null, skipBuild: false, skipPages: false, skipWorker: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    switch (a) {
      case "--origin": args.origin = val(); break;
      case "--worker-url": args.workerUrl = val(); break;
      case "--worker-name": args.workerName = val(); break;
      case "--project": args.project = val(); break;
      case "--d1": args.d1 = val(); break;
      case "--r2": args.r2 = val(); break;
      case "--env-file": args.envFile = val(); break;
      case "--skip-build": args.skipBuild = true; break;
      case "--skip-pages": args.skipPages = true; break;
      case "--skip-worker": args.skipWorker = true; break;
      default: console.error(`Unknown flag: ${a}`); process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.origin) {
  console.error("Error: --origin is required (e.g. https://osler.pages.dev)");
  process.exit(1);
}
if (!/^https?:\/\/[^\s"']+$/i.test(args.origin)) {
  console.error("Error: --origin must be a valid HTTP(S) origin without spaces or quotes.");
  process.exit(1);
}
for (const [flag, value] of [["--project", args.project], ["--d1", args.d1], ["--r2", args.r2], ["--worker-name", args.workerName]]) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(value)) {
    console.error(`Error: ${flag} must contain only letters, numbers, and hyphens.`);
    process.exit(1);
  }
}

// Next.js 16 (the frontend build) requires Node >= 20.9 — fail fast with a
// clear message instead of a cryptic `npm run build` error.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 9)) {
  console.error(`Error: Node.js >= 20.9 is required (found ${process.versions.node}). Update Node and retry.`);
  process.exit(1);
}

// --skip-worker must still resolve a usable backend URL — otherwise
// cloud.apiUrl is never written and the health check prints "undefined/...".
if (args.skipWorker && !args.workerUrl) {
  try {
    const url = JSON.parse(readFile(CONFIG_JSON))?.cloud?.apiUrl;
    if (typeof url === "string" && /^https:\/\//i.test(url)) {
      args.workerUrl = url;
      console.log(`--skip-worker: reusing cloud.apiUrl from public/osler.config.json (${url})`);
    }
  } catch { /* config missing or unreadable — fall through to the error */ }
  if (!args.workerUrl) {
    console.error("Error: --skip-worker requires --worker-url (no usable cloud.apiUrl found in public/osler.config.json).");
    process.exit(1);
  }
}

// ── Small helpers ──────────────────────────────────────────────────────
function run(cmd, { cwd = ROOT, input = null, allowFail = false, quiet = false } = {}) {
  const result = execFileSync(cmd, { cwd, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], shell: true });
  if (!quiet) process.stdout.write(result);
  return { status: 0, stdout: result };
}

function runFail(cmd, opts = {}) {
  try {
    return run(cmd, opts);
  } catch (err) {
    if (opts.allowFail) return { status: 1, stdout: err.stdout || "" };
    process.stderr.write(err.stderr || String(err));
    process.exit(1);
  }
}

function step(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

function readFile(p) { return fs.readFileSync(p, "utf8"); }
function writeFile(p, s) { fs.writeFileSync(p, s); }

function patchFile(p, replacements) {
  let text = readFile(p);
  let changed = false;
  for (const [from, to] of replacements) {
    if (text.includes(from)) { text = text.replace(from, to); changed = true; }
    else if (text.includes(to)) { /* already patched */ }
    else console.warn(`  ⚠  pattern not found in ${path.basename(p)}: ${from}`);
  }
  if (changed) writeFile(p, text);
  return changed;
}

function parseEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) { console.error(`Error: env file not found: ${p}`); process.exit(1); }
  for (const raw of readFile(p).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function ensureWorkerDeps() {
  if (fs.existsSync(path.join(WORKER_DIR, "node_modules"))) return;
  step("Installing worker dependencies");
  runFail("npm install", { cwd: WORKER_DIR });
}

function ensureFrontendDeps() {
  const nextPackage = path.join(ROOT, "node_modules", "next", "package.json");
  if (fs.existsSync(nextPackage)) return;
  step("Installing frontend dependencies");
  runFail("npm install", { cwd: ROOT });
}

function requireAuth() {
  step("Checking Cloudflare auth");
  const res = runFail("npx wrangler whoami", { cwd: ROOT, quiet: true });
  if (/not authenticated|you are not logged in/i.test(res.stdout)) {
    console.error("  ✗ Not authenticated. Run `npx wrangler login` once, or set CLOUDFLARE_API_TOKEN.");
    process.exit(1);
  }
  console.log("  ✓ authenticated");
}

// ── D1 database ────────────────────────────────────────────────────────
function ensureD1(dbName) {
  step(`Ensuring D1 database "${dbName}"`);
  const toml = readFile(WRANGLER_TOML);
  const placeholder = 'database_id = "REPLACE_WITH_D1_DATABASE_ID"';
  if (!toml.includes(placeholder)) {
    const m = toml.match(/database_id\s*=\s*"([0-9a-fA-F-]{32,})"/);
    console.log(`  ✓ already configured (${m ? m[1] : "unknown id"})`);
    return;
  }
  const stdout = runFail(`npx wrangler d1 create ${dbName}`, { cwd: WORKER_DIR, allowFail: true }).stdout;
  const id = parseD1Id(stdout);
  if (!id) {
    console.error(`  ✗ Could not parse database_id from:\n${stdout}`);
    process.exit(1);
  }
  patchFile(WRANGLER_TOML, [[placeholder, `database_id = "${id}"`]]);
  console.log(`  ✓ created database ${dbName} → ${id}`);
}

function parseD1Id(stdout) {
  try {
    const json = JSON.parse(stdout);
    const r = json.result || json;
    if (r && r.database_id) return r.database_id;
  } catch { /* fall through to regex */ }
  const m = stdout.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? m[0] : null;
}

// ── R2 bucket ──────────────────────────────────────────────────────────
function ensureR2(bucketName) {
  step(`Ensuring R2 bucket "${bucketName}"`);
  runFail(`npx wrangler r2 bucket create ${bucketName}`, { cwd: WORKER_DIR, allowFail: true });
  // The Worker binds its content bucket by name in wrangler.toml — a
  // non-default --r2 must be written there or the deploy fails (missing
  // default bucket) or the app reads from the wrong bucket.
  const text = readFile(WRANGLER_TOML);
  if (!text.includes(`bucket_name = "${bucketName}"`)) {
    writeFile(WRANGLER_TOML, text.replace(/bucket_name\s*=\s*"[^"]*"/, `bucket_name = "${bucketName}"`));
    console.log(`  ✓ CONTENT binding → bucket ${bucketName}`);
  } else {
    console.log("  ✓ bucket present");
  }
}

// ── Worker secrets ─────────────────────────────────────────────────────
function setSecret(name, value) {
  runFail(`npx wrangler secret put ${name}`, { cwd: WORKER_DIR, input: value });
  console.log(`  ✓ ${name} set`);
}

function jwtSecretExists() {
  const res = runFail("npx wrangler secret list --json", { cwd: WORKER_DIR, quiet: true, allowFail: true });
  return /"JWT_SECRET"/.test(res.stdout);
}

function ensureSecrets(envFile) {
  step("Setting Worker secrets");
  const provided = envFile ? parseEnvFile(envFile) : {};
  // Idempotency: never rotate an existing JWT_SECRET on rerun — that would
  // invalidate every active cloud session. Generate one only when the secret
  // is absent; an explicit JWT_SECRET in the env file always rotates it.
  if (provided.JWT_SECRET) {
    setSecret("JWT_SECRET", provided.JWT_SECRET);
  } else if (jwtSecretExists()) {
    console.log("  ✓ JWT_SECRET already set — left untouched (add it to the env file to rotate it)");
  } else {
    setSecret("JWT_SECRET", crypto.randomBytes(48).toString("base64"));
  }
  for (const name of Object.keys(provided)) {
    if (name === "JWT_SECRET") continue;
    setSecret(name, provided[name]);
  }
  console.log(`  ✓ ${Object.keys(provided).length} optional secret(s) from env file`);
}

// ── wrangler.toml [vars] ───────────────────────────────────────────────
function patchVars(origin, workerUrl) {
  step("Patching wrangler.toml [vars]");
  let text = readFile(WRANGLER_TOML);
  let dirty = false;
  if (/^ALLOWED_ORIGIN\s*=\s*"[^"]*"/m.test(text)) {
    text = text.replace(/^ALLOWED_ORIGIN\s*=\s*"[^"]*"/m, `ALLOWED_ORIGIN = "${origin}"`);
    dirty = true;
  }
  if (workerUrl && /^WORKER_URL\s*=\s*"[^"]*"/m.test(text)) {
    text = text.replace(/^WORKER_URL\s*=\s*"[^"]*"/m, `WORKER_URL = "${workerUrl}"`);
    dirty = true;
  }
  // APP_ORIGIN drives password-reset / email-verify links — it must follow
  // --origin on every run. The template ships it commented out, so replace
  // the commented line when present, else insert after ALLOWED_ORIGIN.
  const appOriginLine = /^#?\s*APP_ORIGIN\s*=.*$/m;
  if (appOriginLine.test(text)) {
    text = text.replace(appOriginLine, `APP_ORIGIN = "${origin}"`);
    dirty = true;
  } else {
    text = text.replace(/^ALLOWED_ORIGIN\s*=.*$/m, (m) => `${m}\nAPP_ORIGIN = "${origin}"`);
    dirty = true;
  }
  if (dirty) writeFile(WRANGLER_TOML, text);
  console.log(`  ✓ ALLOWED_ORIGIN = ${origin}\n  ✓ APP_ORIGIN = ${origin}${workerUrl ? `\n  ✓ WORKER_URL = ${workerUrl}` : ""}`);
}

// ── Migrations + deploy ────────────────────────────────────────────────
function runMigrations(dbName) {
  step("Applying D1 migrations");
  runFail(`npx wrangler d1 migrations apply ${dbName} --remote`, { cwd: WORKER_DIR });
}

function patchWorkerName(workerName) {
  const text = readFile(WRANGLER_TOML);
  const current = /^name\s*=\s*"([^"]*)"/m.exec(text)?.[1];
  if (current === workerName) return;
  writeFile(WRANGLER_TOML, text.replace(/^name\s*=\s*"[^"]*"/m, `name = "${workerName}"`));
  console.log(`  ✓ Worker name = ${workerName}`);
}

function deployWorker() {
  step("Deploying Worker backend");
  const stdout = runFail("npx wrangler deploy", { cwd: WORKER_DIR }).stdout;
  // Workers URLs carry an account subdomain: https://<name>.<acct>.workers.dev
  const m = stdout.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.workers\.dev/i);
  if (!m) {
    console.error("  ✗ Could not find the Worker URL in deploy output.");
    process.exit(1);
  }
  console.log(`  ✓ Worker live at ${m[0]}`);
  return m[0];
}

// ── Frontend (Pages) ───────────────────────────────────────────────────
function buildFrontend() {
  step("Building static site (npm run build)");
  runFail("npm run build", { cwd: ROOT });
}

function deployPages(project) {
  step(`Deploying Pages project "${project}"`);
  runFail(`npx wrangler pages project create ${project} --production-branch main`, { cwd: ROOT, allowFail: true });
  const outDir = path.join(ROOT, "out");
  if (!fs.existsSync(path.join(outDir, "index.html"))) {
    console.error("  ✗ out/index.html missing — build the site first (or drop --skip-build).");
    process.exit(1);
  }
  runFail(`npx wrangler pages deploy "${outDir}" --project-name ${project}`, { cwd: ROOT });
  console.log(`  ✓ Pages site deployed to https://${project}.pages.dev`);
}

// ── Frontend config wiring ─────────────────────────────────────────────
function patchConfig(workerUrl, siteUrl) {
  step("Patching public/osler.config.json (cloud.apiUrl, site.url)");
  let config;
  try {
    config = JSON.parse(readFile(CONFIG_JSON));
  } catch (error) {
    console.error(`  ✗ Could not parse ${CONFIG_JSON}: ${error.message}`);
    process.exit(1);
  }
  config.cloud = { ...(config.cloud || {}), enabled: true, apiUrl: workerUrl };
  config.site = { ...(config.site || {}), url: siteUrl };
  config.wizard = { ...(config.wizard || {}), completed: true, completedAt: new Date().toISOString() };
  writeFile(CONFIG_JSON, JSON.stringify(config, null, 2) + "\n");
  console.log(`  ✓ cloud.apiUrl = ${workerUrl}`);
  console.log(`  ✓ site.url = ${siteUrl}`);
}

// ── Main ───────────────────────────────────────────────────────────────
const normalizeUrl = (u) => u.replace(/\/+$/, "");

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Osler — Cloudflare full-stack deploy initializer            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`Origin: ${args.origin}   Pages: ${args.project}   D1: ${args.d1}   R2: ${args.r2}   Worker: ${args.workerName}`);

  ensureFrontendDeps();
  requireAuth();

  if (!args.skipWorker) {
    ensureWorkerDeps();
    ensureD1(args.d1);
    ensureR2(args.r2);
    ensureSecrets(args.envFile);
  }

  let workerUrl = args.workerUrl;
  if (!args.skipWorker) {
    patchWorkerName(args.workerName);
    patchVars(args.origin, args.workerUrl);
    runMigrations(args.d1);
    const deployedUrl = deployWorker();
    if (args.workerUrl && normalizeUrl(args.workerUrl) !== normalizeUrl(deployedUrl)) {
      console.error(`  ✗ --worker-url ${args.workerUrl} does not match the deployed Worker URL (${deployedUrl}).`);
      console.error("    Omit --worker-url, or pass --worker-name to deploy under a different name.");
      process.exit(1);
    }
    workerUrl = deployedUrl;
    if (!args.workerUrl) {
      patchVars(args.origin, workerUrl);
      // OAuth callbacks derive from WORKER_URL, so deploy the updated vars
      // before writing secrets or presenting the Google setup step.
      deployWorker();
    }
  }

  // site.url must be the public site origin — a custom-domain --origin must
  // not be overwritten with the <project>.pages.dev fallback.
  if (workerUrl) patchConfig(workerUrl, args.origin);

  if (!args.skipPages) {
    if (!args.skipBuild) buildFrontend();
    deployPages(args.project);
  }

  step("Deploy complete");
  console.log(`  Site:    https://${args.project}.pages.dev`);
  console.log(`  Worker:  ${workerUrl || "(worker not deployed — use --worker-url)"}`);
  console.log(`  Health:  ${workerUrl}/v1/health`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Register an account on the site, then promote it to admin:`);
  console.log(`     cd cloudflare/worker && npx wrangler d1 execute ${args.d1} --remote --command`);
  console.log(`       "UPDATE users SET role = 'admin' WHERE username = '<your-username>';"`);
  console.log(`  2. (Optional) Enable Google Sign-In / Resend / Turnstile via the env file.`);
  console.log(`  3. Verify: ${args.origin} loads, and ${workerUrl || ""}/v1/health returns {ok:true}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
