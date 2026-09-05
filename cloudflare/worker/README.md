# Osler Cloud Worker

This Worker provides optional email/password & Google accounts, role-ready authorization (`student` | `content_admin` | `admin`), password reset, account management (profile updates, password changes, data export, account deletion), admin API (user & R2-backed content management with draft/pending/published workflow + audit log + session management), and local-first QBank & flashcard sync. It runs entirely on Cloudflare's free tier (Workers + D1 + R2).

For the **full HTTP API reference**, see [`../../docs/api-reference.md`](../../docs/api-reference.md). For the **security model and hardening notes**, see [`../../docs/security.md`](../../docs/security.md). For **deployment options** (Cloudflare, Vercel, Docker, VPS), see [`../../docs/hosting.md`](../../docs/hosting.md).

## Deployment Steps

### Method 1: Automated Deploy via Tauri Admin

Deploy directly from **Tauri Admin** → **Deploy** tab. Choosing Cloudflare automatically deploys **everything** (Pages site + Worker backend).

### Method 2: Manual CLI Deploy

```bash
npm install
cp .env.example .dev.vars         # edit .dev.vars with your secrets

# 1. Create the D1 database
npx wrangler d1 create osler-cloud
# Paste the returned database_id into wrangler.toml

# 2. Set the JWT secret (and other secrets as needed)
npx wrangler secret put JWT_SECRET

# 3. (Optional) Configure Google Sign-In
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Set WORKER_URL in wrangler.toml to the deployed Worker URL

# 4. (Optional) Configure password reset email via Resend
npx wrangler secret put RESEND_API_KEY
# Set EMAIL_FROM and APP_ORIGIN in wrangler.toml

# 5. (Optional) Configure Turnstile anti-bot
npx wrangler secret put TURNSTILE_SECRET_KEY
# Set TURNSTILE_ENABLED="true" in wrangler.toml

# 6. Apply the D1 schema (single consolidated migration)
npm run db:migrate

# 7. Deploy
npm run deploy
```

After deployment:

- Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact Osler web app origin.
- Set `public/osler.config.json` -> `cloud.apiUrl` to the deployed Worker URL.
- (Optional) Create an R2 bucket: `npx wrangler r2 bucket create osler-content`. The `[[r2_buckets]]` binding is already in `wrangler.toml`.
- **Upgrading an existing deployment:** run `npm run db:migrate` again — migration `0002_daily_counters.sql` adds the per-day telemetry counters (safe, additive).

## Free-tier capacity (~1000 MAU)

The worker is sized so ~1000 monthly-active users stay comfortably inside every Cloudflare free-tier limit. Realistic peak mix (~300 DAU, exam-season spike ~600):

| Resource | Free limit | Expected peak usage | Why it holds |
| --- | --- | --- | --- |
| Worker requests | 100K/day | ~10–20K/day | Client sync is opt-in and event-driven: pushes are 1 direct PUT (no HEAD), poke pulls GET only the changed kinds, foreground pulls are throttled to one per 60s, hidden tabs make zero requests. Telemetry batches up to 50 events per POST and samples successful `api_call` events. |
| D1 rows written | 100K/day (account-wide) | ~15–35K/day | Analytics ≤ 10K (daily cap enforces it), choice stats ≤ 25K (daily cap), sync writes ride inside `progress_documents` upserts (~1 row per changed kind per push). |
| D1 rows read | 5M/day | < 200K/day | Daily-cap guards are 1-row point reads on `daily_counters` (never a table scan); sync reads are per-user doc lookups; realtime heartbeats are answered at the edge and never wake the D1. |
| D1 storage | 500 MB/database | < 1GB | Sync docs are gzip-compressed with a 15MB/user budget; analytics events are pruned after 30 days. The optional 3-database shard (see "D1 sharding") triples the ceiling. |
| Durable Objects (sync hub) | SQLite-backed free tier | 1 DO per active user, socket open only while the tab is visible | Heartbeats use `setWebSocketAutoResponse` at the edge — they don't wake or bill the DO. |

The two telemetry daily caps (`ANALYTICS_DAILY_WRITE_CAP`, `QBANK_STATS_DAILY_WRITE_CAP`) act as the safety valve: under an abnormal flood they return 429 to telemetry only — auth, sync, and content keep working.

## D1 sharding (optional)

