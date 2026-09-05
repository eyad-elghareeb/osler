# Cloudflare quota panel — wiring & connect guide

Admin → Analytics → **Cloudflare Free Tier** watches the quotas that can take
the instance down: Workers requests, D1 row reads/writes + storage, R2 storage
+ Class A/B ops, CPU time, and subrequests. It is served by one endpoint:

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/admin/analytics/cloudflare-limits` | Session (`admin`) | Quota snapshot: metrics, internal caps, D1 table breakdown, safety throttles, plus `connected` / `sources` provenance (see below). |

## Estimated vs live

Out of the box the endpoint serves **estimates** derived from D1 tables. Set
two values on the Worker (next section) and the billed sections flip to **live**
numbers from Cloudflare's GraphQL Analytics API — the same datasets the
Cloudflare dashboard reads. Each section degrades independently: if one live
query fails, that section falls back to its estimate and the rest stay live.

| Metric | Estimated (no token) | Live (token configured) |
| --- | --- | --- |
| Workers requests/day | Heuristic: `analytics batches × 2`, `sessions × 5` | `workersInvocationsAdaptive` sum, account-level, since UTC midnight |
| Worker CPU p50 | Shown as client-measured API latency, **never** percented against the 10 ms limit (any real RTT would false-alarm) | `workersInvocationsAdaptive` CPU p50 (reported in µs, converted to ms) vs the 10 ms limit |
| D1 row writes/day | Today's `analytics_events` + `admin_audit` + `sessions` rows + 15% headroom | Still estimated — D1 row metering has no confirmed per-database usage schema; use Workers & Pages → D1 → Metrics for the billed number |
| D1 row reads/day | Heuristic from telemetry volume | Still estimated (same reason) |
| D1 storage | Real row counts × per-table byte estimates vs the **500 MB per-database** free limit | Same (row counts are real; byte sizes are estimates) |
| R2 storage | `list()` byte sum → content-object estimate | GraphQL storage gauge → `CONTENT.list()` byte sum → estimate |
| R2 Class A/B ops/month | Heuristic from content/admin activity | `r2OperationsAdaptiveGroups` grouped by action type (see mapping) |
| Subrequests | Design bound (≤ 40 per run of the 50 cap) | Same — bounded in code, not measured |

The response carries `connected: boolean` (true when ≥ 1 section is live),
`liveAt` (isolated cache timestamp), and a per-metric `sources` map
(`"live" | "estimated"`). The panel renders a **Live · Cloudflare API** badge
when connected, otherwise an **Estimated** badge plus the 3-step connect box.
Live payloads are cached in-isolate for 5 minutes.

## How to connect it

Prerequisites: a Cloudflare account holding the Worker, D1 database, and R2
bucket (normally all three — the standard deploy).

**1. Copy your Account ID.**
Cloudflare dashboard sidebar (or the account URL) → 32 hex characters.

**2. Create an API token with exactly one permission.**
My Profile → API Tokens → Create Token → Custom token:
- Permissions: **Account → Account Analytics → Read**
- No zone permissions, no write access. A read-only analytics token cannot
  change anything even if leaked; rotate it like any secret if exposed.

**3. Attach it to the Worker and redeploy.**
```sh
cd cloudflare/worker
# Account + bucket scope (plain vars — edit wrangler.toml or pass --var):
#   CF_ACCOUNT_ID = "00000000000000000000000000000000"
#   CF_R2_BUCKET  = "osler-content"   # defaults to osler-content if omitted
# Token (SECRET — never commit it, never put it in wrangler.toml):
npx wrangler secret put CF_ANALYTICS_TOKEN
npx wrangler deploy
```
Local dev: put the same three keys in `cloudflare/worker/.dev.vars`
(see `.dev.vars.example`).

**4. Verify.** Open Admin → Analytics → Cloudflare section: the badge flips to
**Live**. Or curl it with an admin session:
```sh
curl -s -H "Authorization: Bearer <admin-session-token>" \
  https://<worker>/v1/admin/analytics/cloudflare-limits | jq '{connected, sources}'
```

## Free-tier limits it watches

| Resource | Free limit | Resets | What happens on breach |
| --- | --- | --- | --- |
| Workers requests | 100,000 / day | UTC midnight | 1102 / exceeded-resources errors |
| D1 rows written | 100,000 / day | UTC midnight | Queries fail until reset (enforced since 2026-09-01 — email alert sent) |
| D1 rows read | 5,000,000 / day | UTC midnight | Same enforcement as writes |
| D1 storage | 500 MB per database | — | Writes rejected when full |
| R2 storage | 10 GB-month / month | Monthly | Overage billing (paid) / blocked (free) |
| R2 Class A ops | 1,000,000 / month | Monthly | Overage billing |
| R2 Class B ops | 10,000,000 / month | Monthly | Overage billing |
| Worker CPU time | 10 ms / request | Per request | 1102 invocation error |
| Worker subrequests | 50 / invocation | Per request | Subrequest limit error |

Osler's internal caps sit far below these (10k analytics writes/day,
25k stat writes/day, 12 ingest batches/min, ≤ 40 subrequests per bounded run)
so the app throttles itself before Cloudflare does — the panel's "safety
throttles" table lists every guard and which quota it protects.

## R2 Class A/B mapping

GraphQL reports raw `actionType` values; the Worker buckets them:

| Class | Rule | Examples |
| --- | --- | --- |
| A (writes/lists) | Starts with `put`/`post`/`copy`/`upload`/`complete`/`abort`/`list` | `PutObject`, `CompleteMultipartUpload`, `ListObjectsV2` |
| B (reads) | Starts with `get`/`head` | `GetObject`, `HeadObject` |
| Excluded | Contains `delete` | Deletes are free — not counted toward either class |
| Unknown | → Class A | Conservative: a new action type can only over-alert, never hide usage |

## Overhead

- One panel load = ≤ 4 GraphQL subrequests + the usual D1 reads, cached
  5 min per isolate. Well inside the 50-subrequest free cap.
- The R2 `list()` fallback walks ≤ 40 pages (1 Class B op per 1,000 objects)
  and only runs when the storage gauge query fails.
- The endpoint is admin-only (`403` otherwise); the token never leaves the
  Worker — responses contain usage numbers, never credentials.

## Troubleshooting

- **Still "Estimated" after setup** → `CF_ACCOUNT_ID` typo (must be 32 hex
  chars), token missing the Account Analytics → Read permission (401s fall
  back silently), or the Worker wasn't redeployed after `secret put`.
- **GraphQL lags a few minutes** — normal aggregation delay, same as the
  dashboard. `liveAt` shows the fetch time.
- **Numbers look higher than one Worker** — the requests query is
  account-level; every Worker on the account counts. Split accounts or scope
  by script name if you share one.
- **CPU card shows latency, not CPU** — the `quantiles.cpuTimeP50` field is
  best-effort; if Cloudflare renames it, that card falls back to the
  client-measured latency framing instead of breaking.
- **D1 sections always estimated** — by design (no confirmed schema); the
  billed source of truth is the dashboard D1 Metrics page.
