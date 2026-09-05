#!/usr/bin/env node
// scripts/shard-d1.mjs — one-time setup + data migration for the optional
// D1 shards (see wrangler.toml "Optional D1 shards").
//
// Free-tier D1 gives 500 MB of storage PER DATABASE; read/write row quotas
// are account-wide. Sharding multiplies only the storage ceiling:
//   osler-sync      ← progress_documents            (DB_SYNC)
//   osler-telemetry ← analytics_events, question_choice_stats,
//                     question_choice_respondents   (DB_TELEMETRY)
//
// What it does, in order:
//   1. creates osler-sync + osler-telemetry (skips ones that already exist)
//   2. uncomments the shard blocks in wrangler.toml and fills in real IDs
//   3. applies migrations-sync/ + migrations-telemetry/ to the remote shards
//   4. exports each table from the primary DB and imports it into its shard
//   5. verifies row counts on both sides
//   6. with --prune: deletes the copied tables' rows from the primary DB
//      (run AFTER the sharded worker is deployed and verified — the worker
//      must already be writing to the shards when this happens)
//
// Idempotent: safe to re-run up to the copy step; re-copying over a shard
// that already holds rows requires --force (it deletes target rows first).
//
// Usage (from cloudflare/worker):  npm run db:shard [-- --prune] [-- --force]

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const configFile = join(workerDir, "wrangler.toml");
const CORE_DB = "osler-cloud";
const SHARDS = [
  { binding: "DB_SYNC", database: "osler-sync", migrationsDir: "migrations-sync", tables: ["progress_documents"] },
  { binding: "DB_TELEMETRY", database: "osler-telemetry", migrationsDir: "migrations-telemetry", tables: ["analytics_events", "question_choice_stats", "question_choice_respondents"] },
];
const BEGIN = "# ── BEGIN optional D1 shards";
const END = "# ── END optional D1 shards";

const prune = process.argv.includes("--prune");
const force = process.argv.includes("--force");

function wrangler(args, opts = {}) {
  const bin = join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js");
  const cmd = existsSync(bin) ? process.execPath : "npx";
  const argv = existsSync(bin) ? [bin, ...args] : ["wrangler", ...args];
  const res = spawnSync(cmd, argv, { cwd: workerDir, encoding: "utf8", input: "y\n", shell: !existsSync(bin), ...opts });
  if (res.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

function countOf(database, table) {
  const out = wrangler(["d1", "execute", database, "--remote", "--json", "--command", `SELECT COUNT(*) AS n FROM ${table}`]);
  const rows = JSON.parse(out.slice(out.indexOf("[")));
  return Number(rows[0]?.results?.[0]?.n ?? 0);
}

console.log("── 1/5 · Ensuring shard databases exist");
const listed = JSON.parse(wrangler(["d1", "list", "--json"]));
for (const shard of SHARDS) {
  if (listed.some((db) => db.name === shard.database)) {
    console.log(`   ${shard.database} exists`);
  } else {
    console.log(`   creating ${shard.database}…`);
    wrangler(["d1", "create", shard.database]);
  }
}
const ids = Object.fromEntries(
  JSON.parse(wrangler(["d1", "list", "--json"])).map((db) => [db.name, db.uuid]),
);
for (const shard of SHARDS) {
  if (!ids[shard.database]) throw new Error(`${shard.database} not found after create/list`);
}

console.log("── 2/5 · Activating shard bindings in wrangler.toml");
const config = readFileSync(configFile, "utf8");
const beginAt = config.indexOf(BEGIN);
const endAt = config.indexOf(END);
if (beginAt < 0 || endAt < 0) throw new Error("wrangler.toml shard markers not found — restore the template block from git");
const activeBlocks = SHARDS.map((s) => `[[d1_databases]]
binding = "${s.binding}"
database_name = "${s.database}"
database_id = "${ids[s.database]}"
migrations_dir = "${s.migrationsDir}"`).join("\n\n");
const updated = config.slice(0, beginAt)
  + SHARDS.map((s) => `# ${s.binding} → ${s.tables.join(", ")}`).join("\n") + "\n"
  + activeBlocks + "\n"
  + config.slice(endAt);
writeFileSync(configFile, updated);
console.log("   wrangler.toml updated (ID changes stay local — placeholders remain in git)");

console.log("── 3/5 · Applying shard migrations (remote)");
for (const shard of SHARDS) {
  console.log(`   ${shard.database}:`);
  console.log(wrangler(["d1", "migrations", "apply", shard.database, "--remote"]).trim());
}

console.log("── 4/5 · Copying tables from the primary database");
const tmpDir = mkdtempSync(join(tmpdir(), "osler-shard-"));
try {
  for (const shard of SHARDS) {
    for (const table of shard.tables) {
      const targetCount = countOf(shard.database, table);
      if (targetCount > 0 && !force) {
        console.log(`   SKIP ${table} → ${shard.database} (target already has ${targetCount} rows; use --force to recopy)`);
        continue;
      }
      if (targetCount > 0 && force) {
        wrangler(["d1", "execute", shard.database, "--remote", "--yes", "--command", `DELETE FROM ${table}`]);
      }
      const dumpFile = join(tmpDir, `${table}.sql`);
      console.log(`   exporting ${CORE_DB}.${table}…`);
      wrangler(["d1", "export", CORE_DB, "--remote", "--table", table, "--output", dumpFile]);
      // The dump may carry DDL; the shard schema already exists via
      // migrations, so keep only the INSERT statements.
      const inserts = readFileSync(dumpFile, "utf8")
        .split("\n")
        .filter((line) => /^INSERT INTO/i.test(line))
        .join("\n");
      const sourceCount = countOf(CORE_DB, table);
      if (!inserts) {
        console.log(`   ${table}: source has ${sourceCount} rows, nothing to copy`);
        continue;
      }
      writeFileSync(dumpFile, inserts + "\n");
      console.log(`   importing ${sourceCount} rows → ${shard.database}.${table}…`);
      wrangler(["d1", "execute", shard.database, "--remote", "--yes", "--file", dumpFile]);
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log("── 5/5 · Verifying row counts");
let verified = true;
for (const shard of SHARDS) {
  for (const table of shard.tables) {
    const source = countOf(CORE_DB, table);
    const target = countOf(shard.database, table);
    const ok = target >= source;
    verified &&= ok;
    console.log(`   ${table}: ${CORE_DB}=${source}  ${shard.database}=${target}  ${ok ? "✓" : "✗ MISMATCH"}`);
  }
}
if (!verified) {
  console.error("\nVerification failed — do NOT deploy the sharded bindings. Investigate and re-run.");
  process.exit(1);
}

if (prune) {
  if (!verified) throw new Error("refusing to prune unverified copies");
  const tables = SHARDS.flatMap((s) => s.tables);
  console.log(`── Pruning copied tables from ${CORE_DB} (--prune)`);
  wrangler(["d1", "execute", CORE_DB, "--remote", "--yes", "--command", tables.map((t) => `DELETE FROM ${t}`).join("; ")]);
  console.log("   done. Note: D1 storage reclaims freed pages lazily — the file shrinks as pages are reused.");
} else {
  console.log(`
NEXT STEPS
  1. Review wrangler.toml, then deploy the sharded worker:
       npm run deploy
  2. Verify the app (login, sync, admin → Analytics), then remove the
     copied tables from the primary database:
       npm run db:shard -- --prune
     (Writes that landed on the primary DB between copy and deploy would be
     lost by pruning — if the gap worries you, re-run the copy step with
     --force right before pruning.)`);
}
