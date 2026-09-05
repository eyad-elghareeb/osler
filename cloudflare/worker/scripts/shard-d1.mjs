#!/usr/bin/env node
// scripts/shard-d1.mjs — setup + user assignment migration for the sharded
// sync pool (see wrangler.toml "Optional D1 shards").
//
// Layout: progress_documents is partitioned USER-BY-USER across up to six
// numbered sync databases (each with its own free-tier 500 MB ceiling —
// ~2.5 GB usable for sync); users.sync_shard on the core database names the
// owner, assigned deterministically by hash of the user id. Telemetry keeps
// its own database. Read/write row quotas stay account-wide.
//
// Steps:
//   1. create osler-sync-1..6 + osler-telemetry — shard names come from the
//      template section in wrangler.toml, so instances can rename them
//   2. activate the shard bindings in wrangler.toml with real IDs
//   3. apply migrations to every shard + telemetry
//   4. core backfill: users.sync_shard = hash(user.id) for every user whose
//      mapping is still NULL (run `npm run db:migrate` FIRST — it adds the
//      users.sync_shard column)
//   5. data migration: copy each user's progress_documents rows from the
//      legacy single sync database (auto-detected by name, e.g. osler-sync)
//      into their assigned shard — skipped when no legacy database exists
//   6. verify per-user row counts on both sides
//   7. --prune: delete the migrated rows from the legacy database (run AFTER
//      the sharded worker is deployed and verified)
//
// Safe to run while an OLD worker is still deployed: it only adds rows to
// the new shards and fills the mapping column — the legacy database keeps
// serving the old worker until cutover. Fully idempotent: a user whose
// shard already holds at least their legacy row count is skipped (the new
// worker is authoritative there); --force re-copies those users anyway.
//
// Usage (from cloudflare/worker):  npm run db:shard [-- --prune] [-- --force]

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const configFile = join(workerDir, "wrangler.toml");
const BEGIN = "# ── BEGIN optional D1 shards";
const END = "# ── END optional D1 shards";
const SYNC_SHARD_COUNT = 6;

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

/** JSON result of a `wrangler --json` call (both `d1 list` and `d1 execute`
 *  print a top-level array); tolerates banner lines before the JSON. */
function d1Json(out) {
  return JSON.parse(out.slice(out.indexOf("[")));
}

function countOf(database, table, where = "") {
  return Number(d1Json(wrangler(["d1", "execute", database, "--remote", "--json", "--command", `SELECT COUNT(*) AS n FROM ${table}${where}`]))[0]?.results?.[0]?.n ?? 0);
}

function sqlString(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Deterministic user→shard assignment (djb2). MUST stay in sync with
 *  syncShardForUserId in src/index.ts — both decide where rows live. */
function syncShardForUserId(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return (h % SYNC_SHARD_COUNT) + 1;
}

const config = readFileSync(configFile, "utf8");
// Core database name comes from the primary binding, so instances with a
// renamed core still derive the right shard names.
const CORE_DB = config.match(/binding = "DB"\s*\r?\n\s*database_name = "([^"]+)"/)?.[1] ?? "osler-cloud";
// Shard names come from the (commented) template blocks, so instances can
// rename them before running this script.
const shardName = (n) =>
  config.match(new RegExp(`#\\s*binding = "DB_SYNC_${n}"\\s*\\r?\\n#\\s*database_name = "([^"]+)"`))?.[1]
  ?? `${CORE_DB.replace(/-cloud$/, "")}-sync-${n}`;
