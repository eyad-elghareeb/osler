#!/usr/bin/env node
// Seed an admin user into the local D1 database.
// Usage: npx tsx seed-admin.ts <username> <password>
//
// Credentials are REQUIRED arguments - a well-known default admin password
// in a public repo is an instant-takeover footgun for self-hosters. The
// password must satisfy the same policy the Worker enforces at registration
// (8+ chars, 2 character classes).

import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error("Usage: npx tsx seed-admin.ts <username> <password>");
  console.error("Both arguments are required - no defaults are provided for security reasons.");
  process.exit(1);
}

function validPassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  return classes >= 2;
}

if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
  console.error("Invalid username: 3-32 chars of [a-zA-Z0-9_.-]");
  process.exit(1);
}
if (!validPassword(password)) {
  console.error("Invalid password: at least 8 characters with 2 character classes (lowercase, uppercase, digit, symbol).");
  process.exit(1);
}

const iterations = 100_000;

// Must match the worker's deriveBits(., 256) - 256 BITS = 32 bytes.
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");

const b64url = (buf) =>
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

try {
  execSync(
    `npx wrangler d1 execute osler-cloud --local --command="${sql.replace(/"/g, '\\"')}"`,
    { stdio: "inherit", cwd: __dirname }
  );
  console.log(`\nAdmin user "${username}" seeded successfully (role: admin).`);
} catch {
  console.error("\nFailed to seed admin user.");
  console.error("Make sure you're in the cloudflare/worker directory and wrangler is configured.");
  process.exit(1);
}