The D1 free tier allows **500 MB of storage per database**, while the read/write row quotas (5M reads / 100K writes per day) are **account-wide** — splitting into multiple databases multiplies only the storage ceiling. Sharding by data domain does exactly that, isolating the table most likely to fill up fastest from the tables users care about protecting:

| Binding | Database | Tables | Why |
| --- | --- | --- | --- |
| `DB` (core) | `osler-cloud` | users, sessions, content_objects, admin_audit, … | small, slow-growing |
| `DB_SYNC` | `osler-sync` | `progress_documents` | per-user payloads, protected from telemetry churn |
| `DB_TELEMETRY` | `osler-telemetry` | `analytics_events`, `question_choice_*`, `daily_counters` | highest-volume, most disposable |

Shard bindings are optional: without them the worker keeps every table in the primary database and behaves exactly as before. To enable them:

```sh
npm run db:shard              # creates the shard DBs, fills wrangler.toml IDs,
                              # applies their migrations, copies + verifies data
npm run deploy                # deploy the sharded worker
npm run db:shard -- --prune   # after verifying the app, drop the copied rows
                              # from the primary database
```

The ID changes to wrangler.toml stay local (git keeps placeholders, same as the primary database ID). Shard schema lives in `migrations-sync/` and `migrations-telemetry/`; future changes there are applied with `npx wrangler d1 migrations apply osler-sync --remote` (and `osler-telemetry`).

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run the worker locally with `wrangler dev` (defaults to `http://localhost:8787`). |
| `npm run seed-admin` | Seed an admin user into the local D1 database (`npx tsx seed-admin.ts`). |
| `npm run deploy` | Deploy to Cloudflare Workers (production). |
| `npm run db:migrate` | Apply pending D1 migrations to the remote database. |
| `npm run db:migrate:local` | Apply pending D1 migrations to the local dev database. |
| `npm run db:list` | List applied and pending migrations. |
| `npm run db:shard` | One-time optional D1 shard setup: create + wire + migrate + copy + verify (see "D1 sharding"). |
| `npm run tail` | Tail live logs from the deployed Worker (`wrangler tail`). |
| `npm run secret:list` | List configured Worker secrets (names only, not values). |

## File Layout

```
cloudflare/worker/
├── src/
│   └── index.mjs              # Worker entry point (single file, zero deps)
├── migrations/
│   └── 0001_schema.sql        # consolidated schema: users, sessions, sync docs, OAuth, content_objects, admin_audit, FTS, analytics, lockout, tickets, tokens, MCP OAuth (replaces the old 0001-0025 chain)
├── migrations-sync/
│   └── 0001_schema.sql        # optional sync shard: progress_documents (applied by `npm run db:shard`)
├── migrations-telemetry/
│   └── 0001_schema.sql        # optional telemetry shard: analytics + choice stats + daily_counters
├── scripts/
│   └── shard-d1.mjs           # one-time optional shard setup + data migration
├── .dev.vars.example          # local secrets template (gitignored)
├── .env.example               # documentation reference for env vars
├── package.json
├── wrangler.toml              # Workers + D1 + R2 + cron config
└── README.md                  # this file
```

## Quick Health Check

After deploy, verify the worker is reachable:

```bash
curl https://<your-worker-domain>/v1/health
# → { "ok": true, "googleEnabled": true|false, "turnstileEnabled": true|false }
```

## Operational Notes

- **Cron trigger**: `[triggers] crons = ["0 * * * *"]` runs hourly to prune expired sessions, OAuth states, handoffs, reset tokens, and audit-log entries older than 1 year.
- **Session cap**: 12 concurrent sessions per user. The oldest is revoked when a 13th is issued.
- **Rate limit**: 12 logins / 6 registrations / 6 resets / 12 google-consume / 600 admin per IP per minute; global per-IP cap of 600 across all rate-limited routes. Returns HTTP 429 when exceeded. For harder guarantees, front the Worker with Cloudflare Rate Limiting Rules.
- **Audit retention**: 1 year. Tune `AUDIT_RETENTION_MS` in `src/index.ts` if your jurisdiction requires a different window.
- **R2 not configured**: Admin content endpoints return HTTP 503 with `{error: "Content storage not configured"}` until the R2 bucket binding is added.

See [`../../docs/cloudflare-backend.md`](../../docs/cloudflare-backend.md) for the full deployment guide and [`../../docs/api-reference.md`](../../docs/api-reference.md) for the complete API reference.
