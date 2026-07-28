#!/usr/bin/env node
// Seed an admin user into the local D1 database.
// Usage: npx tsx seed-admin.ts [username] [password]
//        npm run seed-admin
// Defaults: admin / 12345678aa

import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const username = process.argv[2] || "admin";
const password = process.argv[3] || "12345678aa";
const iterations = 310_000;

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 256, "sha256");

const b64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const saltB64 = b64url(salt);
const hashB64 = b64url(hash);
const userId = crypto.randomUUID();
const now = Date.now();

const sql = `INSERT OR IGNORE INTO users (id, username, display_name, password_hash, password_salt, role, has_password, created_at, updated_at) VALUES ('${userId}', '${username}', '${username}', '${hashB64}', '${saltB64}', 'admin', 1, ${now}, ${now});`;

console.log(`Seeding admin user "${username}" into D1...`);
console.log(`SQL: ${sql}`);

try {
  execSync(
    `npx wrangler d1 execute osler-cloud --local --command="${sql.replace(/"/g, '\\"')}"`,
    { stdio: "inherit", cwd: __dirname }
  );
  console.log(`\n✓ Admin user "${username}" seeded successfully.`);
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password}`);
  console.log(`  Role:     admin`);
} catch {
  console.error("\n✗ Failed to seed admin user.");
  console.error("Make sure you're in the cloudflare/worker directory and wrangler is configured.");
  process.exit(1);
}