const TELEMETRY_DB = config.match(/#\s*binding = "DB_TELEMETRY"\s*\r?\n#\s*database_name = "([^"]+)"/)?.[1] ?? "osler-telemetry";
const SHARDS = Array.from({ length: SYNC_SHARD_COUNT }, (_v, i) => ({
  binding: `DB_SYNC_${i + 1}`,
  database: shardName(i + 1),
  migrationsDir: "migrations-sync",
}));

console.log("── 1/6 · Ensuring shard databases exist");
const listed = JSON.parse(wrangler(["d1", "list", "--json"]));
for (const shard of SHARDS) {
  if (listed.some((db) => db.name === shard.database)) {
    console.log(`   ${shard.database} exists`);
  } else {
    console.log(`   creating ${shard.database}…`);
    wrangler(["d1", "create", shard.database]);
  }
}
if (!listed.some((db) => db.name === TELEMETRY_DB)) {
  console.log(`   creating ${TELEMETRY_DB}…`);
  wrangler(["d1", "create", TELEMETRY_DB]);
}
const ids = Object.fromEntries(
  JSON.parse(wrangler(["d1", "list", "--json"])).map((db) => [db.name, db.uuid]),
);
const allNames = SHARDS.map((s) => s.database).concat(TELEMETRY_DB, CORE_DB);
for (const name of allNames) {
  if (!ids[name]) throw new Error(`${name} not found after create/list`);
}
// Two bindings pointing at the same physical database would report multiplied
// storage headroom while everything still shares one 500 MB file.
if (new Set(allNames.map((n) => ids[n])).size !== allNames.length) {
  throw new Error("duplicate database id across bindings — each binding must point at its own database");
}

console.log("── 2/6 · Activating shard bindings in wrangler.toml");
let configOut = config;
// d1 commands resolve databases through wrangler.toml, so a primary binding
// still holding the committed placeholder would break later steps. Fill it
// in from the account — real IDs are never overwritten.
if (configOut.includes(`database_id = "REPLACE_WITH_D1_DATABASE_ID"`)) {
  configOut = configOut.replace(`database_id = "REPLACE_WITH_D1_DATABASE_ID"`, `database_id = "${ids[CORE_DB]}"`);
  console.log(`   filled in primary ${CORE_DB} id (${ids[CORE_DB]})`);
}
const beginAt = configOut.indexOf(BEGIN);
const endAt = configOut.indexOf(END);
if (beginAt < 0 || endAt < 0) throw new Error("wrangler.toml shard markers not found — restore the template block from git");
const activeBlocks = `# Account-specific database IDs. Re-run \`npm run db:shard\` to re-migrate users (--force) or prune the legacy copies (--prune).
` + SHARDS.map((s) => `[[d1_databases]]
binding = "${s.binding}"
database_name = "${s.database}"
database_id = "${ids[s.database]}"
migrations_dir = "${s.migrationsDir}"`).join("\n\n") + `

[[d1_databases]]
binding = "DB_TELEMETRY"
database_name = "${TELEMETRY_DB}"
database_id = "${ids[TELEMETRY_DB]}"
migrations_dir = "migrations-telemetry"`;
configOut = configOut.slice(0, beginAt) + BEGIN + "\n"
  + SHARDS.map((s) => `# ${s.binding} → ${s.database}`).join("\n") + "\n"
  + activeBlocks + "\n"
  + configOut.slice(endAt);
writeFileSync(configFile, configOut);
console.log("   wrangler.toml updated");

console.log("── 3/6 · Applying shard migrations (remote)");
for (const database of [...SHARDS.map((s) => s.database), TELEMETRY_DB]) {
  console.log(`   ${database}:`);
  console.log(wrangler(["d1", "migrations", "apply", database, "--remote"]).trim());
}

console.log("── 4/6 · Backfilling users.sync_shard in the core database");
try {
  d1Json(wrangler(["d1", "execute", CORE_DB, "--remote", "--json", "--command", "SELECT sync_shard FROM users LIMIT 1"]));
} catch {
  throw new Error("users.sync_shard is missing — run `npm run db:migrate` (migration 0003) before this script");
}
const unassigned = d1Json(wrangler(["d1", "execute", CORE_DB, "--remote", "--json", "--command", "SELECT id FROM users WHERE sync_shard IS NULL"]))[0]?.results ?? [];
if (unassigned.length) {
  for (let i = 0; i < unassigned.length; i += 50) {
    const sql = unassigned.slice(i, i + 50)
      .map((u) => `UPDATE users SET sync_shard = ${syncShardForUserId(u.id)} WHERE id = ${sqlString(u.id)}`)
      .join("; ");
    wrangler(["d1", "execute", CORE_DB, "--remote", "--yes", "--command", sql]);
  }
  console.log(`   assigned ${unassigned.length} user(s) by id hash`);
} else {
  console.log("   every user already assigned");
}
// User→shard map as of right now — the copy + verify steps depend on it.
const userShards = new Map(
  d1Json(wrangler(["d1", "execute", CORE_DB, "--remote", "--json", "--command", "SELECT id, sync_shard FROM users"]))[0]?.results
    .map((u) => [u.id, Number(u.sync_shard) || 1]) ?? [],
);

console.log("── 5/6 · Migrating per-user rows from the legacy sync database");
// The pre-pool single sync database keeps its name (e.g. osler-sync); it is
// only a migration source — fresh installs don't have one and skip this.
const legacyName = listed.some((db) => db.name === "osler-sync") ? "osler-sync" : null;
const tmpDir = mkdtempSync(join(tmpdir(), "osler-shard-"));
try {
  if (!legacyName) {
    console.log("   no legacy single sync database — nothing to migrate");
  } else {
    const legacyTotal = countOf(legacyName, "progress_documents");
    console.log(`   legacy ${legacyName}: ${legacyTotal} row(s)`);
    if (legacyTotal > 0) {
      const rows = d1Json(wrangler(["d1", "execute", legacyName, "--remote", "--json", "--command",
        "SELECT user_id, kind, payload, compressed, raw_bytes, updated_at FROM progress_documents"]))[0]?.results ?? [];
      const legacyByUser = new Map();
      for (const row of rows) {
        if (!legacyByUser.has(row.user_id)) legacyByUser.set(row.user_id, []);
        legacyByUser.get(row.user_id).push(row);
      }
      let moved = 0, skipped = 0;
      for (const [userId, userRows] of legacyByUser) {
        const shard = userShards.get(userId) ?? syncShardForUserId(userId);
        const target = SHARDS[shard - 1].database;
        // A shard already holding >= the legacy count for this user is
        // authoritative (the new worker writes there after cutover, and the
        // first migration pass copied these rows) — never re-insert blindly,
        // or the re-run dies on the (user_id, kind) primary key.
        const got = countOf(target, "progress_documents", ` WHERE user_id = ${sqlString(userId)}`);
        if (got >= userRows.length && !force) { skipped += userRows.length; continue; }
        if (got > 0 || force) {
          wrangler(["d1", "execute", target, "--remote", "--yes", "--command",
            `DELETE FROM progress_documents WHERE user_id = ${sqlString(userId)}`]);
        }
        const dumpFile = join(tmpDir, `user-${shard}-${sqlString(userId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}.sql`);
        writeFileSync(dumpFile, userRows.map((r) =>
          `INSERT INTO progress_documents (user_id, kind, payload, compressed, raw_bytes, updated_at) VALUES (${sqlString(r.user_id)}, ${sqlString(r.kind)}, ${sqlString(r.payload)}, ${Number(r.compressed) || 0}, ${Number(r.raw_bytes) || 0}, ${Number(r.updated_at) || 0});`,
        ).join("\n") + "\n");
        wrangler(["d1", "execute", target, "--remote", "--yes", "--file", dumpFile]);
        moved += userRows.length;
      }
      console.log(`   moved ${moved} row(s) into their shards, skipped ${skipped} (already migrated or owned by the new worker)`);
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log("── 6/6 · Verifying per-user row parity");
let verified = true;
if (legacyName) {
  const legacyUsers = d1Json(wrangler(["d1", "execute", legacyName, "--remote", "--json", "--command", "SELECT user_id, COUNT(*) AS n FROM progress_documents GROUP BY user_id"]))[0]?.results ?? [];
  for (const lu of legacyUsers) {
    const target = SHARDS[(userShards.get(lu.user_id) ?? 1) - 1]?.database;
    if (!target) { console.log(`   user ${String(lu.user_id).slice(0, 8)}…: no shard — ✗ MISMATCH`); verified = false; continue; }
    const got = countOf(target, "progress_documents", ` WHERE user_id = ${sqlString(lu.user_id)}`);
    const ok = got >= Number(lu.n);
    verified &&= ok;
    console.log(`   user ${String(lu.user_id).slice(0, 8)}… → ${target}: legacy=${lu.n} shard=${got}  ${ok ? "✓" : "✗ MISMATCH"}`);
  }
  if (verified) console.log(`   all ${legacyUsers.length} user(s) verified`);
} else {
  console.log("   no legacy database — nothing to verify");
}
if (!verified) {
  console.error("\nVerification failed — do NOT deploy the sharded bindings. Investigate and re-run.");
  process.exit(1);
}

if (prune) {
  if (!verified) throw new Error("refusing to prune unverified copies");
  if (legacyName) {
    console.log(`── Pruning migrated rows from ${legacyName} (--prune)`);
    wrangler(["d1", "execute", legacyName, "--remote", "--yes", "--command", "DELETE FROM progress_documents"]);
    console.log("   done. The legacy database is now empty and can be deleted once you are satisfied:");
    console.log(`     npx wrangler d1 delete ${legacyName} --skip-confirmation`);
  } else {
    console.log("── --prune: no legacy database, nothing to prune");
  }
} else {
  console.log(`
NEXT STEPS
  1. Review wrangler.toml, then deploy the sharded worker:
       npm run deploy
  2. Verify the app (login, sync, admin → Analytics), then drop the legacy
     copies:
       npm run db:shard -- --prune
     (Writes from the OLD worker landed in the legacy database until cutover;
     the verification above fails the prune if any are unaccounted for.)`);
}
