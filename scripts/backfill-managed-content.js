#!/usr/bin/env node
/**
 * Triggers the server-side batch backfill endpoint on the Cloudflare Worker
 * to adopt all raw files in content-files/ into managed content_objects.
 *
 * Usage:
 *   node scripts/backfill-managed-content.js [api_url] [admin_user] [admin_pass]
 */

const API = (process.argv[2] || process.env.CLOUD_API_URL || "http://localhost:8787").replace(/\/$/, "");
// Credentials are required - no defaults. A predictable admin pair in a
// public repo is a credential-stuffing hint and a self-hosting footgun.
const USERNAME = process.argv[3] || process.env.OSLER_ADMIN_USER;
const PASSWORD = process.argv[4] || process.env.OSLER_ADMIN_PASS;

if (!USERNAME || !PASSWORD) {
  console.error("Usage: node scripts/backfill-managed-content.js [api_url] <admin_user> <admin_pass>");
  console.error("Credentials are required (argv or OSLER_ADMIN_USER / OSLER_ADMIN_PASS).");
  process.exit(1);
}

async function main() {
  console.log(`\n📦 Backfilling raw content into managed objects on ${API}...`);

  // 1. Log in
  const loginRes = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: USERNAME, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    console.error(`❌ Login failed (${loginRes.status}):`, await loginRes.text());
    process.exit(1);
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log(`✓ Authenticated as ${loginData.user.username} (${loginData.user.role})`);

  // 2. Trigger backfill
  const backfillRes = await fetch(`${API}/v1/admin/content/backfill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!backfillRes.ok) {
    console.error(`❌ Backfill failed (${backfillRes.status}):`, await backfillRes.text());
    process.exit(1);
  }

  const result = await backfillRes.json();
  console.log(`\n✨ Backfill complete!`);
  console.log(`   - Newly backfilled: ${result.backfilled}`);
  console.log(`   - Already registered: ${result.existing}`);
  console.log(`   - Total managed objects: ${result.total}`);

  if (result.errors && result.errors.length > 0) {
    console.log(`\n⚠️  Warnings (${result.errors.length}):`);
    for (const err of result.errors) console.log(`   ${err}`);
  }
}

main().catch(console.error);
