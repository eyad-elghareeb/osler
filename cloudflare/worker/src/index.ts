// Osler Cloud Worker — TypeScript
// ---------------------------------------------------------------------------
// Plan: harden the content workflow against the free-plan 1,000-subrequest
// cap (see incident 2026-08-17: backfill 500 emptied the D1 registry and
// left ~2,500 orphaned R2 objects). Changes: (1) add admin gc-orphans
// endpoint so orphaned content/<type>/<uuid>/ objects can be swept in
// bounded runs; (2) bound r2-delete-prefix / r2-rename-prefix per invocation
// (they loop every key across content-files + content-staging and can exceed
// the cap mid-loop, returning a partial 500); (3) DELETE :id also removes the
// managed base's images/ folder (previously orphaned); (4) single DELETE
// r2-key regenerates the category manifest (previously left a stale manifest
// advertising deleted files); (5) publish-staged chunks client-side. All new
// runs return complete/remaining so the admin UI loops like the backfill.
// No restructuring — patch in place.
// ---------------------------------------------------------------------------
// Email/password & Google accounts, role-based authorization
// (`student` | `content_admin` | `admin`), password reset, account management
// (profile updates, password changes, data export, account deletion), admin API
// (user & R2-backed content management with draft/pending/published workflow),
// admin audit log, rate limiting, security headers, and local-first QBank &
// flashcard sync.
//
// Runs entirely on Cloudflare's free tier (Workers + D1 + R2).
//
// SECURITY MODEL
//   * Sessions are HMAC-SHA-256 signed tokens stored server-side in D1.
//   * All admin endpoints require a bearer session token whose role matches.
//   * CORS is restricted to a single ALLOWED_ORIGIN. Empty Origin is only
//     allowed for public endpoints (health, content, content-manifests).
//   * Auth endpoints are rate-limited per IP using an in-memory LRU. The
//     scheduled cron job prunes stale sessions, OAuth states, handoffs, reset
//     tokens, old audit-log entries, and handles content scheduling.
//   * Sensitive responses always include `Cache-Control: no-store`.
//   * Audit log uses HMAC chain for tamper evidence.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();
import { SYNC_KINDS, RETIRED_SYNC_KINDS, mergeKind, gzipString, gunzipBytes, gunzipBytesBounded, base64ToBytes, MAX_DOCUMENT_BYTES, MAX_STORED_PAYLOAD_BYTES } from "./sync-docs";
import { SEGMENTED_KINDS, splitSegmentKind, baseKindOfRow, packKindSegments } from "./sync-orchestrator";
import { sendEmail, passwordResetEmail, verifyEmail, emailProviderReady, emailProviderName, testEmail } from "./email";
import { handleMcpRequest, listApiTokens, mintApiToken, revokeApiToken } from "./mcp";
import { handleAuthorizeGet, handleAuthorizePost, handleProtectedResource, handleRegister, handleServerMetadata, handleToken, type McpOAuthHost } from "./mcp/oauth";
import { UserSyncHub, mintRealtimeTicket, verifyRealtimeTicket, REALTIME_TICKET_TTL_MS } from "./realtime-hub";
// Durable Object classes must be reachable from the entry module for the
// wrangler migration to bind them.
export { UserSyncHub };
const PASSWORD_ITERATIONS = 100_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// After a session token's JWT `exp` passes, it may still be rotated through
// /v1/auth/refresh as long as the D1 session row is no older than this grace
// window. Every successful refresh issues a brand-new 7-day session, so an
// active user is never forced to re-enter their password; an abandoned
// session dies out naturally ~GRACE after its last refresh. Kept short: a
// stolen token that expires must not remain a live credential for weeks.
const SESSION_REFRESH_GRACE_MS = 48 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
// MAX_DOCUMENT_BYTES / MAX_STORED_PAYLOAD_BYTES live in ./sync-docs (shared
// with the segment orchestrator): a segmented kind spreads its merged doc
// across multiple rows, each packing to 85% of the raw ceiling.
// Per-user total raw storage budget across all sync kinds (15MB). The kinds
// each capped at 2MB sum to more than that, so 15MB is the budget the UI
// advertises and the per-kind caps are the practical ceiling.
const MAX_USER_STORAGE_BYTES = 15_360_000;
// Cap on the decompressed size of an incoming gzip request body (sync PUTs).
const MAX_GZIP_BODY_BYTES = 16_000_000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_BUCKETS = new Map<string, { count: number; expiresAt: number }>();
const RATE_LIMIT_MAX: Record<string, number> = {
  "auth:login": 12,
  "auth:register": 6,
  "auth:reset": 6,
  "auth:google:start": 10,
  "auth:google:consume": 12,
  "auth:refresh": 30,
  "guest": 12,
  "ip:global": 600,
  "content": 240,
  "admin": 600,
  "sync": 30,
  // Realtime sync pokes: one mint per (re)connect plus the upgrade itself.
  // Legit reconnects are rare (page reloads, network switches); 30/min per IP
  // still covers a classroom behind one NAT recovering from a Wi-Fi blip
  // while capping a hostile client's connect-loop burn.
  "realtime": 30,
  "search": 30,
  // Per-MCP-token budget, checked in addition to the shared per-IP "admin"
  // bucket below. The IP bucket alone means every agent token that happens
  // to call out from the same egress IP (a hosted agent platform, a shared
  // office NAT, etc.) draws from one pool — a single busy token can starve
  // both the human admin panel and every other token on that IP. Keying a
  // second check by token id contains a noisy/misbehaving token to its own
  // budget without touching anyone else's. 240/min comfortably covers a
  // large create_content_pack batch import loop while still bounding worst
  // case D1/R2 load from a single credential.
  "mcp_token": 240,
  // Analytics: 12 batches/min per IP. At 20 events/batch that's 240 writes/min
  // = 345K/day worst case — still over the daily cap, but the global cap
  // (ANALYTICS_DAILY_WRITE_CAP) catches it. 12/min is plenty for real user
  // sessions (which flush every 20s = 3 batches/min).
  "analytics": 12,
  // Per-user analytics limit (same as per-IP). Prevents a single user from
  // rotating IPs to bypass the per-IP limit. Uses a separate bucket name
  // so the rateLimit() function doesn't double-count against ip:global.
  "analytics_user": 12,
  // QBank choice stats: reports are one POST per finished session, reads are
  // one GET per review view (cached client-side). Generous read budget since
  // the response is served from a single indexed query.
  "qstats": 10,
  "qstats_user": 10,
  "qstats_read": 120,
  // Support tickets: filing is a deliberate user action (a form submit), not a
  // background loop — a handful per minute is far above legitimate usage.
  "ticket": 5,
  "ticket_user": 5,
};

const MAX_SESSIONS_PER_USER = 12;
const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
// Analytics events are pruned after 30 days — plenty for trend analysis
// while keeping D1 row counts comfortably within the Cloudflare free tier.
const ANALYTICS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Per-batch caps for /v1/analytics/events POST — bounds worker CPU time
// AND D1 row-write quota. Each event = 1 row written. The D1 free tier
// allows 100,000 rows written per day for the ENTIRE database (auth, sync,
// content, analytics). The caps below + the daily global cap keep analytics
// from starving the rest of the app. Larger batches cost fewer WORKER
// requests (the free tier's 100K/day request budget) without changing the
// D1 row math — the client flushes in exactly this batch size.
const ANALYTICS_MAX_BATCH = 50;
const ANALYTICS_MAX_PATH_LEN = 255;
const ANALYTICS_MAX_DETAIL_BYTES = 512;
// Global daily write cap for analytics events. When exceeded, new events
// are rejected with 429 until the next UTC midnight. This protects the D1
// daily row-write quota (100K/day, ACCOUNT-WIDE — sharding does not
// multiply it) from being exhausted. Sized for a ~200-DAU instance with
// headroom: 10K rows = 50 events/user/day, while a typical study session
// emits a fraction of that — leaving 90% of the write budget for auth,
// sync, and content, which are the flows users actually notice.
const ANALYTICS_DAILY_WRITE_CAP = 10_000;

// Per-question choice stats ("62% of users chose B") — pre-aggregated counters
// in question_choice_stats, one upsert row per answered question per finished
// session. Caps bound the shared D1 write quota independently of analytics.
const QBANK_STATS_MAX_BATCH = 250;
const QBANK_STATS_MAX_OPTIONS = 12;
const QBANK_STATS_ID_MAX_LEN = 160;
// Percentages are hidden below this respondent count so individuals in small
// cohorts can't be identified from an unusual choice. Instances can override
// it per-deployment via the QBANK_STATS_MIN_SAMPLE env var (e.g. "1" on a
// small self-hosted instance, where the default would hide all data).
const QBANK_STATS_DEFAULT_MIN_SAMPLE = 5;
const QBANK_STATS_DAILY_WRITE_CAP = 25_000;

/** Resolve the effective student-facing minimum sample from the environment.
 *  Invalid/absent values fall back to the privacy-safe default of 5. */
function qstatsMinSample(env: Env): number {
  const raw = Number(env.QBANK_STATS_MIN_SAMPLE);
  if (!Number.isFinite(raw) || raw < 0) return QBANK_STATS_DEFAULT_MIN_SAMPLE;
  return Math.min(50, Math.floor(raw));
}

// Contributor dedup: each (contributor, question) pair increments the
// aggregate counters exactly once, ever. Respondent rows are pruned after
// this window by the hourly cron.
const QBANK_STATS_RESPONDENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const QBANK_STATS_AID_MAX_LEN = 64;

let googleKeys: { expiresAt: number; keys: JsonWebKey[] } = { expiresAt: 0, keys: [] };

// ─── Env type ────────────────────────────────────────────────────────────────

interface Env {
  DB: D1Database;
  /** Optional sync shard pool — progress_documents is partitioned user-by-user
   *  across up to SYNC_SHARD_COUNT databases; users.sync_shard (core) names the
   *  owner. All six absent ⇒ progress_documents stays in DB (single-database
   *  mode). See wrangler.toml "Optional D1 shards" + `npm run db:shard`. */
  DB_SYNC_1?: D1Database;
  DB_SYNC_2?: D1Database;
  DB_SYNC_3?: D1Database;
  DB_SYNC_4?: D1Database;
  DB_SYNC_5?: D1Database;
  DB_SYNC_6?: D1Database;
  /** Optional telemetry shard — holds analytics_events, question_choice_*,
   *  and daily_counters. Absent ⇒ telemetry stays in DB (single-database
   *  mode). */
  DB_TELEMETRY?: D1Database;
  CONTENT?: R2Bucket;
  /** Realtime poke hub (per-user Durable Object). Optional binding: instances
   *  that never applied the DO migration keep working — sync still runs over
   *  plain HTTP (push + foreground pull), just without instant pokes. */
  USER_SYNC_HUB?: DurableObjectNamespace<UserSyncHub>;
  JWT_SECRET: string;
  AUDIT_HMAC_KEY?: string;
  ALLOWED_ORIGIN: string;
  TURNSTILE_ENABLED?: string;
  TURNSTILE_SECRET_KEY?: string;
  WORKER_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Optional service binding to the Gmail relay worker (same-account
   *  deploys). Preferred over EMAIL_WORKER_URL: traffic rides Cloudflare's
   *  private network and cannot originate from another account. */
  EMAIL?: Fetcher;
  /** Gmail SMTP relay worker (cloudflare/email-worker) base URL. Takes
   *  precedence over Resend when both are configured. */
  EMAIL_WORKER_URL?: string;
  /** Shared bearer token the relay worker validates (its EMAIL_TOKEN secret). */
  EMAIL_WORKER_TOKEN?: string;
  APP_ORIGIN?: string;
  GEMINI_ENCRYPTION_KEY?: string;
  CONTENT_ONLY_MANAGED?: string | boolean;
  /** Minimum respondents before students see peer percentages (default 5). */
  QBANK_STATS_MIN_SAMPLE?: string;
  /** Cloudflare account ID (32 hex chars) for live GraphQL usage queries. */
  CF_ACCOUNT_ID?: string;
  /** API token with Account Analytics:Read (a SECRET — set via
   *  `wrangler secret put CF_ANALYTICS_TOKEN`, never in wrangler.toml).
   *  Enables live quota numbers in GET /v1/admin/analytics/cloudflare-limits;
   *  without it the endpoint serves D1-derived estimates. */
  CF_ANALYTICS_TOKEN?: string;
  /** R2 bucket name for live ops/storage queries (default "osler-content"). */
  CF_R2_BUCKET?: string;
}

// ── D1 shard routing ─────────────────────────────────────────────────────────
//
// The D1 free tier allows 500 MB of storage PER DATABASE, but the read/write
// row quotas (5M reads / 100K writes per day) are ACCOUNT-WIDE — splitting
// into multiple databases multiplies only the storage ceiling. That is still
// decisive: it isolates the tables most likely to fill up fastest from the
// tables users actually care about protecting, and both from the small-but-
// precious auth/content tables. Shard bindings are optional — every accessor
// falls back to the single primary DB, so a deployment without the extra
// databases behaves exactly as before.
//
// The sync pool is partitioned USER-BY-USER, not by table: every kind of a
// given user's progress_documents lives in exactly ONE shard, so a
// per-user read/write is a single-database operation. Ownership is recorded
// on the user row itself (users.sync_shard, core DB) — which every
// authenticated request already loads — and new users are assigned
// deterministically by hash of their id. Six shards × 500 MB free-tier
// ceiling ≈ 2.5 GB of usable sync storage.

/** Number of sync shard databases in the pool. */
const SYNC_SHARD_COUNT = 6;

/** The sync shard bindings actually present in this deployment. */
function boundSyncDbs(env: Env): D1Database[] {
  return [env.DB_SYNC_1, env.DB_SYNC_2, env.DB_SYNC_3, env.DB_SYNC_4, env.DB_SYNC_5, env.DB_SYNC_6]
    .filter((db): db is D1Database => !!db);
}

/** Every sync shard a whole-pool scan must cover (single DB when unsharded). */
function allSyncDbs(env: Env): D1Database[] {
  const bound = boundSyncDbs(env);
  return bound.length ? bound : [env.DB];
}

/** The sync shard database that owns `shard`'s users. Out-of-range or
 *  partial bindings fold into the bound pool rather than failing. */
function syncDb(env: Env, shard: number): D1Database {
  const bound = boundSyncDbs(env);
  if (bound.length === 0) return env.DB;
  const n = Number.isInteger(shard) && shard >= 1 ? shard : 1;
  return bound[(n - 1) % bound.length];
}

/** The shard number recorded on a user row, normalized for pre-backfill
 *  rows (sync_shard is NULL until `npm run db:shard` assigns it). */
function userSyncShard(user: { sync_shard?: number | null }): number {
  const n = Number(user?.sync_shard);
  return Number.isInteger(n) && n >= 1 && n <= SYNC_SHARD_COUNT ? n : 1;
}

/** Deterministic user→shard assignment (djb2 over the user id). MUST stay
 *  in sync with the copy in scripts/shard-d1.mjs — both decide where a
 *  user's rows live. */
function syncShardForUserId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return (h % SYNC_SHARD_COUNT) + 1;
}

/** Telemetry shard: analytics_events, question_choice_* + their daily
 *  write-cap counters (counters are bumped in the same batch as the
 *  telemetry rows they guard, so they must share its database). */
function telemetryDb(env: Env): D1Database {
  return env.DB_TELEMETRY ?? env.DB;
}

/** Free-tier storage ceiling per D1 database. */
const D1_FREE_TIER_DB_BYTES = 500 * 1024 * 1024;

/** Number of D1 databases this deployment binds (1 unsharded, up to 8
 *  fully sharded: core + 6 sync + telemetry). Only the STORAGE quota
 *  scales with this. */
function d1ShardCount(env: Env): number {
  return 1 + boundSyncDbs(env).length + (env.DB_TELEMETRY ? 1 : 0);
}

// ── Shard schema bootstrap ───────────────────────────────────────────────────
//
// A shard binding pointed at a database without its schema (bindings added
// before migrations ran, a recreated database, a restored backup, or plain
// local dev) would turn every sync/telemetry query into a 500. The worker
// therefore bootstraps its own shard schemas: the statements below are
// byte-identical to migrations-sync/ + migrations-telemetry/ (keep both in
// sync), idempotent with them, and run at most once per isolate per shard.
// Migrations remain the source of truth (`npm run db:migrate:shards`) — the
// bootstrap only guarantees the worker never hard-fails on an empty shard.

const SHARD_SCHEMA_SQL: Record<"sync" | "telemetry", string[]> = {
  sync: [
    `CREATE TABLE IF NOT EXISTS progress_documents (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 0,
  raw_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
)`,
  ],
  telemetry: [
    `CREATE TABLE IF NOT EXISTS analytics_events (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN (
    'page_view', 'web_vital', 'js_error', 'api_call', 'route_change'
  )),
  path         TEXT,
  metric_name  TEXT,
  value        REAL,
  detail       TEXT,
  browser      TEXT,
  device       TEXT,
  connection   TEXT,
  created_at   INTEGER NOT NULL
)`,
    "CREATE INDEX IF NOT EXISTS analytics_events_type_time ON analytics_events(event_type, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS analytics_events_time      ON analytics_events(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS analytics_events_session   ON analytics_events(session_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS analytics_events_path      ON analytics_events(path, created_at DESC)",
    `CREATE TABLE IF NOT EXISTS question_choice_stats (
  uid           TEXT NOT NULL,
  qid           TEXT NOT NULL,
  choice        INTEGER NOT NULL,
  options_count INTEGER NOT NULL DEFAULT 0,
  count         INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (uid, qid, choice)
)`,
    "CREATE INDEX IF NOT EXISTS question_choice_stats_updated ON question_choice_stats(updated_at)",
    `CREATE TABLE IF NOT EXISTS question_choice_respondents (
  aid        TEXT NOT NULL,
  uid        TEXT NOT NULL,
  qid        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (aid, uid, qid)
)`,
    "CREATE INDEX IF NOT EXISTS question_choice_respondents_created ON question_choice_respondents(created_at)",
    `CREATE TABLE IF NOT EXISTS daily_counters (
  name TEXT NOT NULL,
  day  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, day)
)`,
    // Permanent daily rollup of the raw event stream: the cron recomputes the
    // last two days into it hourly, and analytics_events rows older than 30
    // days are pruned — the rollup is what keeps all-time aggregate
    // statistics alive after the raw rows are gone.
    `CREATE TABLE IF NOT EXISTS analytics_daily (
  day        TEXT NOT NULL,
  event_type TEXT NOT NULL,
  events     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event_type)
)`,
  ],
};

const shardSchemaReady: Partial<Record<string, Promise<void>>> = {};

/** Idempotently create the shard's tables if missing (once per isolate).
 *  Sync bootstrap applies per pool shard (`index`); telemetry is a single
 *  database. Rejects only when the database itself is unreachable — a
 *  missing schema heals here, a dead binding still fails loudly on the
 *  real query. */
function ensureShardSchema(env: Env, kind: "sync" | "telemetry", index = 1): Promise<void> {
  const key = `${kind}:${index}`;
  const cached = shardSchemaReady[key];
  if (cached) return cached;
  const db = kind === "sync" ? syncDb(env, index) : telemetryDb(env);
  const run = db.batch(SHARD_SCHEMA_SQL[kind].map((sql) => db.prepare(sql))).then(() => undefined);
  shardSchemaReady[key] = run;
  // A failed bootstrap is never cached — the next request retries, so a
  // transient D1 blip can't wedge the isolate until recycle.
  run.catch(() => { delete shardSchemaReady[key]; });
  return run;
}

function isManagedOnly(env: Env): boolean {
  return env.CONTENT_ONLY_MANAGED === "true" || env.CONTENT_ONLY_MANAGED === "1" || env.CONTENT_ONLY_MANAGED === true;
}

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  password_salt: string;
  role: string;
  has_password?: number;
  created_at: number;
  updated_at: number;
  gemini_api_key?: string | null;
  gemini_model?: string | null;
  gemini_max_wait?: number | null;
  email_verified_at?: number | null;
  /** Which sync shard owns this user's progress_documents (1-based).
   *  NULL until `npm run db:shard` assigns it — treated as shard 1. */
  sync_shard?: number | null;
}

interface SessionRow {
  sessionId: string;
  user: UserRow;
}
type Session = SessionRow;

interface Logger {
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
  requestId: string;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

const now = () => Date.now();
const id = () => crypto.randomUUID();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = new Uint8Array(bytes);
  let str = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    str += String.fromCharCode.apply(null, [...arr.subarray(i, i + chunk)]);
  }
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function unb64url(value: string): Uint8Array {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

async function sha256(value: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Constant-time string comparison (used for HMAC signatures). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function passwordHash(password: string, salt?: string) {
  const s = salt || b64url(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64url(s), iterations: PASSWORD_ITERATIONS }, key, 256);
  return { salt: s, hash: b64url(bits) };
}

async function passwordMatches(password: string, salt: string, expected: string): Promise<boolean> {
  const actual = (await passwordHash(password, salt)).hash;
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

// Uniform timing for login of unknown accounts. The real path runs a ~100ms
// PBKDF2 derive before answering; without this, a missing-username attempt
// returns instantly and leaks whether an account exists over a network link.
// We burn the same derive against a fixed dummy credential so both paths cost
// the same wall-clock time. The dummy entry is lazily derived once.
let dummyPasswordCredentials: { hash: string; salt: string } | null = null;
async function verifyDummyPassword(password: string): Promise<void> {
  if (!dummyPasswordCredentials) dummyPasswordCredentials = await passwordHash("verify-dummy-password");
  await passwordMatches(password, dummyPasswordCredentials.salt, dummyPasswordCredentials.hash);
}

// ─── Field-level encryption (AEAD AES-256-GCM) ───────────────────────────────

async function deriveFieldKey(rawKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyBytes = unb64url(rawKey);
  if (keyBytes.length < 32) throw new Error("GEMINI_ENCRYPTION_KEY must be at least 32 bytes (base64url)");
  const baseKey = await crypto.subtle.importKey("raw", keyBytes.slice(0, 32), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("osler-field-encryption-v1") },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function encryptField(plaintext: string, encryptionKey?: string): Promise<string> {
  if (!encryptionKey) return plaintext;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveFieldKey(encryptionKey, salt);
  const encoded = encoder.encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(1 + salt.length + iv.length + ciphertext.byteLength);
  combined[0] = 1;
  combined.set(salt, 1);
  combined.set(iv, 1 + salt.length);
  combined.set(new Uint8Array(ciphertext), 1 + salt.length + iv.length);
  return b64url(combined);
}

async function decryptField(data: string | null | undefined, encryptionKey?: string): Promise<string | null> {
  if (!encryptionKey) return data ?? null;
  if (!data || typeof data !== "string") return data ?? null;
  let raw: Uint8Array;
  try { raw = unb64url(data); } catch { return data; }
  if (raw.length < 1 + 16 + 12 + 1) return data;
  const version = raw[0];
  if (version !== 1) return data;
  const salt = raw.slice(1, 1 + 16);
  const iv = raw.slice(1 + 16, 1 + 16 + 12);
  const ciphertext = raw.slice(1 + 16 + 12);
  const key = await deriveFieldKey(encryptionKey, salt);
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return decoder.decode(decrypted);
  } catch {
    return null;
  }
}

/** Read a request body as text, transparently decompressing gzip bodies
 *  (sent by the sync client when the payload is large enough to be worth it).
 *  `maxTextBytes` bounds the DECOMPRESSED size. */
async function requestBodyText(request: Request, maxTextBytes: number): Promise<string> {
  const encoding = request.headers.get("content-encoding") ?? "";
  // Reject oversized bodies on Content-Length BEFORE buffering, so a huge
  // plain request never gets read into memory just to be thrown away. gzip is
  // non-expanding (compressed ≤ decompressed), so the same bound holds.
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > maxTextBytes) throw new Error("Request body is too large");
  if (encoding.includes("gzip")) {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > maxTextBytes) throw new Error("Request body is too large");
    return await gunzipBytesBounded(new Uint8Array(buf), maxTextBytes);
  }
  const text = await request.text();
  if (text.length > maxTextBytes) throw new Error("Request body is too large");
  return text;
}

async function readJson(request: Request): Promise<any> {
  return readJsonBody(request, 1_000_000);
}

/** Like readJson but with an explicit decompressed-size cap. Used by the sync
 *  PUT where gzip'd progress snapshots can legitimately exceed 1MB raw. */
async function readJsonBody(request: Request, maxBytes: number): Promise<any> {
  const text = await requestBodyText(request, maxBytes);
  try { return safeParseJSON(text, 32); } catch { throw new Error("Invalid JSON body"); }
}

/** Like readJson but for large payloads — used by the file-upload endpoint
 *  where base64-encoded binary assets (PDFs, images, audio) routinely exceed
 *  the 1 MB default cap. Bounded by `maxBytes` so the Worker never buffers
 *  unbounded input. */
async function readJsonLarge(request: Request, maxBytes = 30_000_000): Promise<any> {
  const text = await requestBodyText(request, maxBytes);
  try { return safeParseJSON(text, 32); } catch { throw new Error("Invalid JSON body"); }
}

function jsonDepth(text: string): number {
  let depth = 0, max = 0, inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
      if (depth > max) max = depth;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
  }
  return max;
}

function safeParseJSON(text: string, maxDepth = 32): any {
  if (jsonDepth(text) > maxDepth) throw new Error("JSON is too deeply nested");
  return JSON.parse(text);
}

// ─── Q3: Validation framework ────────────────────────────────────────────────

const s = {
  string: (v: unknown, opts?: { min?: number; max?: number }): v is string =>
    typeof v === "string" && (opts?.min === undefined || v.length >= opts.min) && (opts?.max === undefined || v.length <= opts.max),
  number: (v: unknown, opts?: { min?: number; max?: number }): v is number =>
    typeof v === "number" && !isNaN(v) && (opts?.min === undefined || v >= opts.min) && (opts?.max === undefined || v <= opts.max),
  email: (v: unknown): v is string =>
    typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254,
  oneOf: <T>(v: unknown, values: readonly T[]): v is T => values.includes(v as T),
  boolean: (v: unknown): v is boolean => typeof v === "boolean",
};

interface ValidationRule {
  field: string;
  type: "string" | "number" | "email" | "boolean";
  required?: boolean;
  min?: number;
  max?: number;
  oneOf?: readonly unknown[];
}

function validate(body: Record<string, unknown> | null | undefined, rules: ValidationRule[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!body || typeof body !== "object") return { valid: false, errors: ["Body must be a JSON object"] };
  for (const rule of rules) {
    const value = body[rule.field];
    if (value === undefined || value === null) {
      if (rule.required) errors.push(`${rule.field}: required`);
      continue;
    }
    if (rule.oneOf) {
      if (!s.oneOf(value, rule.oneOf)) errors.push(`${rule.field}: must be one of [${rule.oneOf.join(", ")}]`);
    } else if (rule.type === "email") {
      if (!s.email(value)) errors.push(`${rule.field}: invalid email`);
    } else if (rule.type === "string") {
      if (!s.string(value, { min: rule.min, max: rule.max })) errors.push(`${rule.field}: invalid string${rule.min !== undefined ? ` (min ${rule.min})` : ""}${rule.max !== undefined ? ` (max ${rule.max})` : ""}`);
    } else if (rule.type === "number") {
      if (!s.number(value, { min: rule.min, max: rule.max })) errors.push(`${rule.field}: invalid number${rule.min !== undefined ? ` (min ${rule.min})` : ""}${rule.max !== undefined ? ` (max ${rule.max})` : ""}`);
    } else if (rule.type === "boolean") {
      if (!s.boolean(value)) errors.push(`${rule.field}: must be a boolean`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// ─── Q4: Structured logging ──────────────────────────────────────────────────

function createLogger(_request?: Request, _ctx?: ExecutionContext): Logger {
  const requestId = crypto.randomUUID().slice(0, 8);
  const logFn = (level: string, msg: string, extra: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({ level, msg, requestId, ...extra, timestamp: Date.now() }));
  };
  return {
    info: (msg, extra) => logFn("info", msg, extra),
    warn: (msg, extra) => logFn("warn", msg, extra),
    error: (msg, extra) => logFn("error", msg, extra),
    requestId,
  };
}
// ─── Response helpers ────────────────────────────────────────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function json(body: unknown, status = 200, origin = "", options: { cacheControl?: string; csp?: string; requestId?: string } = {}): Response {
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": options.cacheControl ?? "no-store",
    ...cors(origin),
  };
  if (options.csp) headers["content-security-policy"] = options.csp;
  if (options.requestId) headers["x-request-id"] = options.requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function cors(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, content-encoding, if-unmodified-since, x-osler-realtime-conn, x-sync-since-qbank, x-sync-since-flashcards, x-sync-since-sessions, x-sync-since-notes, x-sync-since-highlights, x-sync-since-articleHighlights, x-sync-since-writtenDrafts, x-sync-since-bookmarks, x-sync-since-achievements, x-sync-since-settings, x-sync-since-*",
    "access-control-expose-headers": "x-request-id, content-encoding, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

// ─── Q5: CORS hardening ──────────────────────────────────────────────────────

function requestOrigin(request: Request, env: Env): string {
  const origin = request.headers.get("origin") || "";
  if (!origin || origin === env.ALLOWED_ORIGIN) return origin || env.ALLOWED_ORIGIN || "";
  return "";
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Real-IP")
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "0.0.0.0";
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

function rateLimit(ip: string, bucket: string): boolean {
  const ipKey = `ip:global:${ip}`;
  const bucketKey = `${bucket}:${ip}`;
  const t = now();
  let ipEntry = RATE_LIMIT_BUCKETS.get(ipKey);
  if (!ipEntry || ipEntry.expiresAt < t) ipEntry = { count: 0, expiresAt: t + RATE_LIMIT_WINDOW_MS };
  ipEntry.count += 1;
  RATE_LIMIT_BUCKETS.set(ipKey, ipEntry);
  if (ipEntry.count > RATE_LIMIT_MAX["ip:global"]) return false;
  let entry = RATE_LIMIT_BUCKETS.get(bucketKey);
  if (!entry || entry.expiresAt < t) entry = { count: 0, expiresAt: t + RATE_LIMIT_WINDOW_MS };
  entry.count += 1;
  RATE_LIMIT_BUCKETS.set(bucketKey, entry);
  if (RATE_LIMIT_BUCKETS.size > 2000) pruneRateLimitBuckets(t);
  return entry.count <= (RATE_LIMIT_MAX[bucket] ?? 60);
}

/** Cheap bounded sweep for the in-memory rate-limit table. The old prune
 *  sorted the ENTIRE map (O(n log n)) on every request once the table grew
 *  past 2000 entries — under a burst that serialized each request. We instead
 *  delete up to 200 already-expired buckets (a linear scan, no allocation),
 *  then fall back to evicting the oldest-inserted buckets — Map preserves
 *  insertion order, which approximates age closely enough for rate limiting. */
function pruneRateLimitBuckets(t: number): void {
  if (RATE_LIMIT_BUCKETS.size <= 2000) return;
  let removed = 0;
  for (const [key, entry] of RATE_LIMIT_BUCKETS) {
    if (entry.expiresAt < t) {
      RATE_LIMIT_BUCKETS.delete(key);
      removed += 1;
      if (removed >= 200) break;
    }
  }
  if (RATE_LIMIT_BUCKETS.size > 2000) {
    let i = 0;
    for (const key of RATE_LIMIT_BUCKETS.keys()) {
      if (i >= 200) break;
      RATE_LIMIT_BUCKETS.delete(key);
      i += 1;
    }
  }
}

// ─── Distributed login lockout (D1-backed) ──────────────────────────────────
//
// The per-IP in-memory rate limiter is per-isolate, so it can't stop
// distributed credential stuffing. Login failures are counted per
// identifier+IP in D1 (shared across all isolates); after MAX_LOGIN_FAILURES
// consecutive failures the pair is locked for LOGIN_LOCKOUT_MS even if every
// subsequent password guess is correct. A successful login clears the count.

const MAX_LOGIN_FAILURES = 8;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

async function loginLockoutCheck(env: Env, identifier: string, ip: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT locked_until FROM login_failures WHERE identifier = ? AND ip = ?")
    .bind(identifier.toLowerCase(), ip).first<{ locked_until: number | null }>();
  return !row?.locked_until || row.locked_until <= now();
}

async function loginFailureRecord(env: Env, identifier: string, ip: string): Promise<void> {
  const key = identifier.toLowerCase();
  const t = now();
  await env.DB.prepare(`
    INSERT INTO login_failures (identifier, ip, failures, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (identifier, ip) DO UPDATE SET
      failures = CASE WHEN locked_until IS NOT NULL AND locked_until > ? THEN failures ELSE failures + 1 END,
      locked_until = CASE
        WHEN locked_until IS NOT NULL AND locked_until > ? THEN locked_until
        WHEN failures + 1 >= ? THEN ? + ?
        ELSE NULL END,
      updated_at = ?
  `).bind(key, ip, t, t, t, MAX_LOGIN_FAILURES, t + LOGIN_LOCKOUT_MS, t).run();
}

async function loginFailureClear(env: Env, identifier: string, ip: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_failures WHERE identifier = ? AND ip = ?")
    .bind(identifier.toLowerCase(), ip).run();
}

// ─── Turnstile ───────────────────────────────────────────────────────────────
// Single source of truth for bot verification. Fail-closed: when Turnstile is
// enabled (TURNSTILE_ENABLED === "true") the challenge MUST verify — a missing
// token, a missing secret, or a siteverify non-success all reject. When
// disabled, every call passes and the app is unaffected.

async function verifyTurnstile(token: string | undefined, env: Env): Promise<boolean> {
  if (env.TURNSTILE_ENABLED !== "true") return true;
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const fb = new FormData();
  fb.set("secret", env.TURNSTILE_SECRET_KEY);
  fb.set("response", token);
  // Deliberately no `remoteip`: Cloudflare's siteverify docs warn that IP
  // binding makes legit solves fail behind proxies/VPNs, and Turnstile tokens
  // are single-use — replay across IPs is already impossible.
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fb });
  if (!result.ok) return false;
  const payload = await result.json() as { success: boolean };
  return payload.success === true;
}

/**
 * Whether the instance owner has enabled transactional email (password
 * resets + email verification). Reads the worker's own config at the R2
 * root (`_osler.config.json`); a missing or malformed file defaults to
 * enabled, so instances that never configure it keep working.
 */
async function emailEnabled(env: Env): Promise<boolean> {
  const obj = await env.CONTENT!.get("_osler.config.json");
  if (!obj) return true;
  try {
    const config = JSON.parse(await obj.text());
    return config?.email?.enabled !== false;
  } catch {
    return true;
  }
}

// ─── Validation helpers ──────────────────────────────────────────────────────

function validUsername(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(value); }
function validEmail(value: unknown): value is string { return !value || (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254); }
function validPassword(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  return classes >= 2;
}

function publicUser(user: UserRow) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, email: user.email ?? null };
}

function escapeLike(value: string): string {
  return String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

// ─── Session management ──────────────────────────────────────────────────────

async function issueSession(user: UserRow, env: Env, userAgent?: string | null) {
  const sessionId = id();
  const expiresAt = now() + SESSION_TTL_MS;
  const ua = typeof userAgent === "string" && userAgent.trim() ? userAgent.trim().slice(0, 300) : null;
  const payload = b64url(encoder.encode(JSON.stringify({ sub: user.id, sid: sessionId, role: user.role, exp: Math.floor(expiresAt / 1000) })));
  const token = `${payload}.${await hmac(payload, env.JWT_SECRET)}`;
  const tokenHash = await sha256(token);
  const result = await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, user_agent, last_seen_at)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?) < ?
  `).bind(sessionId, user.id, tokenHash, expiresAt, now(), ua, now(), user.id, now(), MAX_SESSIONS_PER_USER).run();
  if ((result.meta?.rows_written ?? 1) === 0) {
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id IN (SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at ASC LIMIT 1)").bind(now(), user.id, now()),
      env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, user_agent, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(sessionId, user.id, tokenHash, expiresAt, now(), ua, now()),
    ]);
  }
  return { token, expiresAt, user: publicUser(user) };
}

async function requireUser(request: Request, env: Env): Promise<SessionRow | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !env.JWT_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !timingSafeEqual(signature, await hmac(payload, env.JWT_SECRET))) return null;
  let claims: any;
  try { claims = JSON.parse(decoder.decode(unb64url(payload))); } catch { return null; }
  if (!claims?.sub || !claims?.sid || Number(claims.exp) * 1000 <= now()) return null;
  const row = await env.DB.prepare("SELECT s.id as _sid, s.last_seen_at as _last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?")
    .bind(claims.sid, await sha256(token), now()).first<Record<string, unknown>>();
  if (!row) return null;
  // Throttled "last seen" heartbeat backing the session/device manager:
  // at most one UPDATE per session per minute regardless of request volume.
  const lastSeen = Number(row._last_seen ?? 0);
  if (!lastSeen || now() - lastSeen > 60_000) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(now(), claims.sid).run();
  }
  const { _sid, _last_seen, ...userFields } = row;
  return { sessionId: claims.sid, user: userFields as unknown as UserRow };
}

/**
 * Rotate a session through /v1/auth/refresh. Unlike `requireUser`, the JWT
 * `exp` claim is intentionally NOT enforced here — an expired-but-recent
 * token may still be swapped for a fresh session as long as:
 *   * the HMAC signature is valid,
 *   * the D1 session row still exists and is not revoked,
 *   * the row is within `SESSION_REFRESH_GRACE_MS` of its DB expiry.
 *
 * The presented session is revoked and a brand-new one is issued (rotation),
 * so a token that has been refreshed once cannot be replayed. Returns null
 * when the session is genuinely dead (revoked / too old / unknown user).
 */
async function refreshSession(request: Request, env: Env): Promise<{ token: string; expiresAt: number; user: any } | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !env.JWT_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !timingSafeEqual(signature, await hmac(payload, env.JWT_SECRET))) return null;
  let claims: any;
  try { claims = JSON.parse(decoder.decode(unb64url(payload))); } catch { return null; }
  if (!claims?.sub || !claims?.sid) return null;
  const row = await env.DB.prepare(
    "SELECT id FROM sessions WHERE id = ? AND user_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
  ).bind(claims.sid, claims.sub, await sha256(token), now() - SESSION_REFRESH_GRACE_MS).first<{ id: string }>();
  if (!row) return null;
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(claims.sub).first<UserRow>();
  if (!user) return null;
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(now(), claims.sid).run();
  return issueSession(user, env, request.headers.get("user-agent"));
}

// ─── Sync merging ────────────────────────────────────────────────────────────
// mergeQbank / mergeFlashcards now live in ./sync-docs (pure, unit-tested).
// The sync helpers take the USER ROW, not a bare id: users.sync_shard names
// the owning shard, and the row is already in memory on every authenticated
// request — the partition costs zero extra queries.

/** Minimal user shape the sync helpers need. */
type SyncUser = Pick<UserRow, "id" | "sync_shard">;

async function getDocument(env: Env, user: SyncUser, kind: string): Promise<{ records: Record<string, any>; updatedAt: number }> {
  const shard = userSyncShard(user);
  await ensureShardSchema(env, "sync", shard);
  const db = syncDb(env, shard);
  if (SEGMENTED_KINDS.has(kind)) {
    // Orchestrator read path: assemble every segment row of the kind (plus
    // any pre-segmentation plain row) — records are disjoint across segments,
    // so assembly is a concat and updatedAt is the newest segment. A corrupt
    // segment is skipped rather than voiding the user's whole kind.
    const rows = await db.prepare("SELECT kind, payload, compressed, updated_at FROM progress_documents WHERE user_id = ? AND (kind = ? OR kind LIKE ?)").bind(user.id, kind, `${kind}${":"}%`).all<{ kind: string; payload: string; compressed: number; updated_at: number }>();
    const parts = (rows.results || [])
      .map((row) => ({ row, seg: splitSegmentKind(row.kind)?.index ?? 0 }))
      .sort((a, b) => a.seg - b.seg);
    let records: Record<string, any> = {};
    let updatedAt = 0;
    for (const { row } of parts) {
      try {
        const json = row.compressed ? await gunzipBytes(base64ToBytes(row.payload)) : row.payload;
        Object.assign(records, JSON.parse(json));
      } catch { /* skip corrupt segment — contained data loss, not a 500 */ }
      updatedAt = Math.max(updatedAt, Number(row.updated_at) || 0);
    }
    return { records, updatedAt };
  }
  const row = await db.prepare("SELECT payload, compressed, updated_at FROM progress_documents WHERE user_id = ? AND kind = ?").bind(user.id, kind).first<{ payload: string; compressed: number; updated_at: number }>();
  if (!row || !row.payload) return { records: {}, updatedAt: 0 };
  try {
    const json = row.compressed ? await gunzipBytes(base64ToBytes(row.payload)) : row.payload;
    return { records: JSON.parse(json), updatedAt: row.updated_at };
  } catch { return { records: {}, updatedAt: 0 }; }
}

async function getAllDocuments(env: Env, user: SyncUser): Promise<Record<string, { records: Record<string, any>; updatedAt: number }>> {
  const docs: Record<string, { records: Record<string, any>; updatedAt: number }> = {};
  const results = await Promise.all(SYNC_KINDS.map((kind) => getDocument(env, user, kind)));
  SYNC_KINDS.forEach((kind, i) => { docs[kind] = results[i]; });
  return docs;
}

async function getSelectedDocuments(env: Env, user: SyncUser, kinds: string[]): Promise<Record<string, { records: Record<string, any>; updatedAt: number }>> {
  const validKinds = new Set<string>(SYNC_KINDS);
  const kindsToFetch = kinds.filter((kind) => validKinds.has(kind));
  const docs: Record<string, { records: Record<string, any>; updatedAt: number }> = {};
  const results = await Promise.all(kindsToFetch.map((kind) => getDocument(env, user, kind)));
  kindsToFetch.forEach((kind, i) => { docs[kind] = results[i]; });
  return docs;
}

async function getSyncHead(env: Env, user: SyncUser): Promise<{ timestamps: Record<string, number>; usedBytes: number }> {
  const shard = userSyncShard(user);
  await ensureShardSchema(env, "sync", shard);
  const rows = await syncDb(env, shard).prepare("SELECT kind, updated_at, raw_bytes FROM progress_documents WHERE user_id = ?").bind(user.id).all<{ kind: string; updated_at: number; raw_bytes: number }>();
  const timestamps: Record<string, number> = {};
  for (const k of SYNC_KINDS) timestamps[k] = 0;
  let usedBytes = 0;
  for (const row of rows.results || []) {
    usedBytes += Number(row.raw_bytes || 0);
    // Segment rows fold into their logical kind (its timestamp is the newest
    // segment), so clients see the same per-kind view as before.
    if (typeof row.updated_at !== "number") continue;
    const base = baseKindOfRow(row.kind ?? "");
    timestamps[base] = Math.max(timestamps[base] ?? 0, row.updated_at);
  }
  return { timestamps, usedBytes };
}

/** Whole-pool progress_documents totals for the quota panel: one COUNT/SUM
 *  per sync shard, reduced to the single-row shape the panel expects.
 *  SUMs are NULL on an empty shard — coerced to 0 here. */
async function syncDbProgressTotals(env: Env): Promise<{ total: number; raw_bytes: number; compressed_bytes: number }> {
  const rows = await Promise.all(
    allSyncDbs(env).map((db) =>
      db.prepare("SELECT COUNT(*) AS total, SUM(raw_bytes) AS raw_bytes, SUM(LENGTH(payload)) AS compressed_bytes FROM progress_documents")
        .first<{ total: number; raw_bytes: number | null; compressed_bytes: number | null }>()
        .catch(() => null),
    ),
  );
  return rows.reduce<{ total: number; raw_bytes: number; compressed_bytes: number }>(
    (acc, r) => ({
      total: acc.total + (Number(r?.total) || 0),
      raw_bytes: acc.raw_bytes + (Number(r?.raw_bytes) || 0),
      compressed_bytes: acc.compressed_bytes + (Number(r?.compressed_bytes) || 0),
    }),
    { total: 0, raw_bytes: 0, compressed_bytes: 0 },
  );
}

// ─── Google OAuth ────────────────────────────────────────────────────────────

function googleReady(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.WORKER_URL);
}

function workerCallback(env: Env): string {
  return `${env.WORKER_URL.replace(/\/$/, "")}/v1/auth/google/callback`;
}

async function googleSigningKey(kid: string): Promise<any> {
  if (googleKeys.expiresAt < now()) {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!response.ok) throw new Error("Could not load Google signing keys");
    const maxAge = response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1];
    const googleKeysJson: any = await response.json();
    googleKeys = { keys: googleKeysJson.keys ?? [], expiresAt: now() + Number(maxAge ?? 3600) * 1000 };
  }
  return googleKeys.keys.find((key: any) => key.kid === kid);
}

async function verifyGoogleIdToken(token: string, env: Env, nonce: string): Promise<any> {
  const [encodedHeader, encodedPayload, encodedSignature] = String(token ?? "").split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Invalid Google identity token");
  const header = JSON.parse(decoder.decode(unb64url(encodedHeader)));
  const claims = JSON.parse(decoder.decode(unb64url(encodedPayload)));
  if (header.alg !== "RS256") throw new Error("Unexpected Google token algorithm");
  const jwk = await googleSigningKey(header.kid);
  if (!jwk) throw new Error("Unknown Google signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(encodedSignature), encoder.encode(`${encodedHeader}.${encodedPayload}`));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!verified || !audience.includes(env.GOOGLE_CLIENT_ID) || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) || Number(claims.exp) * 1000 <= now() || claims.nonce !== nonce || !claims.email_verified || !claims.sub || !validEmail(claims.email)) {
    throw new Error("Google identity could not be verified");
  }
  return claims;
}

async function availableGoogleUsername(env: Env, email: string): Promise<string> {
  const seed = (email.split("@")[0].toLowerCase().replace(/[^a-z0-9_.-]/g, "-").replace(/^-+|-+$/g, "") || "google-user").slice(0, 26);
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix ? `${seed.slice(0, 32 - String(suffix).length - 1)}-${suffix}` : seed;
    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(candidate).first();
    if (!existing) return candidate;
  }
  return `google-${id().slice(0, 8)}`;
}

async function googleUser(env: Env, claims: any): Promise<UserRow | null> {
  const existingIdentity = await env.DB.prepare("SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'google' AND i.provider_subject = ?").bind(claims.sub).first<UserRow>();
  if (existingIdentity) return existingIdentity;
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(claims.email.toLowerCase()).first<UserRow>();
  if (user) {
    // Account-jacking guard: a Google identity may only be linked onto an
    // existing account when that account is provably owned by the email's
    // controller — either the email was verified (the owner clicked a link
    // sent to it) or the account has no password (it was itself created by
    // an earlier Google sign-in). Otherwise an attacker could pre-register
    // a victim's email (registration never proves ownership) and then absorb
    // the victim's Google login into the attacker's account. Return null so
    // the caller fails the sign-in instead of linking.
    const isPasswordAccount = Number(user.has_password ?? 1) === 1;
    if (isPasswordAccount && !user.email_verified_at) return null;
  } else {
    const generatedPassword = await passwordHash(`${id()}${id()}`);
    const userId = id();
    try {
      await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, sync_shard, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
        .bind(userId, await availableGoogleUsername(env, claims.email), claims.email.toLowerCase(), String(claims.name || claims.email.split("@")[0]).slice(0, 80), generatedPassword.hash, generatedPassword.salt, syncShardForUserId(userId), now(), now()).run();
    } catch {
      // Lost the race: an account now exists for this email (email is UNIQUE).
      // Fail closed rather than link onto it or half-create a user.
      return null;
    }
    user = (await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>())!;
  }
  try {
    await env.DB.prepare("INSERT INTO auth_identities (provider, provider_subject, user_id, provider_email, created_at) VALUES ('google', ?, ?, ?, ?)")
      .bind(claims.sub, user.id, claims.email.toLowerCase(), now()).run();
  } catch {
    // Concurrent Google callbacks for the same sub — the identity row already
    // exists and the account is already linked; proceed.
  }
  return user;
}

async function createAuthHandoff(env: Env, userId: string): Promise<string> {
  const ticket = `${id()}${id()}`;
  await env.DB.prepare("INSERT INTO auth_handoffs (id, ticket_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id(), await sha256(ticket), userId, now() + HANDOFF_TTL_MS, now()).run();
  return ticket;
}

async function accountPayload(env: Env, user: UserRow): Promise<{ user: any; providers: string[] }> {
  const identities = await env.DB.prepare("SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY provider").bind(user.id).all<{ provider: string }>();
  return { user: { ...publicUser(user), hasPassword: Number(user.has_password ?? 1) === 1 }, providers: (identities.results || []).map((i: any) => i.provider) };
}

// ─── M6: HMAC-augmented audit logging ────────────────────────────────────────

async function auditLog(env: Env, actorId: string, action: string, targetId: string | null, detail: Record<string, unknown> | null, _log?: Logger): Promise<void> {
  try {
    const auditKey = env.AUDIT_HMAC_KEY || env.JWT_SECRET;
    const auditId = id();
    const detailJson = detail ? JSON.stringify(detail) : null;
    // Order by rowid (strict insert order), not created_at — two entries in
    // the same millisecond would otherwise fork the hash chain and trip a
    // false "chain broken" in verifyAuditChain.
    const prev = await env.DB.prepare("SELECT row_hash FROM admin_audit ORDER BY rowid DESC LIMIT 1").first<{ row_hash: string }>();
    const prevHash = prev?.row_hash || "";
    const chainInput = prevHash + action + (targetId || "") + (detailJson || "") + String(now());
    const rowHash = await hmac(chainInput, auditKey);
    await env.DB.prepare("INSERT INTO admin_audit (id, actor_id, action, target_id, detail, prev_hash, row_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(auditId, actorId, action, targetId ?? null, detailJson, prevHash, rowHash, now()).run();
  } catch (error: any) {
    const logger = _log || createLogger();
    logger.error("auditLog write failed", { error: error.message, actorId, action, targetId });
  }
}

async function verifyAuditChain(env: Env): Promise<{ valid: boolean; totalRows: number; checkedRows: number; firstBreak: number | null }> {
  const auditKey = env.AUDIT_HMAC_KEY || env.JWT_SECRET;
  // rowid order = insert order; created_at ties must not fork the chain.
  const rows = await env.DB.prepare("SELECT id, action, target_id, detail, prev_hash, row_hash, created_at FROM admin_audit ORDER BY rowid ASC").all<any>();
  const all = rows.results || [];
  if (all.length === 0) return { valid: true, totalRows: 0, checkedRows: 0, firstBreak: null };
  let expectedPrev = "";
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (r.prev_hash !== expectedPrev) return { valid: false, totalRows: all.length, checkedRows: i, firstBreak: i };
    const chainInput = expectedPrev + (r.action || "") + (r.target_id || "") + (r.detail || "") + String(r.created_at);
    const expectedHash = await hmac(chainInput, auditKey);
    if (r.row_hash !== expectedHash) return { valid: false, totalRows: all.length, checkedRows: i, firstBreak: i };
    expectedPrev = r.row_hash;
  }
  return { valid: true, totalRows: all.length, checkedRows: all.length, firstBreak: null };
}

// ─── M7: Webhook dispatcher ──────────────────────────────────────────────────

const WEBHOOK_EVENTS = {
  USER_REGISTERED: "user.registered",
  CONTENT_PUBLISHED: "content.published",
  CONTENT_APPROVED: "content.approved",
  ACCOUNT_DELETED: "account.deleted",
} as const;

/** Webhook delivery URLs are fetched by the Worker, so a stored hook pointing
 *  at a loopback/private address becomes an SSRF primitive. Webhooks are
 *  admin-created, but defense-in-depth: require HTTPS and reject internal
 *  hostnames, RFC1918/link-local/reserved IP literals — in every textual
 *  encoding (decimal/hex/octal integer forms like 2130706433 or 0x7f000001,
 *  dotted variants, and IPv6-mapped IPv4). */
function validWebhookUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  if (raw.length > 2048) return { ok: false, reason: "Webhook URL is too long" };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: "Webhook URL is invalid" }; }
  if (url.protocol !== "https:") return { ok: false, reason: "Webhook URL must use https" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "Localhost webhooks are not allowed" };
  for (const suffix of [".local", ".internal", ".lan", ".home", ".corp", ".intranet"]) {
    if (host.endsWith(suffix)) return { ok: false, reason: "Internal webhook hostnames are not allowed" };
  }
  // Reject any hostname that is purely digits/hex/dots — decimal ("2130706433"),
  // hex ("0x7f000001"), octal ("0177.0.0.1") and mixed-form IPv4 encodings all
  // slip past a dotted-quad regex and resolve to attacker-chosen addresses.
  // A legitimate webhook host always contains an alpha DNS label.
  const isDottedQuad = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!isDottedQuad && /^[0-9a-fx.:]+$/.test(host) && /\d/.test(host) && !host.includes(":")) {
    return { ok: false, reason: "Numeric IP encodings are not allowed; use a DNS name" };
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1" || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("::ffff:")) {
      return { ok: false, reason: "Private or reserved webhook addresses are not allowed" };
    }
    return { ok: true };
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    if (octets.some((o) => o > 255)) return { ok: false, reason: "Invalid webhook address" };
    const [a, b] = octets;
    const privateOrReserved = a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    if (privateOrReserved) return { ok: false, reason: "Private or reserved webhook addresses are not allowed" };
  }
  return { ok: true };
}

async function dispatchWebhook(env: Env, event: string, payload: Record<string, unknown>, _log?: Logger): Promise<void> {
  try {
    const hooks = await env.DB.prepare("SELECT * FROM webhooks WHERE enabled = 1 AND events LIKE ?").bind(`%${event}%`).all<any>();
    for (const hook of (hooks.results || [])) {
      const wBody = JSON.stringify({ event, payload, deliveredAt: now() });
      const signature = hook.secret ? await hmac(wBody, hook.secret) : "";
      const wHeaders: Record<string, string> = { "content-type": "application/json" };
      if (signature) wHeaders["x-osler-signature"] = signature;
      const doFire = async (attempt: number): Promise<void> => {
        try {
          const res = await fetch(hook.url, { method: "POST", headers: wHeaders, body: wBody });
          if (!res.ok && attempt < 3) {
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            return doFire(attempt + 1);
          }
        } catch {
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            return doFire(attempt + 1);
          }
        }
      };
      (async () => { try { await doFire(0); } catch {} })();
    }
  } catch (error: any) {
    const logger = _log || createLogger();
    logger.error("dispatchWebhook failed", { error: error.message, event });
  }
}

// ─── Maintenance cron ────────────────────────────────────────────────────────

async function cleanupStale(env: Env, _log?: Logger): Promise<void> {
  const log = _log || createLogger();
  try {
    const cutoff = now() - AUDIT_RETENTION_MS;
    const analyticsCutoff = now() - ANALYTICS_RETENTION_MS;
    await env.DB.batch([
      env.DB.prepare("PRAGMA foreign_keys = ON;"),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM auth_handoffs WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM email_verify_tokens WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").bind(now()),
      // Lockout rows past their lock window are dead weight - drop them.
      env.DB.prepare("DELETE FROM login_failures WHERE locked_until IS NOT NULL AND locked_until < ?").bind(now() - LOGIN_LOCKOUT_MS),
      env.DB.prepare("DELETE FROM admin_audit WHERE created_at < ?").bind(cutoff),
      // Email delivery log: 90 days of accountability, then drop.
      env.DB.prepare("DELETE FROM email_log WHERE created_at < ?").bind(now() - 90 * 24 * 60 * 60 * 1000),
    ]);
    // Telemetry tables live in the telemetry shard when bound (falls back to
    // the primary DB otherwise), so they are pruned in their own batch — a
    // D1 batch cannot span two databases.
    await ensureShardSchema(env, "telemetry");
    await telemetryDb(env).batch([
      // Permanent aggregate: recompute the last two days into analytics_daily
      // BEFORE the raw-event prune, so all-time statistics survive the 30-day
      // retention window (a missed cron run self-heals on the next one).
      telemetryDb(env).prepare(`INSERT INTO analytics_daily (day, event_type, events)
        SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, event_type, COUNT(*) AS events
        FROM analytics_events WHERE created_at >= ? GROUP BY day, event_type
        ON CONFLICT(day, event_type) DO UPDATE SET events = excluded.events`).bind(now() - 2 * 86_400_000),
      telemetryDb(env).prepare("DELETE FROM analytics_events WHERE created_at < ?").bind(analyticsCutoff),
      // Daily write-cap counters: keep ~90 days for trend debugging, then drop.
      telemetryDb(env).prepare("DELETE FROM daily_counters WHERE day < ?").bind(utcDateString(now() - 90 * 24 * 60 * 60 * 1000)),
      // Choice-stats respondent rows: only needed to dedup contributors;
      // past this window a contributor may legitimately count again. The
      // choice AGGREGATES in question_choice_stats are never pruned.
      telemetryDb(env).prepare("DELETE FROM question_choice_respondents WHERE created_at < ?").bind(now() - QBANK_STATS_RESPONDENT_RETENTION_MS),
    ]);
    log.info("cleanupStale completed");
  } catch (error: any) {
    log.error("cleanupStale failed", { error: error.message });
  }
}

// M3: Content scheduling — part of the cron handler
async function processScheduledContent(env: Env, _log?: Logger): Promise<void> {
  const log = _log || createLogger();
  try {
    const t = now();
    const toPublish = await env.DB.prepare(
      "SELECT * FROM content_objects WHERE scheduled_publish_at IS NOT NULL AND scheduled_publish_at <= ? AND status = 'draft'"
    ).bind(t).all<any>();
    for (const obj of (toPublish.results || [])) {
      await env.DB.prepare("UPDATE content_objects SET status = 'published', updated_at = ? WHERE id = ?").bind(t, obj.id).run();
      await auditLog(env, obj.created_by, "scheduled_publish", obj.id, { title: obj.title }, log);
      log.info("scheduled publish", { contentId: obj.id, title: obj.title });
    }
    const toUnpublish = await env.DB.prepare(
      "SELECT * FROM content_objects WHERE scheduled_unpublish_at IS NOT NULL AND scheduled_unpublish_at <= ? AND status = 'published'"
    ).bind(t).all<any>();
    for (const obj of (toUnpublish.results || [])) {
      await env.DB.prepare("UPDATE content_objects SET status = 'draft', updated_at = ? WHERE id = ?").bind(t, obj.id).run();
      await auditLog(env, obj.created_by, "scheduled_unpublish", obj.id, { title: obj.title }, log);
      log.info("scheduled unpublish", { contentId: obj.id, title: obj.title });
    }
  } catch (error: any) {
    log.error("processScheduledContent failed", { error: error.message });
  }
}

// ─── Admin helpers ───────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(["admin", "content_admin"]);

function isAdmin(session: SessionRow | null): boolean { return session?.user?.role === "admin"; }
function isAdminOrContent(session: SessionRow | null): boolean { return ADMIN_ROLES.has(session?.user?.role ?? ""); }

function adminPublicUser(user: UserRow) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, email: user.email ?? null, createdAt: user.created_at, updatedAt: user.updated_at ?? user.created_at };
}

/* R2 key helpers */
function r2Draft(base: string)     { return `${base}/draft.json`; }
function r2Pending(base: string)   { return `${base}/pending.json`; }
function r2Published(base: string) { return `${base}/published.json`; }

async function r2Get(env: Env, key: string): Promise<string | null> {
  if (!env.CONTENT) return null;
  const obj = await env.CONTENT.get(key);
  if (!obj) return null;
  return obj.text();
}

async function r2Put(env: Env, key: string, text: string, contentType = "application/json"): Promise<void> {
  if (!env.CONTENT) throw new Error("Content storage not configured");
  await env.CONTENT.put(key, text, { httpMetadata: { contentType } });
}

async function r2Delete(env: Env, key: string): Promise<void> {
  if (!env.CONTENT) return;
  await env.CONTENT.delete(key);
}

/** Delete every key under a managed base (content/<type>/<uuid>/), including
 *  the doc keys (draft/pending/published) and any images/ — so a delete never
 *  leaves orphaned managed objects behind. Returns the number of keys removed. */
async function deleteManagedBase(env: Env, base: string): Promise<number> {
  if (!env.CONTENT) return 0;
  let deleted = 0;
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const listed: any = await env.CONTENT.list({ prefix: base + "/", limit: 1000, cursor });
    if (!listed || !listed.objects) break;
    for (const o of listed.objects) {
      await env.CONTENT.delete(o.key);
      deleted += 1;
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return deleted;
}

const CONTENT_TYPE_TO_CATEGORY: Record<string, string> = {
  quiz: "qbank", bank: "qbank", written: "qbank", mixed: "qbank",
  flashcard: "flashcard", osce: "osce",
  library: "library", video: "videos",
};

/** Reverse of CONTENT_TYPE_TO_CATEGORY — for a given R2 content-files/
 *  category folder, which content_types might publish into it.
 *  Used by the unified browser's /by-r2-key lookup. */
const CATEGORY_TYPE_TO_TYPE: Record<string, string[]> = {
  qbank: ["quiz", "bank", "written", "mixed"],
  flashcard: ["flashcard"],
  osce: ["osce"],
  library: ["library"],
  videos: ["video"],
};

/** Last-resort fallback when adopt() can't infer contentType from the
 *  file extension or body shape — pick a sensible default per category. */
const CATEGORY_TO_DEFAULT_TYPE: Record<string, string | undefined> = {
  qbank: "quiz",
  flashcard: "flashcard",
  osce: "osce",
  library: "library",
  videos: "video",
};

function slugifyTitle(input: string): string {
  const s = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return s || "untitled";
}

const TYPE_CANONICAL_FILE: Record<string, string> = {
  quiz: "questions.json",
  bank: "passages.json",
  written: "prompts.json",
  mixed: "questions.json",
  flashcard: "cards.json",
  osce: "stations.json",
  video: "videos.json",
  library: "index.md",
};

async function hybridPublish(env: Env, obj: any, body: string, targetPath?: string | null): Promise<string[]> {
  if (!env.CONTENT) return [];
  const category = CONTENT_TYPE_TO_CATEGORY[obj.content_type] ?? obj.content_type;
  // Single source of truth for publish location: explicit targetPath >
  // stored target_path > derived "<slug>/<canonical-file>" (subfolder, never root).
  const explicit = typeof targetPath === "string" ? targetPath.trim().replace(/^\/+|\/+$/g, "") : "";
  const stored = typeof (obj as any).target_path === "string" ? (obj as any).target_path.trim().replace(/^\/+|\/+$/g, "") : "";
  const rawTarget = explicit || stored || "";
  const safePath = rawTarget.replace(/^\/+|\/+$/g, "");
  if (safePath.includes("..") || safePath.includes("\\")) throw new Error("Invalid targetPath");
  let fileSegment: string;
  let derived = false;
  if (safePath && /\.[a-z0-9]+$/i.test(safePath)) {
    fileSegment = safePath;
  } else if (safePath) {
    const fileName = TYPE_CANONICAL_FILE[obj.content_type] ?? (obj.content_type === "library" ? "index.md" : "content.json");
    fileSegment = safePath.replace(/\/+$/g, "") + "/" + fileName;
  } else {
    derived = true;
    const tail = obj.r2_key_base.split("/").pop() || "untitled";
    const rawTitle = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : tail;
    let slug = slugifyTitle(rawTitle);
    if (slug === "untitled") slug = `untitled-${tail.slice(0, 8).toLowerCase()}`;
    if (obj.content_type === "library") {
      fileSegment = `${slug}.md`;
    } else {
      const fileName = TYPE_CANONICAL_FILE[obj.content_type] ?? "content.json";
      fileSegment = `${slug}/${fileName}`;
    }
  }
  let r2Key = `content-files/${category}/${fileSegment}`;
  // Collision hardening: derived slug may clash with an existing published pack
  // (same title). Make it unique by appending short id, then persist the
  // resolved target for future publishes so the location is stable.
  if (derived) {
    try {
      const clash = await env.DB.prepare("SELECT id FROM content_objects WHERE published_r2_key = ? AND id != ?").bind(r2Key, obj.id).first<any>();
      if (clash) {
        const tail = obj.r2_key_base.split("/").pop() || "x";
        const suffix = tail.slice(0, 8).toLowerCase();
        if (obj.content_type === "library") {
          fileSegment = fileSegment.replace(/\.md$/, `-${suffix}.md`);
        } else {
          const parts = fileSegment.split("/");
          const slugPart = parts[0];
          fileSegment = `${slugPart}-${suffix}/${parts.slice(1).join("/")}`;
        }
        r2Key = `content-files/${category}/${fileSegment}`;
      }
    } catch {}
    const toStore = obj.content_type === "library" ? fileSegment : fileSegment.split("/").slice(0, -1).join("/");
    try {
      await env.DB.prepare("UPDATE content_objects SET target_path = ? WHERE id = ?").bind(toStore, obj.id).run();
      (obj as any).target_path = toStore;
    } catch {}
  }
  const ct = obj.content_type === "library" ? "text/markdown" : "application/json";
  await env.CONTENT.put(r2Key, body, { httpMetadata: { contentType: ct } });

  // Remember the student-facing key so the admin UI and adopt() can match
  // this object to its published file even when a custom targetPath was used
  // (the basename match only covers the default "<objectId>.json" shape).
  // Best-effort: a not-yet-migrated DB (missing the column) must not fail
  // the publish itself.
  try {
    await env.DB.prepare("UPDATE content_objects SET published_r2_key = ? WHERE id = ?").bind(r2Key, obj.id).run();
  } catch (e) {
    console.error("published_r2_key update failed:", e);
  }

  const hybridKeys: string[] = [r2Key];

  // ── Copy images (and any other asset files) from the draft's `images/`
  //    folder to the published location so they're reachable from the
  //    student-facing article/quiz. The student-side resolver looks them up
  //    at `<publishedDir>/images/<name>` (see src/lib/osler/articles.ts and
  //    src/lib/osler/richtext.ts). Drafts keep their images at
  //    `<r2_key_base>/images/<name>`, so we list those and copy each one to
  //    `content-files/<category>/<publishedDir>images/<name>`. We don't
  //    delete the draft copies — they're needed for re-publishing.
  try {
    const publishedDir = fileSegment.includes("/")
      ? fileSegment.slice(0, fileSegment.lastIndexOf("/") + 1)
      : "";
    const draftImagePrefix = `${obj.r2_key_base}/images/`;
    const publishedImagePrefix = `content-files/${category}/${publishedDir}images/`;
    // list() returns up to 1000 keys per page — we cap at 5000 to avoid a
    // pathological hot loop. Real content objects rarely have >50 images.
    const r2 = env.CONTENT;
    let cursor: string | undefined = undefined;
    for (let page = 0; page < 5; page++) {
      const listed: any = await r2.list({ prefix: draftImagePrefix, limit: 1000, cursor });
      const objects: any[] = listed?.objects || [];
      const validItems = objects.filter((item: any) => {
        const rel = String(item.key).slice(draftImagePrefix.length);
        return rel && !rel.endsWith("/");
      });
      const CHUNK_SIZE = 8;
      for (let i = 0; i < validItems.length; i += CHUNK_SIZE) {
        const chunk = validItems.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (item: any) => {
            const rel = String(item.key).slice(draftImagePrefix.length);
            const dstKey = publishedImagePrefix + rel;
            const src = await r2.get(item.key);
            if (!src) return;
            const buf = await src.arrayBuffer();
            const imgCt = guessImageContentType(rel);
            await r2.put(dstKey, buf, { httpMetadata: { contentType: imgCt } });
            hybridKeys.push(dstKey);
          })
        );
      }
      if (!listed.truncated) break;
      cursor = listed.cursor;
    }
  } catch (e) {
    // Image copy is best-effort — don't fail the publish if it errors.
    console.error("image copy failed:", e);
  }

  try {
    await updateManifestIncremental(env, category, [fileSegment]);
  } catch (e) {
    try { await regenerateManifestForCategory(env, category); } catch (e2) { console.error("manifest regen failed:", e2); }
  }
  return hybridKeys;
}

/** Helper for publishing a content object from MCP or API. */
async function publishContentObject(env: Env, objectId: string, reviewerId: string, targetPath?: string | null): Promise<{ ok: boolean; hybridKeys: string[] }> {
  if (!env.CONTENT) throw new Error("Content storage not configured");
  const obj = await env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(objectId).first<any>();
  if (!obj) throw new Error("Content object not found");
  const draft = (await r2Get(env, r2Draft(obj.r2_key_base))) ?? (await r2Get(env, r2Pending(obj.r2_key_base)));
  if (!draft) throw new Error("Draft content is empty");
  await r2Put(env, r2Published(obj.r2_key_base), draft);
  if (targetPath) {
    try {
      await env.DB.prepare("UPDATE content_objects SET target_path = ? WHERE id = ?").bind(targetPath, objectId).run();
      obj.target_path = targetPath;
    } catch {}
  }
  const hybridKeys = await hybridPublish(env, obj, draft, targetPath);
  await env.DB.prepare("UPDATE content_objects SET status = 'published', reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?")
    .bind(reviewerId, now(), now(), objectId)
    .run();
  return { ok: true, hybridKeys };
}

/** Helper for unpublishing a content object from MCP or API. */
async function unpublishContentObject(env: Env, objectId: string, actorId: string): Promise<{ ok: boolean }> {
  const obj = await env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(objectId).first<any>();
  if (!obj) throw new Error("Content object not found");
  const staleKey = obj.published_r2_key;
  if (staleKey && env.CONTENT) {
    try { await env.CONTENT.delete(staleKey); } catch (e) { console.error("unpublish r2 cleanup failed:", e); }
  }
  await env.DB.prepare("UPDATE content_objects SET status = 'draft', published_r2_key = NULL, updated_at = ? WHERE id = ?").bind(now(), objectId).run();
  if (staleKey && staleKey.startsWith("content-files/")) {
    const rel = staleKey.slice("content-files/".length);
    const cat = rel.split("/")[0];
    if (cat && cat in CATEGORY_TYPE_MAP) {
      try { await updateManifestIncremental(env, cat, [rel]); } catch (e) { console.error("manifest regen failed:", e); }
    }
  }
  return { ok: true };
}

/** Helper for deleting a content object from MCP or API. */
async function deleteContentObject(env: Env, objectId: string, actorId: string): Promise<{ ok: boolean }> {
  const obj = await env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(objectId).first<any>();
  if (!obj) throw new Error("Content object not found");
  const pubKey = obj.published_r2_key;
  if (obj.r2_key_base) await deleteManagedBase(env, obj.r2_key_base);
  if (pubKey && env.CONTENT) {
    try { await env.CONTENT.delete(pubKey); } catch (e) { console.error("delete r2 cleanup failed:", e); }
  }
  await env.DB.prepare("DELETE FROM content_objects WHERE id = ?").bind(objectId).run();
  if (pubKey && pubKey.startsWith("content-files/")) {
    const rel = pubKey.slice("content-files/".length);
    const cat = rel.split("/")[0];
    if (cat && cat in CATEGORY_TYPE_MAP) {
      try { await updateManifestIncremental(env, cat, [rel]); } catch (e) { console.error("manifest regen failed:", e); }
    }
  }
  return { ok: true };
}

/** Map a file extension to a Content-Type for binary assets uploaded via
 *  the admin API. Used by hybridPublish() when copying draft images to the
 *  published keyspace. Mirrors the table in /v1/admin/content/upload-file. */
function guessImageContentType(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "json": return "application/json";
    case "md": return "text/markdown; charset=utf-8";
    case "html":
    case "htm": return "text/html; charset=utf-8";
    case "svg": return "image/svg+xml";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "bmp": return "image/bmp";
    case "ico": return "image/x-icon";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

const ASSET_FOLDERS = new Set(["images", "assets"]);
/** Library article sidecar metadata (`<article>.meta.json`) — client-merged
 *  over frontmatter; excluded from manifests and the backfill walk. */
function isArticleMetaFileName(name: string): boolean {
  return /\.meta\.json$/i.test(name);
}
const CATEGORY_TYPE_MAP: Record<string, string | null> = { qbank: null, flashcard: "flashcard", osce: "osce", library: "library", videos: "video" };
const FILE_TYPE_KEYS: Record<string, string> = { questions: "quiz", passages: "bank", prompts: "written", cards: "flashcard", videos: "video", stations: "osce" };

function inferTypeFromFileName(files: string[]): string | null {
  for (const f of files) {
    const base = f.replace(/\.[^.]+$/, "");
    if (FILE_TYPE_KEYS[base]) return FILE_TYPE_KEYS[base];
  }
  return null;
}

async function inferTypeFromContent(env: Env, category: string, folderPath: string, files: string[]): Promise<string | null> {
  for (const f of files.filter((n) => n.endsWith(".json"))) {
    try {
      const obj = await env.CONTENT!.get(`content-files/${category}/${folderPath ? `${folderPath}/` : ""}${f}`);
      if (!obj) continue;
      const data = JSON.parse(await obj.text()) as Record<string, any>;
      const hasMcq = (Array.isArray(data.questions) && data.questions.length > 0) ||
        (Array.isArray(data.passages) && data.passages.length > 0);
      const hasWritten = Array.isArray(data.prompts) && data.prompts.length > 0;
      if (hasMcq && hasWritten) return "mixed";
      if (Array.isArray(data.questions) && data.questions.length) return "quiz";
      if (Array.isArray(data.passages) && data.passages.length) return "bank";
      if (Array.isArray(data.prompts) && data.prompts.length) return "written";
      if (Array.isArray(data.cards) && data.cards.length) return "flashcard";
      if (Array.isArray(data.stations) && data.stations.length) return "osce";
      if (Array.isArray(data.videos) && data.videos.length) return "video";
    } catch {}
  }
  return null;
}

function sanitizeSeg(s: string): string { return s.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || s; }
function buildUid(type: string, segments: string[]): string { return [type, ...segments.map(sanitizeSeg)].filter(Boolean).join("-"); }

async function manifestMetadataForFiles(env: Env, category: string, folderPath: string, files: string[]) {
  let questionCount = 0;
  let itemCount = files.filter((file) => !file.endsWith(".json")).length;
  let description: string | undefined;
  let lang: "en" | "ar" | undefined;
  const tags = new Set<string>();

  // OSCE station summary — captures id/title/specialty/difficulty/type/time so
  // the lobby can render pack cards from the manifest alone, mirroring the
  // local generator (scripts/generate-content-manifests.js). Excludes patient
  // profiles, rubrics, and hidden info so the manifest stays small.
  const stationSummary: any[] = [];
  const stationSpecialties = new Set<string>();
  const stationDifficulties = new Set<string>();
  const stationTypes = new Set<string>();
  let stationTimeMax = 0;

  for (const file of files.filter((name) => name.endsWith(".json"))) {
    try {
      const object = await env.CONTENT!.get(`content-files/${category}/${folderPath ? `${folderPath}/` : ""}${file}`);
      if (!object) continue;
      const data = JSON.parse(await object.text()) as Record<string, any>;
      const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
      if (!description && typeof meta.description === "string") description = meta.description;
      if (!lang && (meta.lang === "en" || meta.lang === "ar")) lang = meta.lang;
      for (const key of Object.keys(FILE_TYPE_KEYS)) {
        const entries = Array.isArray(data[key]) ? data[key] : [];
        itemCount += entries.length;
        questionCount += key === "passages"
          ? entries.reduce((count: number, passage: any) => count + (Array.isArray(passage?.questions) ? passage.questions.length : 1), 0)
          : entries.length;
        for (const entry of entries) {
          if (!Array.isArray(entry?.tags)) continue;
          for (const tag of entry.tags) if (typeof tag === "string" && tag.trim()) tags.add(tag.trim());
        }

        // OSCE: collect a per-station preview and derive tags/description.
        if (key === "stations") {
          for (const station of entries) {
            if (!station || typeof station !== "object") continue;
            const id = typeof station.id === "string" ? station.id : undefined;
            const title = typeof station.title === "string" ? station.title : undefined;
            const specialty = typeof station.specialty === "string" ? station.specialty : undefined;
            const difficulty = typeof station.difficulty === "string" ? station.difficulty : undefined;
            const type = typeof station.type === "string" ? station.type : undefined;
            const time = typeof station.time === "number" ? station.time : undefined;
            if (specialty) stationSpecialties.add(specialty);
            if (difficulty) stationDifficulties.add(difficulty);
            if (type) stationTypes.add(type);
            if (typeof time === "number" && time > stationTimeMax) stationTimeMax = time;
            stationSummary.push({ id, title, specialty, difficulty, type, time });
          }
        }
      }
    } catch {
      // A malformed pack must not prevent the admin from rebuilding other entries.
    }
  }

  // OSCE packs: derive a description from specialties if none was set on meta.
  if (!description && stationSummary.length > 0) {
    const sp = [...stationSpecialties].sort();
    if (sp.length > 0) {
      description = `${stationSummary.length} station${stationSummary.length === 1 ? "" : "s"} · ${sp.join(", ")}`;
    }
  }
  // OSCE packs: surface specialties/types as tag chips so the lobby can show
  // filterable metadata without loading the pack body.
  if (stationSummary.length > 0) {
    for (const sp of stationSpecialties) if (typeof sp === "string" && sp.trim()) tags.add(sp.trim());
    for (const tp of stationTypes) if (typeof tp === "string" && tp.trim()) tags.add(tp.trim());
  }

  const result: Record<string, any> = {
    questionCount,
    itemCount,
    ...(description ? { description } : {}),
    ...(lang ? { lang } : {}),
    ...(tags.size ? { tags: [...tags].sort() } : {}),
  };
  if (stationSummary.length > 0) {
    result.stationSummary = stationSummary;
    result.stationSpecialties = [...stationSpecialties].sort();
    result.stationDifficulties = [...stationDifficulties].sort();
    result.stationTypes = [...stationTypes].sort();
    if (stationTimeMax > 0) result.stationTimeMax = stationTimeMax;
  }
  return result;
}

/* ── Content versioning ──
 * Every manifest write bumps a tiny version document. Students poll
 * GET /v1/content-version (served no-store, ~40 bytes) and cache-bust their
 * manifest requests with ?v=<version>, so a publish is picked up on the next
 * hub load instead of whenever the old max-age expires. Monotonic per-isolate
 * epoch ms — two writes in the same millisecond collapse to one version,
 * which is harmless because they'd ship near-identical manifests. */
const CONTENT_VERSION_KEY = "content-manifests/version.json";
let memoryCachedContentVersion: { version: string | null; cachedAt: number } | null = null;

async function readContentVersion(env: Env): Promise<string | null> {
  if (!env.CONTENT) return null;
  const now = Date.now();
  if (memoryCachedContentVersion && now - memoryCachedContentVersion.cachedAt < 10_000) {
    return memoryCachedContentVersion.version;
  }
  try {
    const obj = await env.CONTENT.get(CONTENT_VERSION_KEY);
    if (!obj) {
      memoryCachedContentVersion = { version: null, cachedAt: now };
      return null;
    }
    const parsed = JSON.parse(await obj.text()) as { version?: unknown };
    const ver = typeof parsed.version === "string" ? parsed.version : null;
    memoryCachedContentVersion = { version: ver, cachedAt: now };
    return ver;
  } catch {
    return null;
  }
}

/** Writes a fresh version stamp and returns it; best-effort, never throws. */
async function bumpContentVersion(env: Env): Promise<string> {
  const version = `${Date.now()}`;
  memoryCachedContentVersion = { version, cachedAt: Date.now() };
  if (!env.CONTENT) return version;
  try {
    await env.CONTENT.put(CONTENT_VERSION_KEY, JSON.stringify({ version, updatedAt: Date.now() }), {
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    });
  } catch (e) {
    console.error("content version bump failed:", e);
  }
  return version;
}

async function regenerateManifestForCategory(env: Env, category: string): Promise<any> {
  if (!env.CONTENT) return null;
  const prefix = `content-files/${category}/`;
  const keys: string[] = [];
  // list() returns at most 1000 keys per page — a category with more files
  // than that would silently drop entries from the manifest if we only
  // fetched the first page. Page through the keyspace; each page is one
  // subrequest and Workers Free allows 50 per invocation, so cap at 10 pages
  // (10k keys) and let the caller re-invoke for larger keyspaces.
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const listed: any = await env.CONTENT.list({ prefix, limit: 1000, cursor });
    if (!listed || !listed.objects) return null;
    keys.push(...listed.objects.map((o: any) => o.key));
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  const folders = new Map<string, { files: string[]; images: string[] }>();
  for (const fullKey of keys) {
    const rel = fullKey.slice(prefix.length);
    if (!rel) continue;
    const parts = rel.split("/");
    const file = parts.pop();
    const folderPath = parts.join("/");
    if (!folders.has(folderPath)) folders.set(folderPath, { files: [], images: [] });
    const f = folders.get(folderPath)!;
    if (file) {
      if (isArticleMetaFileName(file)) {
        // Library article sidecar metadata — merged client-side over
        // frontmatter, never listed as a content data file.
      } else if (file.toLowerCase().endsWith(".json") || file.toLowerCase().endsWith(".md") || file.toLowerCase().endsWith(".html") || file.toLowerCase().endsWith(".pdf")) {
        f.files.push(file);
      } else if (file.match(/\.(png|jpe?g|gif|svg|webp|avif|bmp|mp3|m4a|mp4)$/i)) {
        f.images.push(file);
      }
    }
  }
  for (const path of [...folders.keys()]) {
    const seg = path.split("/").pop();
    if (!seg || !ASSET_FOLDERS.has(seg)) continue;
    // Roll the asset folder's files up into its parent pack so the manifest
    // keeps `images` for packs that ship an `images/` subfolder (mirrors the
    // local generator in scripts/generate-content-manifests.js). Without this,
    // admin-published packs lose their precache URLs.
    const info = folders.get(path)!;
    const parentPath = path.slice(0, path.length - seg.length - 1);
    const parent = folders.get(parentPath);
    if (parent) parent.images.push(...info.images);
    folders.delete(path);
  }
  const parentType = CATEGORY_TYPE_MAP[category] || null;
  const nodes = new Map<string, any>();
  for (const [fp, info] of folders.entries()) {
    const byName = parentType || inferTypeFromFileName(info.files);
    const byContent = !byName && category === "qbank" ? await inferTypeFromContent(env, category, fp, info.files) : null;
    const inferredType = byName || byContent || "quiz";
    // Uid = <type>-<segments> (no category prefix) — must match the local
    // manifest generator (scripts/generate-content-manifests.js) and its Rust
    // port (tauri-admin/src/manifest.rs) so progress/cache keys stay stable
    // across sources.
    const segments = fp ? fp.split("/") : [];
    const uid = buildUid(inferredType, segments);
    const files = info.files.sort();
    nodes.set(fp, {
      uid,
      title: fp ? fp.split("/").pop()!.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : category,
      type: inferredType,
      path: fp ? `${fp}/` : "",
      files,
      images: info.images.sort(),
      items: [],
      packCount: 1,
      ...(await manifestMetadataForFiles(env, category, fp, files)),
    });
  }
  // Synthesize branch nodes for pure grouping folders. `folders` only records
  // paths that directly contain data files, so an intermediate folder like
  // "medical-board-review" (subfolders only, no direct JSON) would otherwise
  // have no node and its children would flatten to the category root. The
  // local generator (scripts/generate-content-manifests.js) and its Rust port
  // (tauri-admin/src/manifest.rs) both emit branch nodes whenever a folder has
  // subfolders — mirror that here so an R2 upload of a nested pack preserves
  // the parent deck.
  for (const fp of [...nodes.keys()]) {
    const parts = fp.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const branchPath = parts.slice(0, depth).join("/");
      if (nodes.has(branchPath)) continue;
      const branchType = parentType || inferTypeFromFileName(folders.get(branchPath)?.files || []) || "quiz";
      nodes.set(branchPath, {
        uid: buildUid(branchType, parts.slice(0, depth)),
        title: parts[depth - 1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type: branchType,
        path: `${branchPath}/`,
        files: [],
        images: [],
        items: [],
      });
    }
  }
  const roots: any[] = [];
  for (const [fp, node] of nodes.entries()) {
    if (!fp) { roots.push(node); continue; }
    const parent = fp.includes("/") ? fp.slice(0, fp.lastIndexOf("/")) : "";
    if (nodes.has(parent)) {
      nodes.get(parent)!.items.push(node);
    } else {
      roots.push(node);
    }
  }
  const summarizeNode = (node: any): { questionCount: number; itemCount: number; packCount: number } => {
    node.items.sort((a: any, b: any) => a.title.localeCompare(b.title));
    if (node.items.length === 0) return node;
    // Roll up OSCE station-summary fields so a branch folder (e.g. a
    // specialty with multiple OSCE sub-packs) can render a card from the
    // manifest alone — mirrors scripts/generate-content-manifests.js.
    const summary = node.items.reduce(
      (total: { questionCount: number; itemCount: number; packCount: number; stationSummary: any[]; stationSpecialties: Set<string>; stationDifficulties: Set<string>; stationTypes: Set<string>; stationTimeMax: number }, child: any) => {
        const childSummary = summarizeNode(child);
        return {
          questionCount: total.questionCount + childSummary.questionCount,
          itemCount: total.itemCount + childSummary.itemCount,
          packCount: total.packCount + childSummary.packCount,
          stationSummary: total.stationSummary.concat(Array.isArray(child.stationSummary) ? child.stationSummary : []),
          stationSpecialties: new Set([...total.stationSpecialties, ...(child.stationSpecialties ?? [])]),
          stationDifficulties: new Set([...total.stationDifficulties, ...(child.stationDifficulties ?? [])]),
          stationTypes: new Set([...total.stationTypes, ...(child.stationTypes ?? [])]),
          stationTimeMax: Math.max(total.stationTimeMax, child.stationTimeMax ?? 0),
        };
      },
      { questionCount: 0, itemCount: 0, packCount: 0, stationSummary: [], stationSpecialties: new Set<string>(), stationDifficulties: new Set<string>(), stationTypes: new Set<string>(), stationTimeMax: 0 },
    );
    Object.assign(node, summary);
    if (summary.stationSummary.length > 0) {
      node.stationSummary = summary.stationSummary;
      node.stationSpecialties = [...summary.stationSpecialties].sort();
      node.stationDifficulties = [...summary.stationDifficulties].sort();
      node.stationTypes = [...summary.stationTypes].sort();
      if (summary.stationTimeMax > 0) node.stationTimeMax = summary.stationTimeMax;
    }
    return summary;
  };
  for (const root of roots) summarizeNode(root);
  const manifest = {
    type: parentType || (roots.length > 0 ? roots[0].type : "quiz"),
    items: roots.sort((a, b) => a.title.localeCompare(b.title)),
    version: await bumpContentVersion(env),
  };
  await env.CONTENT.put(`content-manifests/${category}/manifest.json`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return manifest;
}

/**
 * Smart incremental manifest updater: updates or prunes specific folder nodes in
 * the category manifest without full keyspace re-scanning.
 * Automatically runs after any content mutation so admins never need to manually rebuild.
 */
async function updateManifestIncremental(env: Env, category: string, touchedPaths?: string[]): Promise<any> {
  if (!env.CONTENT) return null;
  if (!touchedPaths || touchedPaths.length === 0) {
    return regenerateManifestForCategory(env, category);
  }
  const manifestKey = `content-manifests/${category}/manifest.json`;
  const existingObj = await env.CONTENT.get(manifestKey);
  if (!existingObj) return regenerateManifestForCategory(env, category);
  let manifest: any;
  try {
    manifest = JSON.parse(await existingObj.text());
  } catch {
    return regenerateManifestForCategory(env, category);
  }
  if (!manifest || !Array.isArray(manifest.items)) return regenerateManifestForCategory(env, category);

  const parentType = CATEGORY_TYPE_MAP[category] || null;

  // Flatten existing tree into a map of path -> node
  const flatNodes = new Map<string, any>();
  const collectNodes = (nodeList: any[]) => {
    for (const n of nodeList) {
      const p = n.path ? n.path.replace(/\/$/, "") : "";
      flatNodes.set(p, n);
      if (Array.isArray(n.items)) collectNodes(n.items);
    }
  };
  collectNodes(manifest.items);

  // Normalize touched folder paths
  const targetFolders = new Set<string>();
  for (const raw of touchedPaths) {
    let clean = raw.trim().replace(/^\/+|\/+$/g, "");
    if (clean.startsWith(`content-files/${category}/`)) {
      clean = clean.slice(`content-files/${category}/`.length);
    } else if (clean.startsWith(`${category}/`)) {
      clean = clean.slice(`${category}/`.length);
    }
    if (clean.includes(".")) {
      const slash = clean.lastIndexOf("/");
      clean = slash >= 0 ? clean.slice(0, slash) : "";
    }
    targetFolders.add(clean);
  }

  for (const fp of targetFolders) {
    const prefix = fp ? `content-files/${category}/${fp}/` : `content-files/${category}/`;
    const listed: any = await env.CONTENT.list({ prefix, limit: 1000 });
    const keys: string[] = (listed?.objects || []).map((o: any) => o.key);

    const directFiles: string[] = [];
    const directImages: string[] = [];
    for (const k of keys) {
      const rel = k.slice(prefix.length);
      if (!rel) continue;
      if (rel.startsWith("images/") || rel.startsWith("assets/")) {
        const imgName = rel.split("/").pop();
        if (imgName) directImages.push(imgName);
      } else if (!rel.includes("/")) {
        if (!isArticleMetaFileName(rel)) {
          if (rel.match(/\.(json|md|html|htm|pdf)$/i)) directFiles.push(rel);
          else if (rel.match(/\.(png|jpe?g|gif|svg|webp|avif|bmp|mp3|m4a|mp4)$/i)) directImages.push(rel);
        }
      }
    }

    if (directFiles.length > 0) {
      const byName = parentType || inferTypeFromFileName(directFiles);
      const byContent = !byName && category === "qbank" ? await inferTypeFromContent(env, category, fp, directFiles) : null;
      const inferredType = byName || byContent || "quiz";
      const segments = fp ? fp.split("/") : [];
      const uid = buildUid(inferredType, segments);
      const metadata = await manifestMetadataForFiles(env, category, fp, directFiles);

      let existing = flatNodes.get(fp);
      if (!existing) {
        existing = {
          uid,
          title: fp ? fp.split("/").pop()!.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : category,
          type: inferredType,
          path: fp ? `${fp}/` : "",
          files: directFiles.sort(),
          images: directImages.sort(),
          items: [],
          packCount: 1,
          ...metadata,
        };
        flatNodes.set(fp, existing);
      } else {
        existing.uid = uid;
        existing.type = inferredType;
        existing.files = directFiles.sort();
        existing.images = directImages.sort();
        existing.packCount = 1;
        Object.assign(existing, metadata);
      }
    } else {
      const existing = flatNodes.get(fp);
      if (existing && (!existing.items || existing.items.length === 0)) {
        flatNodes.delete(fp);
      }
    }
  }

  // Ensure intermediate branch folders exist for all paths
  for (const fp of [...flatNodes.keys()]) {
    if (!fp) continue;
    const parts = fp.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const branchPath = parts.slice(0, depth).join("/");
      if (flatNodes.has(branchPath)) continue;
      const branchType = parentType || "quiz";
      flatNodes.set(branchPath, {
        uid: buildUid(branchType, parts.slice(0, depth)),
        title: parts[depth - 1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type: branchType,
        path: `${branchPath}/`,
        files: [],
        images: [],
        items: [],
      });
    }
  }

  // Rebuild tree
  for (const n of flatNodes.values()) n.items = [];
  const roots: any[] = [];
  for (const [fp, node] of flatNodes.entries()) {
    if (!fp) { roots.push(node); continue; }
    const parent = fp.includes("/") ? fp.slice(0, fp.lastIndexOf("/")) : "";
    if (flatNodes.has(parent)) {
      flatNodes.get(parent)!.items.push(node);
    } else {
      roots.push(node);
    }
  }

  const summarizeNode = (node: any): { questionCount: number; itemCount: number; packCount: number } => {
    node.items.sort((a: any, b: any) => a.title.localeCompare(b.title));
    if (node.items.length === 0) return node;
    const summary = node.items.reduce(
      (total: any, child: any) => {
        const childSummary = summarizeNode(child);
        return {
          questionCount: total.questionCount + (childSummary.questionCount || 0),
          itemCount: total.itemCount + (childSummary.itemCount || 0),
          packCount: total.packCount + (childSummary.packCount || 0),
          stationSummary: total.stationSummary.concat(Array.isArray(child.stationSummary) ? child.stationSummary : []),
          stationSpecialties: new Set([...total.stationSpecialties, ...(child.stationSpecialties ?? [])]),
          stationDifficulties: new Set([...total.stationDifficulties, ...(child.stationDifficulties ?? [])]),
          stationTypes: new Set([...total.stationTypes, ...(child.stationTypes ?? [])]),
          stationTimeMax: Math.max(total.stationTimeMax, child.stationTimeMax ?? 0),
        };
      },
      { questionCount: 0, itemCount: 0, packCount: 0, stationSummary: [], stationSpecialties: new Set<string>(), stationDifficulties: new Set<string>(), stationTypes: new Set<string>(), stationTimeMax: 0 }
    );
    Object.assign(node, summary);
    if (summary.stationSummary.length > 0) {
      node.stationSummary = summary.stationSummary;
      node.stationSpecialties = [...summary.stationSpecialties].sort();
      node.stationDifficulties = [...summary.stationDifficulties].sort();
      node.stationTypes = [...summary.stationTypes].sort();
      if (summary.stationTimeMax > 0) node.stationTimeMax = summary.stationTimeMax;
    }
    return summary;
  };

  for (const root of roots) summarizeNode(root);
  const updatedManifest = {
    type: parentType || (roots.length > 0 ? roots[0].type : "quiz"),
    items: roots.sort((a, b) => a.title.localeCompare(b.title)),
    version: await bumpContentVersion(env),
  };
  await env.CONTENT.put(manifestKey, JSON.stringify(updatedManifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return updatedManifest;
}

/* Content validators */
function validateContent(contentType: string, parsed: any): string[] {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== "object") return ["Content must be a JSON object"];
  const vid = (v: any) => typeof v === "string" && v.trim().length > 0;
  if (contentType === "quiz") {
    const qs = parsed.questions;
    if (!Array.isArray(qs)) return ["quiz: `questions` array required"];
    qs.forEach((q: any, i: number) => {
      const p = `questions[${i}]`;
      if (!vid(q.id)) errors.push(`${p}: id required`);
      if (typeof q.question !== "string" || !q.question.trim()) errors.push(`${p}: question text required`);
      if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${p}: at least 2 options required`);
      if (typeof q.correct !== "number" || q.correct < 0 || q.correct >= (q.options?.length ?? 0)) errors.push(`${p}: correct index out of bounds`);
    });
  } else if (contentType === "bank") {
    const ps = parsed.passages;
    if (!Array.isArray(ps)) return ["bank: `passages` array required"];
    ps.forEach((p: any, i: number) => {
      const prefix = `passages[${i}]`;
      if (!vid(p.id)) errors.push(`${prefix}: id required`);
      if (typeof p.content !== "string" || !p.content.trim()) errors.push(`${prefix}: content required`);
      if (!Array.isArray(p.questions)) errors.push(`${prefix}: questions array required`);
    });
  } else if (contentType === "written") {
    const ps = parsed.prompts;
    if (!Array.isArray(ps)) return ["written: `prompts` array required"];
    ps.forEach((p: any, i: number) => {
      const prefix = `prompts[${i}]`;
      if (!vid(p.id)) errors.push(`${prefix}: id required`);
      if (typeof p.prompt !== "string" || !p.prompt.trim()) errors.push(`${prefix}: prompt required`);
      if (!Array.isArray(p.rubric)) errors.push(`${prefix}: rubric array required`);
    });
  } else if (contentType === "mixed") {
    const qs = Array.isArray(parsed.questions) ? parsed.questions : [];
    const ps = Array.isArray(parsed.passages) ? parsed.passages : [];
    const ws = Array.isArray(parsed.prompts) ? parsed.prompts : [];
    if (qs.length === 0 && ps.length === 0 && ws.length === 0) {
      return ["mixed: at least one of `questions`, `passages`, or `prompts` is required"];
    }
    const hasMcq = qs.length > 0 || ps.length > 0;
    if (!hasMcq || ws.length === 0) {
      errors.push("mixed: needs both MCQ content (`questions` and/or `passages`) and written `prompts`");
    }
    qs.forEach((q: any, i: number) => {
      const p = `questions[${i}]`;
      if (!vid(q.id)) errors.push(`${p}: id required`);
    });
    ws.forEach((p: any, i: number) => {
      const prefix = `prompts[${i}]`;
      if (!vid(p.id)) errors.push(`${prefix}: id required`);
      if (typeof p.prompt !== "string" || !p.prompt.trim()) errors.push(`${prefix}: prompt required`);
    });
    if (parsed.chapters !== undefined && !Array.isArray(parsed.chapters)) {
      errors.push("mixed: `chapters` must be an array when present");
    }
  } else if (contentType === "flashcard") {
    const cs = parsed.cards;
    if (!Array.isArray(cs)) return ["flashcard: `cards` array required"];
    cs.forEach((c: any, i: number) => {
      const prefix = `cards[${i}]`;
      if (!vid(c.id)) errors.push(`${prefix}: id required`);
      const t = c.type || "basic";
      if (t === "cloze") {
        if (typeof c.text !== "string" || !c.text.trim()) errors.push(`${prefix}: cloze card requires text`);
      } else {
        if (typeof c.front !== "string" || !c.front.trim()) errors.push(`${prefix}: front required`);
        if (typeof c.back !== "string" || !c.back.trim()) errors.push(`${prefix}: back required`);
      }
    });
  } else if (contentType === "osce") {
    const ss = parsed.stations;
    if (!Array.isArray(ss)) return ["osce: `stations` array required"];
    ss.forEach((s: any, i: number) => {
      const p = `stations[${i}]`;
      if (!vid(s.id)) errors.push(`${p}: id required`);
      if (typeof s.title !== "string" || !s.title.trim()) errors.push(`${p}: title required`);
      if (typeof s.task !== "string" || !s.task.trim()) errors.push(`${p}: task required`);
      if (typeof s.time !== "number" || s.time <= 0) errors.push(`${p}: time (minutes) required`);
      if (!s.patient || typeof s.patient !== "object") errors.push(`${p}: patient object required`);
      if (!s.hiddenProfile || typeof s.hiddenProfile !== "object") errors.push(`${p}: hiddenProfile object required`);
      if (!s.rubric || typeof s.rubric !== "object") errors.push(`${p}: rubric object required`);
      if (s.type && s.type !== "history" && s.type !== "data-interp") errors.push(`${p}: type must be "history" or "data-interp"`);
      if (s.type === "data-interp" && (!s.dataPresented || typeof s.dataPresented !== "object")) errors.push(`${p}: data-interp stations require a dataPresented object`);
    });
  } else if (contentType === "video") {
    const vs = parsed.videos;
    if (!Array.isArray(vs)) return ["video: `videos` array required"];
    vs.forEach((v: any, i: number) => {
      const p = `videos[${i}]`;
      if (!vid(v.id)) errors.push(`${p}: id required`);
      if (typeof v.title !== "string" || !v.title.trim()) errors.push(`${p}: title required`);
      if (!v.source || typeof v.source !== "object") errors.push(`${p}: source object required`);
      if (v.source.type === "youtube") {
        if (typeof v.source.id !== "string" || v.source.id.length < 8 || v.source.id.length > 32) errors.push(`${p}: youtube source.id (8-32 chars) required`);
      } else if (v.source.type === "mp4" || v.source.type === "hls") {
        if (typeof v.source.url !== "string" || !v.source.url.startsWith("http")) errors.push(`${p}: ${v.source.type}.url required`);
      } else {
        errors.push(`${p}: source.type must be youtube|mp4|hls`);
      }
    });
  } else if (contentType === "library") {}
  return errors;
}
/* ── Search handler (M8) ── */
async function handleSearch(request: Request, env: Env, session: Session, log: Logger): Promise<Response> {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q || q.length < 2) return json({ error: "Query must be at least 2 characters" }, 400, "", log);
  const types = (new URL(request.url).searchParams.get("types") || "content,users,audit").split(",");
  const results: Record<string, any[]> = {};
  const like = `%${escapeLike(q)}%`;
  const queries: Array<Promise<void>> = [];
  if (types.includes("content")) {
    queries.push((async () => {
      const rows = await env.DB.prepare("SELECT id as uid, title, content_type as type, status, updated_at FROM content_objects WHERE title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 20").bind(like, like).all();
      results.content = rows.results || [];
    })());
  }
  if (types.includes("users")) {
    queries.push((async () => {
      const rows = await env.DB.prepare("SELECT id, username, display_name, role, created_at FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 20").bind(like, like, like).all();
      results.users = rows.results || [];
    })());
  }
  if (types.includes("audit")) {
    queries.push((async () => {
      const rows = await env.DB.prepare("SELECT a.id, a.action, a.target_id, a.created_at, u.username as actor_username FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action LIKE ? ESCAPE '\\' OR a.target_id LIKE ? ESCAPE '\\' ORDER BY a.created_at DESC LIMIT 20").bind(like, like).all();
      results.audit = rows.results || [];
    })());
  }
  await Promise.all(queries);
  return json(results, 200, "", log);
}

/* ── Analytics helpers ── */

const ANALYTICS_VALID_EVENT_TYPES = new Set([
  "page_view", "web_vital", "js_error", "api_call", "route_change",
]);
const ANALYTICS_VALID_METRICS = new Set([
  "LCP", "INP", "CLS", "TTFB", "FCP", "FID",
]);
const ANALYTICS_VALID_BROWSERS = new Set([
  "chrome", "firefox", "safari", "edge", "opera", "samsung", "other",
]);
const ANALYTICS_VALID_DEVICES = new Set([
  "mobile", "tablet", "desktop", "other",
]);
const ANALYTICS_VALID_CONNECTIONS = new Set([
  "4g", "3g", "2g", "slow-2g", "unknown",
]);

// ── Global daily write caps (DoS protection for D1 quota) ──
//
// The D1 free tier allows 100,000 rows written per day ACCOUNT-WIDE
// (shared by auth, sync, content, and analytics across every D1 database
// on the account — splitting into shards does not multiply it). Telemetry
// that ignored caps could exhaust this in minutes, taking down auth, sync,
// and content management with it. Two flows are capped per day:
//   analytics — ANALYTICS_DAILY_WRITE_CAP rows
//   qstats    — QBANK_STATS_DAILY_WRITE_CAP row writes
// Together with the uncapped-but-bounded sync/auth writes, a ~1000-MAU
// deployment stays inside the budget (see README "Free-tier capacity").
//
// Implementation: a per-day counter row in `daily_counters`, bumped in the
// SAME D1 batch that writes the telemetry rows (1 extra row write per
// ingest), so the guard check itself is a 1-row point read cached 60s per
// isolate — never a COUNT(*) scan over the events table, which at 30-day
// retention would read hundreds of thousands of rows per check and blow
// D1's 5M rows-read/day budget.

let dailyCounterCache: Record<string, { day: string; n: number; checkedAt: number }> = {};
const DAILY_CAP_CACHE_TTL_MS = 60_000;

/** Returns the UTC date string (YYYY-MM-DD) for the given epoch ms. */
function utcDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** True while the named counter is under its daily cap. Point-reads the
 *  counter row, cached per isolate; a DB error allows the write (the
 *  per-IP / per-user rate limits still apply). */
async function dailyWriteCountOk(env: Env, name: string, cap: number): Promise<boolean> {
  const t = now();
  const day = utcDateString(t);
  const cached = dailyCounterCache[name];
  if (cached && cached.day === day && t - cached.checkedAt < DAILY_CAP_CACHE_TTL_MS) {
    return cached.n < cap;
  }
  try {
    const row = await telemetryDb(env).prepare("SELECT n FROM daily_counters WHERE name = ? AND day = ?")
      .bind(name, day)
      .first<{ n: number }>();
    dailyCounterCache[name] = { day, n: row?.n ?? 0, checkedAt: t };
    return (row?.n ?? 0) < cap;
  } catch {
    return true;
  }
}

/** Optimistically add `delta` to this isolate's cached counter so
 *  rapid-fire ingests don't re-read D1. The durable bump happens in the
 *  same batch that writes the telemetry rows (see the ingest handlers). */
function bumpCachedDailyCounter(name: string, delta: number): void {
  const cached = dailyCounterCache[name];
  if (cached && cached.day === utcDateString(now())) cached.n += delta;
}

/** SQL fragment appending a `delta` to the named counter's today-row —
 *  pushed into the ingest batch itself so no extra round-trip is needed. */
function dailyCounterBumpStmt(env: Env, name: string, delta: number): D1PreparedStatement {
  return telemetryDb(env).prepare(
    "INSERT INTO daily_counters (name, day, n) VALUES (?, ?, ?) ON CONFLICT(name, day) DO UPDATE SET n = n + excluded.n"
  ).bind(name, utcDateString(now()), delta);
}

// ── PII scrubbing ──
//
// Even though we don't collect user ids, the `detail` field of js_error
// events can contain arbitrary text from `error.message`. If the app throws
// `new Error("Failed for user john@example.com with token eyJ...")`, that
// PII would be stored in D1. These regexes redact common PII patterns
// BEFORE the detail is persisted.

const PII_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Email addresses
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[redacted:email]" },
  // JWT tokens (three base64 segments separated by dots; header starts with
  // eyJ). The signature segment can be short, so we only require 5+ chars.
  { re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}/g, replacement: "[redacted:jwt]" },
  // Bearer tokens (catches non-JWT bearer tokens like API keys)
  { re: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, replacement: "Bearer [redacted]" },
  // Long hex strings (API keys, session tokens — 32+ hex chars)
  { re: /\b[a-f0-9]{32,}\b/gi, replacement: "[redacted:token]" },
  // Long base64 strings (40+ chars, could be encoded credentials)
  { re: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replacement: "[redacted:b64]" },
];

function scrubPii(text: string): string {
  let out = text;
  for (const { re, replacement } of PII_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/** Strip query/hash, normalize trailing slash, cap length. Returns null if
 *  the resulting path is empty or obviously not a path. Also strips control
 *  characters (0x00-0x1F, 0x7F) that could cause log injection or display
 *  issues. */
function sanitizeAnalyticsPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.split("?", 1)[0].split("#", 1)[0];
  // Strip control characters (newline, tab, null byte, etc.) to prevent
  // log injection and display corruption in the admin dashboard.
  p = p.replace(/[\x00-\x1f\x7f]/g, "");
  if (p.length > 512) p = p.slice(0, 512);
  if (!p.startsWith("/")) p = "/" + p;
  // Collapse // runs to keep D1 grouping tidy.
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.length === 0) return null;
  return p.slice(0, ANALYTICS_MAX_PATH_LEN);
}

function sanitizeAnalyticsString(raw: unknown, max: number, allowed?: Set<string>): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.slice(0, max);
  if (allowed && !allowed.has(v)) return null;
  return v || null;
}

function sanitizeAnalyticsValue(raw: unknown): number | null {
  if (typeof raw !== "number" || !isFinite(raw)) return null;
  // Clamp to a sane range — CLS is unitless and typically < 1, timings are
  // ms and shouldn't exceed ~5 minutes (a stuck tab). Negative values are
  // invalid.
  if (raw < 0 || raw > 5 * 60 * 1000) return null;
  return raw;
}

function sanitizeAnalyticsDetail(raw: unknown): string | null {
  if (raw == null) return null;
  let json: string;
  try {
    json = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    return null;
  }
  // Scrub PII (emails, tokens, JWTs) from the detail BEFORE storing.
  // This catches cases where error.message contains user data.
  json = scrubPii(json);
  if (json.length > ANALYTICS_MAX_DETAIL_BYTES) {
    json = json.slice(0, ANALYTICS_MAX_DETAIL_BYTES);
  }
  return json;
}

/* ── Analytics ingest ──
 *
 * POST /v1/analytics/events
 *   Body: { events: AnalyticsEvent[] }
 *
 * Each event:
 *   { type, path?, metric?, value?, detail?, browser?, device?, connection?, ts? }
 *
 * Auth: none required — guests and signed-in users both report (the deployed
 * app runs most sessions as local guests, so gating this on a session would
 * mean collecting nothing). We do NOT log user id, IP, or full UA — only
 * the client-supplied session_id (which the client rotates every 30 min).
 * This is enough to count distinct sessions without identifying anyone.
 * Abuse is bounded by the per-IP rate limit and the global daily write cap.
 */
async function handleAnalyticsIngest(request: Request, env: Env, origin: string, log: Logger): Promise<Response> {
  await ensureShardSchema(env, "telemetry");
  // Pre-check Content-Length to avoid parsing a huge body that we'll reject
  // anyway. 20 events * ~1KB each ≈ 20KB; reject anything over 100KB to
  // leave headroom for JSON overhead.
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 100_000) {
    return json({ error: "Request body too large" }, 413, origin, log);
  }

  // Global daily write cap — protects the D1 free-tier write quota (100K
  // rows/day account-wide) from being exhausted by analytics alone.
  if (!(await dailyWriteCountOk(env, "analytics", ANALYTICS_DAILY_WRITE_CAP))) {
    return json({ error: "Analytics daily write cap reached" }, 429, origin, log);
  }

  const body = await readJson(request);
  const events = Array.isArray(body?.events) ? body.events : null;
  if (!events) return json({ error: "Missing events array" }, 400, origin, log);
  if (events.length > ANALYTICS_MAX_BATCH) {
    return json({ error: `Too many events (max ${ANALYTICS_MAX_BATCH} per batch)` }, 413, origin, log);
  }
  if (events.length === 0) return json({ ok: true, accepted: 0 }, 200, origin, log);

  // Privacy: NEVER fall back to session.sessionId (the D1 sessions.id row id).
  // That would let an admin JOIN analytics_events → sessions → users and
  // de-anonymize every event. If the client didn't send a sessionId, we
  // generate a fresh random one for THIS batch only — it can't be linked
  // back to a user. The client is expected to send a rotated per-tab id.
  const clientSessionId = sanitizeAnalyticsString(body?.sessionId, 64) || id();
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  let accepted = 0;

  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const eventType = sanitizeAnalyticsString((ev as any).type, 32, ANALYTICS_VALID_EVENT_TYPES);
    if (!eventType) continue;
    const path = sanitizeAnalyticsPath((ev as any).path);
    // Metric name validation depends on event type:
    //   - web_vital: must be one of the known metrics (LCP, INP, CLS, TTFB, FCP, FID)
    //   - api_call:  free-form endpoint label (e.g. "GET /v1/sync"), up to 80 chars
    //   - others:    not used
    const metricName = eventType === "api_call"
      ? sanitizeAnalyticsString((ev as any).metric, 80)
      : sanitizeAnalyticsString((ev as any).metric, 16, ANALYTICS_VALID_METRICS);
    const value = sanitizeAnalyticsValue((ev as any).value);
    const detail = sanitizeAnalyticsDetail((ev as any).detail);
    const browser = sanitizeAnalyticsString((ev as any).browser, 16, ANALYTICS_VALID_BROWSERS);
    const device = sanitizeAnalyticsString((ev as any).device, 16, ANALYTICS_VALID_DEVICES);
    const connection = sanitizeAnalyticsString((ev as any).connection, 16, ANALYTICS_VALID_CONNECTIONS);
    // Client may send its own ts (epoch ms). We clamp it to the last hour to
    // prevent backfilling the table from a stale tab.
    const clientTs = typeof (ev as any).ts === "number" && isFinite((ev as any).ts)
      ? Math.min(t, Math.max(t - 60 * 60 * 1000, (ev as any).ts as number))
      : t;

    stmts.push(
      telemetryDb(env).prepare(
        "INSERT INTO analytics_events (id, session_id, event_type, path, metric_name, value, detail, browser, device, connection, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id(), clientSessionId, eventType, path, metricName, value, detail, browser, device, connection, clientTs)
    );
    accepted += 1;
  }

  if (stmts.length === 0) return json({ ok: true, accepted: 0 }, 200, origin, log);
  // Bump today's write counter in the same batch — no extra round-trip, and
  // the daily cap guard stays a 1-row point read.
  stmts.push(dailyCounterBumpStmt(env, "analytics", accepted));
  try {
    await telemetryDb(env).batch(stmts);
    bumpCachedDailyCounter("analytics", accepted);
  } catch (error: any) {
    log.error("analytics ingest failed", { error: error.message, count: stmts.length });
    return json({ error: "Failed to store analytics events" }, 500, origin, log);
  }
  return json({ ok: true, accepted }, 200, origin, log);
}

/* ── QBank choice stats ──
 * POST /v1/qbank/stats   — one aggregated report per finished session
 *   Body: { uid, aid?, answers: [[qid, choiceIndex, optionsCount?], ...] }
 * GET  /v1/qbank/stats?uid=… — peer choice percentages for review mode
 *
 * The client reports EVERY answered MCQ of the finished session; the worker
 * counts each contributor exactly once per question via
 * question_choice_respondents, so retakes, repeat sessions, cleared local
 * progress, and extra devices never inflate the aggregates. Signed-in users
 * are keyed by a server-side hash of their account id; guests by a random
 * client-generated UUID.
 *
 * The worker stores ONLY pre-aggregated counters — never who chose what
 * (the respondent table records THAT a question was answered, not the
 * choice). Guests are included because the deployed app runs most sessions
 * as local guests; abuse is bounded by the per-IP / per-user rate limits
 * and QBANK_STATS_DAILY_WRITE_CAP.
 */

function sanitizeStatsId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const v = raw.slice(0, QBANK_STATS_ID_MAX_LEN);
  if (/[\x00-\x1f\x7f]/.test(v)) return null;
  return v;
}

async function handleQuestionStatsReport(request: Request, env: Env, session: Session | null, origin: string, log: Logger): Promise<Response> {
  await ensureShardSchema(env, "telemetry");
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 100_000) {
    return json({ error: "Request body too large" }, 413, origin, log);
  }
  if (!(await dailyWriteCountOk(env, "qstats", QBANK_STATS_DAILY_WRITE_CAP))) {
    return json({ error: "Choice stats daily write cap reached" }, 429, origin, log);
  }

  const body = await readJson(request);
  const uid = sanitizeStatsId(body?.uid);
  const answers = Array.isArray(body?.answers) ? body.answers : null;
  if (!uid || !answers) return json({ error: "Missing uid or answers" }, 400, origin, log);

  // Contributor id — the dedup key that makes each user count exactly once
  // per question regardless of retakes, cleared progress, or extra devices:
  //   * signed-in → HMAC-style SHA-256(user.id + server secret), computed
  //     server-side so the client never learns a linkable id.
  //   * guest → client-generated random UUID from localStorage. Not linked to
  //     any account; losing it (cleared browser data) just means the guest may
  //     contribute again, which is acceptable for anonymous aggregates.
  let aid: string;
  if (session) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${env.JWT_SECRET}:qstats:${session.user.id}`),
    );
    aid = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    const clientAid = typeof body?.aid === "string" ? body.aid.slice(0, QBANK_STATS_AID_MAX_LEN) : "";
    aid = /^[A-Za-z0-9_-]+$/.test(clientAid) ? clientAid : id(); // invalid/missing ⇒ ephemeral id (counts once, dedups never)
  }

  if (answers.length > QBANK_STATS_MAX_BATCH) {
    return json({ error: `Too many answers (max ${QBANK_STATS_MAX_BATCH} per report)` }, 413, origin, log);
  }
  if (answers.length === 0) return json({ ok: true, accepted: 0 }, 200, origin, log);

  const t = now();
  const seen = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  for (const pair of answers) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const qid = sanitizeStatsId(pair[0]);
    const choice = pair[1];
    const optionsCount = typeof pair[2] === "number" && isFinite(pair[2])
      ? Math.max(0, Math.min(QBANK_STATS_MAX_OPTIONS, Math.floor(pair[2])))
      : 0;
    if (!qid || !Number.isInteger(choice) || (choice as number) < 0 || (choice as number) >= QBANK_STATS_MAX_OPTIONS) continue;
    const key = `${qid}:${choice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Dedup + count in ONE atomic D1 batch. Statement ORDER matters: the
    // counter's NOT EXISTS guard runs BEFORE this batch's respondent insert,
    // so it reads only previously-COMMITTED state — a first-ever answer
    // increments once; any repeat (retake, cleared progress, second device)
    // finds the committed respondent row and becomes a no-op. The batch is
    // a single transaction, so the pair succeeds or fails together.
    stmts.push(
      telemetryDb(env).prepare(
        `INSERT INTO question_choice_stats (uid, qid, choice, options_count, count, updated_at)
         SELECT ?, ?, ?, ?, 1, ?
         WHERE NOT EXISTS (SELECT 1 FROM question_choice_respondents WHERE aid = ? AND uid = ? AND qid = ?)
         ON CONFLICT(uid, qid, choice) DO UPDATE SET count = count + 1, options_count = excluded.options_count, updated_at = excluded.updated_at`
      ).bind(uid, qid, choice, optionsCount, t, aid, uid, qid)
    );
    stmts.push(
      telemetryDb(env).prepare(
        "INSERT INTO question_choice_respondents (aid, uid, qid, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(aid, uid, qid) DO NOTHING"
      ).bind(aid, uid, qid, t)
    );
  }

  if (stmts.length === 0) return json({ ok: true, accepted: 0 }, 200, origin, log);
  // Bump today's write counter in the same batch. Appended LAST so the
  // odd-index "respondent insert" result mapping below is unaffected.
  const dataRowCount = stmts.length;
  stmts.push(dailyCounterBumpStmt(env, "qstats", dataRowCount));
  try {
    const results = await telemetryDb(env).batch(stmts);
    // Odd-indexed results are the respondent inserts; changes === 1 means
    // this contributor's first-ever answer to that question was counted.
    const accepted = results.filter((_, i) => i % 2 === 1).reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
    bumpCachedDailyCounter("qstats", dataRowCount);
    return json({ ok: true, accepted }, 200, origin, log);
  } catch (error: any) {
    log.error("choice stats report failed", { error: error.message, count: stmts.length });
    return json({ error: "Failed to store choice stats" }, 500, origin, log);
  }
}

async function handleQuestionStatsGet(url: URL, env: Env, origin: string, log: Logger): Promise<Response> {
  await ensureShardSchema(env, "telemetry");
  const uid = sanitizeStatsId(url.searchParams.get("uid"));
  if (!uid) return json({ error: "Missing uid" }, 400, origin, log);

  interface StatsRow { qid: string; choice: number; options_count: number; count: number }
  let rows: StatsRow[];
  try {
    ({ results: rows } = await telemetryDb(env).prepare(
      "SELECT qid, choice, options_count, count FROM question_choice_stats WHERE uid = ?"
    ).bind(uid).all<StatsRow>());
  } catch (error: any) {
    log.error("choice stats read failed", { error: error.message });
    return json({ error: "Failed to read choice stats" }, 500, origin, log);
  }

  // Drop questions below the minimum sample so percentages can't single out
  // individuals in tiny cohorts (the admin endpoint sees raw numbers).
  return json({ stats: groupChoiceRows(rows || [], qstatsMinSample(env)) }, 200, origin, log);
}

/** Group raw counter rows into dense per-choice arrays. Rows with an
 *  out-of-range choice are dropped defensively; questions whose total is
 *  below `minSample` are omitted (pass 0 for raw/admin views). */
function groupChoiceRows(rows: Array<{ qid: string; choice: number; options_count: number; count: number }>, minSample: number): Record<string, { c: number[]; t: number; oc: number }> {
  const grouped = new Map<string, Map<number, number>>();
  const optionCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row.qid !== "string") continue;
    let counts = grouped.get(row.qid);
    if (!counts) grouped.set(row.qid, (counts = new Map()));
    counts.set(row.choice, (counts.get(row.choice) ?? 0) + (row.count ?? 0));
    if ((row.options_count ?? 0) > (optionCounts.get(row.qid) ?? 0)) {
      optionCounts.set(row.qid, row.options_count);
    }
  }
  const stats: Record<string, { c: number[]; t: number; oc: number }> = {};
  for (const [qid, counts] of grouped) {
    const choices = [...counts.keys()].sort((a, b) => a - b);
    if (choices.length === 0 || choices[choices.length - 1] >= QBANK_STATS_MAX_OPTIONS) continue;
    // DENSE array indexed by choice position — unchosen options must occupy
    // (and report as) 0, or the client's c[idx] lookup would misalign.
    const maxIdx = choices[choices.length - 1];
    const c = Array.from({ length: maxIdx + 1 }, (_, i) => counts.get(i) ?? 0);
    const total = c.reduce((sum, n) => sum + n, 0);
    if (total < minSample) continue;
    stats[qid] = { c, t: total, oc: optionCounts.get(qid) ?? 0 };
  }
  return stats;
}

/* ── Analytics read (admin only) ──
 *
 * Routes:
 *   GET /v1/admin/analytics/overview?range=24h|7d|30d
 *   GET /v1/admin/analytics/timeseries?range=24h|7d|30d
 *   GET /v1/admin/analytics/web-vitals?range=24h|7d|30d
 *   GET /v1/admin/analytics/top-pages?range=24h|7d|30d&limit=20
 *   GET /v1/admin/analytics/errors?range=24h|7d|30d&limit=20
 *   GET /v1/admin/analytics/api-performance?range=24h|7d|30d&limit=20
 *   GET /v1/admin/analytics/cloudflare-limits
 */
const ANALYTICS_RANGES: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};
const ANALYTICS_DEFAULT_RANGE = "24h";

function analyticsRangeMs(url: URL): number {
  const r = url.searchParams.get("range") || ANALYTICS_DEFAULT_RANGE;
  return ANALYTICS_RANGES[r] ?? ANALYTICS_RANGES[ANALYTICS_DEFAULT_RANGE];
}

/** Returns the normalized range label ("24h" | "7d" | "30d") actually used
 *  for the query — never the raw user input. Use this in the response body
 *  so the client never sees a echoed-back invalid value like "foo". */
function analyticsRangeLabel(url: URL): string {
  const r = url.searchParams.get("range") || ANALYTICS_DEFAULT_RANGE;
  return ANALYTICS_RANGES[r] ? r : ANALYTICS_DEFAULT_RANGE;
}

/** Compute p50/p75/p95 from a sorted ascending array. */
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * (sortedAsc.length - 1)));
  return sortedAsc[idx];
}

/* ── Content analytics ─────────────────────────────────────────────────
 * "Who solved what, how many times": aggregates the per-user qbank +
 * flashcards progress documents the sync pipeline already stores, so no
 * new collection path is needed. It is an all-time snapshot — progress
 * docs are cumulative state, not time-bucketed events. The heavy scan is
 * cached in-process for 60s since the admin dashboard polls on a timer.
 */
const CONTENT_ANALYTICS_CACHE_TTL_MS = 60_000;
const contentAnalyticsCache = new Map<string, { at: number; data: unknown }>();

async function contentAnalytics(env: Env, url: URL): Promise<unknown> {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const cacheKey = `limit:${limit}`;
  const cached = contentAnalyticsCache.get(cacheKey);
  if (cached && now() - cached.at < CONTENT_ANALYTICS_CACHE_TTL_MS) return cached.data;

  // The doc scan fans out across every sync shard — user rows are
  // partitioned one shard each, so the pool scan is N parallel queries.
  const syncPool = allSyncDbs(env);
  await Promise.all(syncPool.map((_db, i) => ensureShardSchema(env, "sync", i + 1)));
  const [userRows, docRows] = await Promise.all([
    env.DB.prepare("SELECT id, username, display_name FROM users").all<{ id: string; username: string | null; display_name: string | null }>(),
    // Segmented kinds store their records across "qbank:N" rows — records
    // are disjoint across segments, so scanning every segment row covers the
    // whole logical kind.
    Promise.all(syncPool.map((db) => db.prepare("SELECT user_id, kind, payload, compressed FROM progress_documents WHERE kind = 'flashcards' OR kind = 'qbank' OR kind LIKE 'qbank:%'").all<{ user_id: string; kind: string; payload: string; compressed: number }>()))
      .then((parts) => ({ results: parts.flatMap((part) => part.results || []) })),
  ]);

  const userNames = new Map<string, string>();
  for (const u of userRows.results || []) userNames.set(u.id, u.username || u.display_name || u.id.slice(0, 8));

  // Per pack uid: aggregate totals + per-user subtotals + quality signals.
  const packs = new Map<string, {
    uid: string; engine: string; attempts: number; correct: number; lastSolvedAt: number;
    questions: Set<string>; firstTryCorrect: number; firstTryTotal: number;
    flagged: number; timeSum: number; timeCount: number;
    perUser: Map<string, { attempts: number; correct: number; lastTs: number }>;
  }>();
  const globalUsers = new Map<string, { packs: Set<string>; attempts: number; correct: number }>();

  for (const row of docRows.results || []) {
    let records: Record<string, any>;
    try {
      const json = row.compressed ? await gunzipBytes(base64ToBytes(row.payload)) : row.payload;
      records = JSON.parse(json);
    } catch { continue; }
    const isFlashcard = row.kind === "flashcards";
    for (const [key, rec] of Object.entries(records || {})) {
      if (!rec || typeof rec !== "object") continue;
      let packUid: string | null;
      let attempts: number;
      let correct: number;
      let ts: number;
      if (isFlashcard) {
        // Flashcard keys are `${deckUid}:${cardId}`; the record carries no uid.
        const sep = key.indexOf(":");
        if (sep < 0) continue;
        packUid = key.slice(0, sep);
        attempts = Number(rec.reviewCount) || 0;
        correct = Number(rec.correctCount) || 0;
        ts = Number(rec.lastReviewed) || 0;
      } else {
        // QBank records carry `uid`; fall back to the key prefix.
        packUid = typeof rec.uid === "string" && rec.uid ? rec.uid : key.slice(0, key.indexOf(":") >= 0 ? key.indexOf(":") : key.length);
        attempts = Number(rec.attempts) || 0;
        correct = Number(rec.correctCount) || 0;
        ts = Number(rec.timestamp) || 0;
      }
      if (!packUid || attempts <= 0) continue;
      const engine = isFlashcard ? "flashcard" : (typeof rec.engine === "string" ? rec.engine : "quiz");
      // The record key is `${packUid}:${itemId}` — the part after the first
      // colon is the distinct question/card id within the pack.
      const itemId = key.indexOf(":") >= 0 ? key.slice(key.indexOf(":") + 1) : key;
      let p = packs.get(packUid);
      if (!p) {
        p = {
          uid: packUid, engine, attempts: 0, correct: 0, lastSolvedAt: 0,
          questions: new Set(), firstTryCorrect: 0, firstTryTotal: 0,
          flagged: 0, timeSum: 0, timeCount: 0, perUser: new Map(),
        };
        packs.set(packUid, p);
      }
      p.attempts += attempts;
      p.correct += correct;
      if (ts > p.lastSolvedAt) p.lastSolvedAt = ts;
      p.questions.add(itemId);
      if (typeof rec.firstAttemptCorrect === "boolean") {
        p.firstTryTotal += 1;
        if (rec.firstAttemptCorrect) p.firstTryCorrect += 1;
      }
      if (rec.flagged === true) p.flagged += 1;
      const avgTime = Number(rec.avgTimeMs);
      if (Number.isFinite(avgTime) && avgTime > 0) { p.timeSum += avgTime; p.timeCount += 1; }
      const u = p.perUser.get(row.user_id);
      if (u) { u.attempts += attempts; u.correct += correct; if (ts > u.lastTs) u.lastTs = ts; }
      else p.perUser.set(row.user_id, { attempts, correct, lastTs: ts });
      const gu = globalUsers.get(row.user_id);
      if (gu) { gu.packs.add(packUid); gu.attempts += attempts; gu.correct += correct; }
      else globalUsers.set(row.user_id, { packs: new Set([packUid]), attempts, correct });
    }
  }

  const packList = Array.from(packs.values())
    .map((p) => {
      const topUsers = Array.from(p.perUser.entries())
        .map(([userId, s]) => ({
          username: userNames.get(userId) ?? userId.slice(0, 8),
          attempts: s.attempts,
          correct: s.correct,
          accuracy: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : null,
        }))
        .sort((a, b) => b.attempts - a.attempts)
        .slice(0, 5);
      return {
        uid: p.uid, engine: p.engine,
        users: p.perUser.size,
        attempts: p.attempts, correct: p.correct,
        accuracy: p.attempts > 0 ? Math.round((p.correct / p.attempts) * 100) : null,
        questions: p.questions.size,
        firstTryRate: p.firstTryTotal > 0 ? Math.round((p.firstTryCorrect / p.firstTryTotal) * 100) : null,
        avgTimeMs: p.timeCount > 0 ? Math.round(p.timeSum / p.timeCount) : null,
        flagged: p.flagged,
        lastSolvedAt: p.lastSolvedAt || null,
        topUsers,
      };
    })
    .sort((a, b) => b.attempts - a.attempts);

  const topUsers = Array.from(globalUsers.entries())
    .map(([userId, s]) => ({
      username: userNames.get(userId) ?? userId.slice(0, 8),
      packs: s.packs.size,
      attempts: s.attempts, correct: s.correct,
      accuracy: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : null,
    }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, limit);

  // Engine mix — how engagement splits across content types.
  const engineMap = new Map<string, { engine: string; packs: number; users: Set<string>; attempts: number; correct: number }>();
  for (const p of packs.values()) {
    let e = engineMap.get(p.engine);
    if (!e) { e = { engine: p.engine, packs: 0, users: new Set(), attempts: 0, correct: 0 }; engineMap.set(p.engine, e); }
    e.packs += 1;
    for (const userId of p.perUser.keys()) e.users.add(userId);
    e.attempts += p.attempts;
    e.correct += p.correct;
  }
  const byEngine = Array.from(engineMap.values())
    .map((e) => ({
      engine: e.engine,
      packs: e.packs,
      users: e.users.size,
      attempts: e.attempts,
      correct: e.correct,
      accuracy: e.attempts > 0 ? Math.round((e.correct / e.attempts) * 100) : null,
    }))
    .sort((a, b) => b.attempts - a.attempts);

  // Recency — how fresh the engagement is (per pack, from its last solve).
  const nowMs = now();
  const recency = { "24h": 0, "7d": 0, "30d": 0, older: 0 };
  for (const p of packs.values()) {
    const age = p.lastSolvedAt ? nowMs - p.lastSolvedAt : Infinity;
    if (age <= 24 * 60 * 60 * 1000) recency["24h"] += 1;
    else if (age <= 7 * 24 * 60 * 60 * 1000) recency["7d"] += 1;
    else if (age <= 30 * 24 * 60 * 60 * 1000) recency["30d"] += 1;
    else recency.older += 1;
  }
  const recencyBuckets = [
    { bucket: "24h", packs: recency["24h"] },
    { bucket: "7d", packs: recency["7d"] },
    { bucket: "30d", packs: recency["30d"] },
    { bucket: "older", packs: recency.older },
  ];

  // Adoption — how many packs each learner has touched.
  const tiers = { "1": 0, "2to5": 0, "6to10": 0, "11plus": 0 };
  for (const s of globalUsers.values()) {
    const n = s.packs.size;
    if (n <= 1) tiers["1"] += 1;
    else if (n <= 5) tiers["2to5"] += 1;
    else if (n <= 10) tiers["6to10"] += 1;
    else tiers["11plus"] += 1;
  }
  const userTiers = [
    { tier: "1", users: tiers["1"] },
    { tier: "2to5", users: tiers["2to5"] },
    { tier: "6to10", users: tiers["6to10"] },
    { tier: "11plus", users: tiers["11plus"] },
  ];

  // Accuracy bands — how packs distribute across quality zones.
  const bands = { good: 0, warn: 0, bad: 0 };
  for (const p of packList) {
    if (p.accuracy == null) continue;
    if (p.accuracy >= 80) bands.good += 1;
    else if (p.accuracy >= 50) bands.warn += 1;
    else bands.bad += 1;
  }
  const accuracyBands = [
    { bucket: "good", packs: bands.good },
    { bucket: "warn", packs: bands.warn },
    { bucket: "bad", packs: bands.bad },
  ];

  let totalAttempts = 0;
  let totalCorrect = 0;
  let totalQuestions = 0;
  let flaggedQuestions = 0;
  let firstTryCorrect = 0;
  let firstTryTotal = 0;
  let timeSum = 0;
  let timeCount = 0;
  for (const p of packs.values()) {
    totalAttempts += p.attempts;
    totalCorrect += p.correct;
    totalQuestions += p.questions.size;
    flaggedQuestions += p.flagged;
    firstTryCorrect += p.firstTryCorrect;
    firstTryTotal += p.firstTryTotal;
    timeSum += p.timeSum;
    timeCount += p.timeCount;
  }

  const data = {
    totalPacks: packs.size,
    totalUsers: globalUsers.size,
    totalAttempts,
    totalCorrect,
    avgAccuracy: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null,
    totalQuestions,
    flaggedQuestions,
    firstTryRate: firstTryTotal > 0 ? Math.round((firstTryCorrect / firstTryTotal) * 100) : null,
    avgTimeMs: timeCount > 0 ? Math.round(timeSum / timeCount) : null,
    byEngine,
    recencyBuckets,
    userTiers,
    accuracyBands,
    packs: packList.slice(0, limit),
    topUsers,
  };
  contentAnalyticsCache.set(cacheKey, { at: now(), data });
  return data;
}

async function handleAnalytics(request: Request, env: Env, url: URL, origin: string, log: Logger): Promise<Response | null> {
  // Every branch below reads the sync/telemetry shards (dashboards, choice
  // stats, quota panel) — bootstrap the whole pool once per isolate first.
  await Promise.all([
    ...allSyncDbs(env).map((_db, i) => ensureShardSchema(env, "sync", i + 1)),
    ensureShardSchema(env, "telemetry"),
  ]);
  const path = url.pathname;

  /* ── Overview ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/overview") {
    const since = now() - analyticsRangeMs(url);
    const since24h = now() - 24 * 60 * 60 * 1000;
    const row = await telemetryDb(env).prepare(
      `SELECT
         COUNT(*) AS total_events,
         COUNT(DISTINCT session_id) AS total_sessions,
         SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
         SUM(CASE WHEN event_type = 'js_error' THEN 1 ELSE 0 END) AS js_errors,
         SUM(CASE WHEN event_type = 'web_vital' THEN 1 ELSE 0 END) AS web_vitals,
         SUM(CASE WHEN event_type = 'api_call' THEN 1 ELSE 0 END) AS api_calls,
         SUM(CASE WHEN event_type = 'route_change' THEN 1 ELSE 0 END) AS route_changes,
         MAX(created_at) AS last_event_at
       FROM analytics_events WHERE created_at >= ?`
    ).bind(since).first<any>();
    const row24 = await telemetryDb(env).prepare(
      `SELECT
         COUNT(*) AS events_24h,
         COUNT(DISTINCT session_id) AS sessions_24h,
         SUM(CASE WHEN event_type = 'js_error' THEN 1 ELSE 0 END) AS js_errors_24h
       FROM analytics_events WHERE created_at >= ?`
    ).bind(since24h).first<any>();
    // All-time aggregate: analytics_daily keeps every rolled-up day forever
    // (raw events prune at 30 days; the cron rolls up before pruning), and
    // today's raw events are counted live on top — no overlap, no double count.
    const todayIso = utcDateString(now());
    const [rollupRow, todayCountRow] = await Promise.all([
      telemetryDb(env).prepare("SELECT COALESCE(SUM(events), 0) AS n FROM analytics_daily WHERE day < ?").bind(todayIso).first<{ n: number }>().catch(() => ({ n: 0 })),
      telemetryDb(env).prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE created_at >= ?").bind(Date.parse(todayIso)).first<{ n: number }>().catch(() => ({ n: 0 })),
    ]);
    const allTimeEvents = (Number(rollupRow?.n) || 0) + (Number(todayCountRow?.n) || 0);
    return json({
      range: analyticsRangeLabel(url),
      totalEvents:          row?.total_events ?? 0,
      allTimeEvents,
      totalSessions:        row?.total_sessions ?? 0,
      pageViews:            row?.page_views ?? 0,
      jsErrors:             row?.js_errors ?? 0,
      webVitals:            row?.web_vitals ?? 0,
      apiCalls:             row?.api_calls ?? 0,
      routeChanges:         row?.route_changes ?? 0,
      lastEventAt:          row?.last_event_at ?? null,
      events24h:            row24?.events_24h ?? 0,
      sessions24h:          row24?.sessions_24h ?? 0,
      jsErrors24h:          row24?.js_errors_24h ?? 0,
    }, 200, origin, log);
  }

  /* ── Timeseries ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/timeseries") {
    const range = analyticsRangeLabel(url);
    const rangeMs = analyticsRangeMs(url);
    const since = now() - rangeMs;
    // Bucket: 1h for 24h, 6h for 7d, 1d for 30d. Keeps the chart readable.
    const bucketMs = range === "24h" ? 60 * 60 * 1000 : range === "7d" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const rows = await telemetryDb(env).prepare(
      `SELECT
         (created_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucket,
         event_type,
         COUNT(*) AS count
       FROM analytics_events
       WHERE created_at >= ?
       GROUP BY bucket, event_type
       ORDER BY bucket ASC`
    ).bind(bucketMs, bucketMs, since).all<any>();
    const buckets = new Map<number, Record<string, number>>();
    for (const r of (rows.results || [])) {
      const b = Number(r.bucket);
      if (!buckets.has(b)) buckets.set(b, {});
      buckets.get(b)![r.event_type] = (buckets.get(b)![r.event_type] ?? 0) + Number(r.count);
    }
    // Fill in missing buckets so the chart has continuous x-axis.
    const series: Array<{ ts: number; page_view: number; web_vital: number; js_error: number; api_call: number; route_change: number }> = [];
    const startBucket = Math.floor(since / bucketMs) * bucketMs;
    const endBucket = Math.floor(now() / bucketMs) * bucketMs;
    for (let b = startBucket; b <= endBucket; b += bucketMs) {
      const ev = buckets.get(b) ?? {};
      series.push({
        ts: b,
        page_view: ev["page_view"] ?? 0,
        web_vital: ev["web_vital"] ?? 0,
        js_error: ev["js_error"] ?? 0,
        api_call: ev["api_call"] ?? 0,
        route_change: ev["route_change"] ?? 0,
      });
    }
    return json({ range, bucketMs, series }, 200, origin, log);
  }

  /* ── Web Vitals ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/web-vitals") {
    const since = now() - analyticsRangeMs(url);
    const rows = await telemetryDb(env).prepare(
      "SELECT metric_name, value FROM analytics_events WHERE event_type = 'web_vital' AND value IS NOT NULL AND created_at >= ? LIMIT 10000"
    ).bind(since).all<any>();
    const byMetric: Record<string, number[]> = {};
    for (const r of (rows.results || [])) {
      const m = r.metric_name;
      if (!m) continue;
      if (!byMetric[m]) byMetric[m] = [];
      byMetric[m].push(Number(r.value));
    }
    const metrics = Object.keys(byMetric).sort().map((name) => {
      const sorted = byMetric[name].sort((a, b) => a - b);
      return {
        name,
        count: sorted.length,
        min: sorted.length ? sorted[0] : null,
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p95: percentile(sorted, 95),
        max: sorted.length ? sorted[sorted.length - 1] : null,
      };
    });
    return json({ range: analyticsRangeLabel(url), metrics }, 200, origin, log);
  }

  /* ── Top pages ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/top-pages") {
    const since = now() - analyticsRangeMs(url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const rows = await telemetryDb(env).prepare(
      `SELECT path, COUNT(*) AS views, COUNT(DISTINCT session_id) AS unique_sessions, MAX(created_at) AS last_seen
       FROM analytics_events
       WHERE event_type = 'page_view' AND path IS NOT NULL AND created_at >= ?
       GROUP BY path
       ORDER BY views DESC
       LIMIT ?`
    ).bind(since, limit).all<any>();
    const items = (rows.results || []).map((r: any) => ({
      path: r.path, views: Number(r.views), uniqueSessions: Number(r.unique_sessions), lastSeen: Number(r.last_seen),
    }));
    return json({ range: analyticsRangeLabel(url), items }, 200, origin, log);
  }

  /* ── Errors ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/errors") {
    const since = now() - analyticsRangeMs(url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    // Group by the error message (extracted from JSON detail). Falls back
    // to the raw detail text if json_extract returns null. json_extract
    // THROWS on malformed JSON (rather than returning null), so guard with
    // json_valid first — legacy details may be plain text, not JSON.
    const rows = await telemetryDb(env).prepare(
      `SELECT
         CASE WHEN json_valid(detail)
           THEN COALESCE(json_extract(detail, '$.message'), detail, '(unknown)')
           ELSE detail END AS message,
         COUNT(*) AS count,
         MIN(created_at) AS first_seen,
         MAX(created_at) AS last_seen,
         COUNT(DISTINCT path) AS affected_paths,
         COUNT(DISTINCT session_id) AS affected_sessions
       FROM analytics_events
       WHERE event_type = 'js_error' AND created_at >= ?
       GROUP BY message
       ORDER BY last_seen DESC
       LIMIT ?`
    ).bind(since, limit).all<any>();
    const items = (rows.results || []).map((r: any) => ({
      message: String(r.message).slice(0, 500),
      count: Number(r.count),
      firstSeen: Number(r.first_seen),
      lastSeen: Number(r.last_seen),
      affectedPaths: Number(r.affected_paths),
      affectedSessions: Number(r.affected_sessions),
    }));
    return json({ range: analyticsRangeLabel(url), items }, 200, origin, log);
  }

  /* ── API performance ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/api-performance") {
    const since = now() - analyticsRangeMs(url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    // Fetch raw (endpoint, value) pairs and aggregate in JS so we can compute
    // p50/p95 without N+1 queries.
    const rows = await telemetryDb(env).prepare(
      "SELECT metric_name AS endpoint, value FROM analytics_events WHERE event_type = 'api_call' AND value IS NOT NULL AND created_at >= ? LIMIT 10000"
    ).bind(since).all<any>();
    const byEndpoint: Record<string, number[]> = {};
    for (const r of (rows.results || [])) {
      const ep = r.endpoint || "(unknown)";
      if (!byEndpoint[ep]) byEndpoint[ep] = [];
      byEndpoint[ep].push(Number(r.value));
    }
    const items = Object.entries(byEndpoint)
      .map(([endpoint, vals]) => {
        const sorted = vals.sort((a, b) => a - b);
        return {
          endpoint,
          count: sorted.length,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          max: sorted.length ? sorted[sorted.length - 1] : null,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    return json({ range: analyticsRangeLabel(url), items }, 200, origin, log);
  }

  /* ── Content (who solved what, how many times) ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/content") {
    return json(await contentAnalytics(env, url), 200, origin, log);
  }

  /* ── Question choice stats (raw aggregates from question_choice_stats) ──
   * No uid → pack rollup. With uid → raw per-question breakdown WITHOUT the
   * student-facing minimum-sample gate (admins may inspect small cohorts). */
  if (request.method === "GET" && path === "/v1/admin/analytics/question-stats") {
    const uid = sanitizeStatsId(url.searchParams.get("uid"));
    if (!uid) {
      const packs = await telemetryDb(env).prepare(
        "SELECT uid, SUM(count) AS responses, COUNT(DISTINCT qid) AS questions FROM question_choice_stats GROUP BY uid ORDER BY responses DESC LIMIT 50"
      ).all<{ uid: string; responses: number; questions: number }>();
      return json({
        packs: (packs.results || []).map((r) => ({
          uid: r.uid,
          responses: Number(r.responses) || 0,
          questions: Number(r.questions) || 0,
        })),
      }, 200, origin, log);
    }
    interface StatsRow { qid: string; choice: number; options_count: number; count: number }
    const rows = await telemetryDb(env).prepare(
      "SELECT qid, choice, options_count, count FROM question_choice_stats WHERE uid = ?"
    ).bind(uid).all<StatsRow>();
    return json({ pack: uid, stats: groupChoiceRows(rows.results || [], 0) }, 200, origin, log);
  }

  /* ── Live Cloudflare usage (GraphQL Analytics API) ──
 *
 * The admin quota panel needs REAL account usage, not just D1-derived
 * guesses. When CF_ACCOUNT_ID + CF_ANALYTICS_TOKEN (secret) are configured,
 * fetchCfLiveUsage pulls the same datasets the Cloudflare dashboard uses:
 *   workersInvocationsAdaptive → requests today (+ CPU p50, best effort)
 *   r2OperationsAdaptiveGroups → this month's ops grouped by actionType
 *   r2StorageAdaptiveGroups    → stored bytes (point-in-time gauge)
 * Each query is isolated (own try/catch): a schema drift in one dataset
 * degrades that section to the estimate instead of failing the endpoint.
 * Results are cached in-isolate for 5 minutes; one panel load costs at most
 * 4 GraphQL subrequests + 1 REST GET (D1 file sizes). D1 row metering has
 * no confirmed per-database GraphQL schema, so D1 reads/writes stay
 * estimated from real table counts — check the dashboard (Workers & Pages →
 * D1 → Metrics) for the billed numbers. Full setup: docs/cloudflare-analytics.md.
 */
const CF_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const CF_LIVE_TTL_MS = 5 * 60 * 1000;
const CF_GRAPHQL_TIMEOUT_MS = 8000;
const CF_R2_LIST_PAGE_CAP = 40;

interface CfLiveUsage {
  connected: boolean;
  /** Isolate timestamp of the (possibly cached) live fetch, null when estimated. */
  at: number | null;
  workersRequestsToday: number | null;
  cpuP50Ms: number | null;
  r2ClassAOpsMonth: number | null;
  r2ClassBOpsMonth: number | null;
  r2Bytes: number | null;
  /** Real per-database file sizes (REST /d1/database list — needs the token
   *  to also carry D1 Read). Null when the query failed or the token lacks
   *  the permission. */
  d1Databases: D1DbUsage[] | null;
}

const CF_LIVE_NONE: CfLiveUsage = {
  connected: false, at: null, workersRequestsToday: null, cpuP50Ms: null,
  r2ClassAOpsMonth: null, r2ClassBOpsMonth: null, r2Bytes: null,
  d1Databases: null,
};
let cfLiveCache: { at: number; data: CfLiveUsage } | null = null;

/** POST one GraphQL query; null on any failure (network/timeout/non-2xx/GraphQL errors). */
async function cfGraphql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CF_GRAPHQL_TIMEOUT_MS);
  try {
    const res = await fetch(CF_GRAPHQL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: any; errors?: unknown[] };
    if (!body || (Array.isArray(body.errors) && body.errors.length > 0)) return null;
    return body.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Per-database usage as the quota panel displays it. */
interface D1DbUsage { name: string; role: string; bytes: number }

/** Role of a D1 database from its name (this instance's naming scheme:
 *  osler-cloud core, osler-sync-N pool shards, osler-telemetry). */
function d1DbRole(name: string): string {
  if (/-sync-\d+$/.test(name)) return "sync";
  if (/telemetry/.test(name)) return "telemetry";
  return "core";
}

/** Real per-database sizes via the REST API — the same file_size numbers
 *  `wrangler d1 list` shows and the quantity the free-tier per-database
 *  storage ceiling bills. Null when the token lacks D1 Read. */
async function cfD1Databases(token: string, account: string): Promise<D1DbUsage[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CF_GRAPHQL_TIMEOUT_MS);
  try {
    // The free tier caps accounts at 10 D1 databases; per_page=100 covers
    // any realistic account in one request.
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database?per_page=100`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = await res.json() as { success?: boolean; result?: Array<{ name?: unknown; file_size?: unknown }> };
    if (!body?.success || !Array.isArray(body.result)) return null;
    const databases: D1DbUsage[] = [];
    for (const db of body.result) {
      const size = Number(db?.file_size);
      if (typeof db?.name === "string" && Number.isFinite(size) && size >= 0) {
        databases.push({ name: db.name, role: d1DbRole(db.name), bytes: size });
      }
    }
    return databases.length ? databases : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Classify an R2 GraphQL actionType into its billed op class. Deletes are
 *  free (excluded from both). Unknown actions land in Class A — the scarcer
 *  quota — so a new action type can only over-alert, never hide usage. */
function r2ActionClass(action: unknown): "A" | "B" | "free" {
  const a = String(action ?? "").toLowerCase();
  if (a.includes("delete")) return "free";
  if (a.startsWith("get") || a.startsWith("head")) return "B";
  if (
    a.startsWith("put") || a.startsWith("post") || a.startsWith("copy") ||
    a.startsWith("upload") || a.startsWith("complete") || a.startsWith("abort") ||
    a.startsWith("list")
  ) return "A";
  return "A";
}

async function fetchCfLiveUsage(env: Env, dayStartIso: string, monthStartIso: string, nowIso: string): Promise<CfLiveUsage> {
  const token = (env.CF_ANALYTICS_TOKEN ?? "").trim();
  const account = (env.CF_ACCOUNT_ID ?? "").trim();
  if (!token || !account) return CF_LIVE_NONE;
  const t = now();
  if (cfLiveCache && t - cfLiveCache.at < CF_LIVE_TTL_MS) return cfLiveCache.data;
  const bucket = (env.CF_R2_BUCKET ?? "").trim() || "osler-content";
  const weekAgoIso = new Date(t - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [inv, cpu, ops, stor, d1Dbs] = await Promise.all([
    cfGraphql(token,
      `query W($a: string!, $s: Time, $e: Time){viewer{accounts(filter:{accountTag:$a}){w:workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$s,datetime_leq:$e}){sum{requests errors}}}}}`,
      { a: account, s: dayStartIso, e: nowIso }),
    cfGraphql(token,
      `query C($a: string!, $s: Time, $e: Time){viewer{accounts(filter:{accountTag:$a}){c:workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$s,datetime_leq:$e}){quantiles{cpuTimeP50}}}}}`,
      { a: account, s: dayStartIso, e: nowIso }),
    cfGraphql(token,
      `query R($a: string!, $m: Time, $e: Time, $b: string){viewer{accounts(filter:{accountTag:$a}){r:r2OperationsAdaptiveGroups(limit:10000,filter:{datetime_geq:$m,datetime_leq:$e,bucketName:$b}){sum{requests}dimensions{actionType}}}}}`,
      { a: account, m: monthStartIso, e: nowIso, b: bucket }),
    cfGraphql(token,
      `query S($a: string!, $w: Time, $e: Time, $b: string){viewer{accounts(filter:{accountTag:$a}){s:r2StorageAdaptiveGroups(limit:100,filter:{datetime_geq:$w,datetime_leq:$e,bucketName:$b}){max{payloadSize}}}}}`,
      { a: account, w: weekAgoIso, e: nowIso, b: bucket }),
    cfD1Databases(token, account),
  ]);
  const out: CfLiveUsage = { ...CF_LIVE_NONE };
  try {
    const rows = inv?.viewer?.accounts?.[0]?.w;
    const sum = Array.isArray(rows) ? rows[0]?.sum : rows?.sum;
    const req = Number(sum?.requests);
    if (Number.isFinite(req) && req >= 0) { out.workersRequestsToday = Math.round(req); out.connected = true; }
  } catch { /* estimated fallback */ }
  try {
    const rows = cpu?.viewer?.accounts?.[0]?.c;
    const q = (Array.isArray(rows) ? rows[0]?.quantiles : rows?.quantiles) ?? {};
    // cpuTimeP50 is reported in MICROseconds (a healthy worker reads in the
    // thousands here while errors stay zero) — convert to ms for the 10ms
    // CPU limit comparison.
    const p50 = Number(q?.cpuTimeP50);
    if (Number.isFinite(p50) && p50 >= 0) { out.cpuP50Ms = Math.round(p50 / 10) / 100; out.connected = true; }
  } catch { /* estimated fallback */ }
  try {
    const groups = ops?.viewer?.accounts?.[0]?.r;
    if (Array.isArray(groups) && groups.length > 0) {
      let a = 0, b = 0, seen = false;
      for (const g of groups) {
        const n = Number(g?.sum?.requests);
        if (!Number.isFinite(n) || n < 0) continue;
        seen = true;
        const cls = r2ActionClass(g?.dimensions?.actionType);
        if (cls === "A") a += n; else if (cls === "B") b += n;
      }
      if (seen) { out.r2ClassAOpsMonth = Math.round(a); out.r2ClassBOpsMonth = Math.round(b); out.connected = true; }
    }
  } catch { /* estimated fallback */ }
  try {
    const groups = stor?.viewer?.accounts?.[0]?.s;
    if (Array.isArray(groups)) {
      let best: number | null = null;
      for (const g of groups) {
        const v = Number(g?.max?.payloadSize);
        if (Number.isFinite(v) && v >= 0 && (best === null || v > best)) best = v;
      }
      if (best !== null) { out.r2Bytes = Math.round(best); out.connected = true; }
    }
  } catch { /* estimated fallback */ }
  // D1 storage is a REST fetch, not GraphQL — the helper never throws, so a
  // plain null check degrades the section like every other live query.
  if (d1Dbs !== null) { out.d1Databases = d1Dbs; out.connected = true; }
  out.at = t;
  cfLiveCache = { at: t, data: out };
  return out;
}

/** Real bucket size via R2 list() (no API token needed). The page walk is
 *  capped so a huge bucket can't blow the free 50-subrequest cap; past the
 *  cap the partial sum is still a real lower bound — better than guessing. */
async function r2BucketBytes(env: Env): Promise<number | null> {
  if (!env.CONTENT) return null;
  try {
    let bytes = 0, cursor: string | undefined = undefined, pages = 0;
    for (;;) {
      const listed = await env.CONTENT.list({ limit: 1000, cursor });
      const objs = (listed as unknown as { objects?: Array<{ size?: unknown }> }).objects;
      if (Array.isArray(objs)) {
        for (const o of objs) {
          const s = Number(o?.size);
          if (Number.isFinite(s) && s > 0) bytes += s;
        }
      }
      pages++;
      const meta = listed as unknown as { truncated?: boolean; cursor?: string };
      if (!meta.truncated || pages >= CF_R2_LIST_PAGE_CAP) break;
      if (!meta.cursor) break;
      cursor = meta.cursor;
    }
    return bytes;
  } catch {
    return null;
  }
}

/* ── Cloudflare Free Tier Analytics & Quota Limits ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/cloudflare-limits") {
    const t = now();
    const d = new Date(t);
    const startOfToday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
    const timeToResetMs = Math.max(0, startOfTomorrow - t);
    const startOfMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

    // Run parallel queries across D1 tables
    const [
      analyticsRow,
      qstatsRow,
      qstatsTodayRow,
      progressRow,
      contentRow,
      auditRow,
      usersRow,
      sessionsRow,
      ticketsRow,
      webhooksRow,
      identitiesRow,
      resetsRow,
      verifiesRow,
      apiPerfRows,
    ] = await Promise.all([
      telemetryDb(env).prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS this_month FROM analytics_events").bind(startOfToday, startOfMonth).first<{ total: number; today: number; this_month: number }>().catch(() => ({ total: 0, today: 0, this_month: 0 })),
      telemetryDb(env).prepare("SELECT COUNT(*) AS total, SUM(count) AS total_responses FROM question_choice_stats").first<{ total: number; total_responses: number }>().catch(() => ({ total: 0, total_responses: 0 })),
      telemetryDb(env).prepare("SELECT COUNT(*) AS n FROM question_choice_stats WHERE updated_at >= ?").bind(startOfToday).first<{ n: number }>().catch(() => ({ n: 0 })),
      syncDbProgressTotals(env),
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published, SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts FROM content_objects").first<{ total: number; published: number; drafts: number }>().catch(() => ({ total: 0, published: 0, drafts: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today FROM admin_audit").bind(startOfToday).first<{ total: number; today: number }>().catch(() => ({ total: 0, today: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>().catch(() => ({ total: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today, SUM(CASE WHEN revoked_at IS NULL AND expires_at > ? THEN 1 ELSE 0 END) AS active FROM sessions").bind(startOfToday, t).first<{ total: number; today: number; active: number }>().catch(() => ({ total: 0, today: 0, active: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open FROM support_tickets").first<{ total: number; open: number }>().catch(() => ({ total: 0, open: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total FROM webhooks").first<{ total: number }>().catch(() => ({ total: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total FROM auth_identities").first<{ total: number }>().catch(() => ({ total: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total FROM password_reset_tokens").first<{ total: number }>().catch(() => ({ total: 0 })),
      env.DB.prepare("SELECT COUNT(*) AS total FROM email_verify_tokens").first<{ total: number }>().catch(() => ({ total: 0 })),
      telemetryDb(env).prepare("SELECT value FROM analytics_events WHERE event_type = 'api_call' AND value IS NOT NULL AND created_at >= ? ORDER BY value ASC LIMIT 5000").bind(startOfToday).all<{ value: number }>().catch(() => ({ results: [] })),
    ]);

    const analyticsToday = Number(analyticsRow?.today) || 0;
    const analyticsThisMonth = Number(analyticsRow?.this_month) || 0;
    const auditToday = Number(auditRow?.today) || 0;
    const sessionsToday = Number(sessionsRow?.today) || 0;
    const qstatsToday = Number(qstatsTodayRow?.n) || 0;

    // Live Cloudflare usage (all-null + connected:false when no API token is
    // configured) and real R2 bucket bytes via list() as the storage fallback
    // chain: GraphQL gauge → list() sum → size estimate.
    const live = await fetchCfLiveUsage(env, new Date(startOfToday).toISOString(), new Date(startOfMonth).toISOString(), new Date(t).toISOString());
    const listedR2Bytes = live.r2Bytes !== null ? null : await r2BucketBytes(env);
    // Real D1 storage from the REST API: per-database file sizes for the
    // panel's database table, summed for the storage gauge. Falls back to
    // the per-table estimates when no token is configured or it lacks the
    // D1 Read permission — the same per-section degradation as every other
    // live query.
    const measuredD1Bytes = live.d1Databases
      ? live.d1Databases.reduce((sum, db) => sum + db.bytes, 0)
      : null;

    // Estimate total D1 writes today across all features: the two measured
    // telemetry counters, audit/session activity, plus 15% headroom for
    // sync pushes and misc single-row writes.
    const estimatedD1WritesToday = analyticsToday + qstatsToday + auditToday + sessionsToday + Math.round(analyticsToday * 0.15);

    // Free Tier limits (verified against the pricing docs 2026-09: D1 is
    // 5M reads/day, 100k writes/day, 500 MB storage PER DATABASE; Workers
    // 100k reqs/day, 10ms CPU, 50 subrequests; R2 10 GB-mo, 1M Class A,
    // 10M Class B). Unlike reads/writes, the storage ceiling does NOT pool —
    // each bound D1 database gets its own 500 MB.
    const LIMITS = {
      workerDailyRequests: 100_000,
      d1DailyWrites: 100_000,
      d1DailyReads: 5_000_000,
      d1DatabaseStorageBytes: D1_FREE_TIER_DB_BYTES * d1ShardCount(env), // 500 MB × bound databases
      r2StorageBytes: 10 * 1024 * 1024 * 1024, // 10 GB
      r2MonthlyClassA: 1_000_000,
      r2MonthlyClassB: 10_000_000,
      workerCpuTimeMs: 10,
      workerSubrequests: 50,
      analyticsDailyWriteCap: ANALYTICS_DAILY_WRITE_CAP,
      qstatsDailyWriteCap: QBANK_STATS_DAILY_WRITE_CAP,
    };

    // Table stats with estimated byte sizes. `shard` names the D1 database
    // that holds the table ("core" on single-database deployments too — the
    // shards fall back to DB there, so the label is about logical ownership).
    const d1Tables = [
      { table: "analytics_events", shard: "telemetry", rowCount: Number(analyticsRow?.total) || 0, estimatedBytes: (Number(analyticsRow?.total) || 0) * 220, retention: "30 days" },
      { table: "progress_documents", shard: "sync", rowCount: Number(progressRow?.total) || 0, estimatedBytes: Number(progressRow?.compressed_bytes) || (Number(progressRow?.total) || 0) * 1024, retention: "Active" },
      { table: "question_choice_stats", shard: "telemetry", rowCount: Number(qstatsRow?.total) || 0, estimatedBytes: (Number(qstatsRow?.total) || 0) * 128, retention: "90 days" },
      { table: "admin_audit", shard: "core", rowCount: Number(auditRow?.total) || 0, estimatedBytes: (Number(auditRow?.total) || 0) * 280, retention: "365 days" },
      { table: "sessions", shard: "core", rowCount: Number(sessionsRow?.total) || 0, estimatedBytes: (Number(sessionsRow?.total) || 0) * 160, retention: "Active (max 12/user)" },
      { table: "users", shard: "core", rowCount: Number(usersRow?.total) || 0, estimatedBytes: (Number(usersRow?.total) || 0) * 256, retention: "Permanent" },
      { table: "content_objects", shard: "core", rowCount: Number(contentRow?.total) || 0, estimatedBytes: (Number(contentRow?.total) || 0) * 512, retention: "Managed" },
      { table: "support_tickets", shard: "core", rowCount: Number(ticketsRow?.total) || 0, estimatedBytes: (Number(ticketsRow?.total) || 0) * 350, retention: "Active" },
      { table: "auth_identities", shard: "core", rowCount: Number(identitiesRow?.total) || 0, estimatedBytes: (Number(identitiesRow?.total) || 0) * 120, retention: "Permanent" },
      { table: "webhooks", shard: "core", rowCount: Number(webhooksRow?.total) || 0, estimatedBytes: (Number(webhooksRow?.total) || 0) * 180, retention: "Config" },
      { table: "password_reset_tokens", shard: "core", rowCount: Number(resetsRow?.total) || 0, estimatedBytes: (Number(resetsRow?.total) || 0) * 120, retention: "1 hour" },
      { table: "email_verify_tokens", shard: "core", rowCount: Number(verifiesRow?.total) || 0, estimatedBytes: (Number(verifiesRow?.total) || 0) * 120, retention: "1 hour" },
    ];

    const totalD1Rows = d1Tables.reduce((acc, t) => acc + t.rowCount, 0);
    const totalD1EstimatedBytes = d1Tables.reduce((acc, t) => acc + t.estimatedBytes, 0);
    // Storage gauge value: real measured file size when every bound database
    // answered the pragma query, else the per-table row-count estimate.
    const d1StorageCurrent = measuredD1Bytes ?? totalD1EstimatedBytes;

    // Worker requests: live GraphQL sum when connected, else the D1-telemetry
    // heuristic (analytics batches ×2, sessions ×5 — public reads included).
    const estimatedWorkerRequestsToday = Math.max(analyticsToday * 2, sessionsToday * 5, 1);
    const workerRequestsToday = live.workersRequestsToday ?? estimatedWorkerRequestsToday;
    // D1 reads have no confirmed per-database usage API — estimated from
    // telemetry volume (no confirmed schema yet; see block comment above).
    const estimatedD1ReadsToday = Math.max(analyticsToday * 4, sessionsToday * 20, 10);

    // R2 storage: GraphQL gauge → real list() sum → content-object estimate.
    const totalContentObjects = Number(contentRow?.total) || 0;
    const estimatedR2Bytes = totalContentObjects * 120 * 1024 + (Number(progressRow?.total) || 0) * 16 * 1024;
    const r2Bytes = live.r2Bytes ?? listedR2Bytes ?? estimatedR2Bytes;
    const r2ClassA = live.r2ClassAOpsMonth ?? (totalContentObjects * 4 + auditToday + 10);
    const r2ClassB = live.r2ClassBOpsMonth ?? Math.max(analyticsThisMonth * 3, 50);

    // Latency metrics
    const apiLatencies = (apiPerfRows?.results || []).map((r) => Number(r.value)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const p50Latency = percentile(apiLatencies, 50) ?? 8;
    const p95Latency = percentile(apiLatencies, 95) ?? 24;
    const maxLatency = apiLatencies.length ? apiLatencies[apiLatencies.length - 1] : 35;

    // CPU time: live p50 when connected. Otherwise we only have CLIENT-measured
    // API latency — never compare that to the 10ms CPU limit (any real network
    // RTT would false-alarm), so the metric reports healthy/0 and the UI shows
    // the latency framing instead (see sources.workerCpuTime).
    const cpuLive = live.cpuP50Ms !== null;
    const cpuCurrent = live.cpuP50Ms ?? p50Latency;

    const calcStatus = (cur: number, lim: number): "healthy" | "warning" | "critical" | "exceeded" => {
      const pct = (cur / lim) * 100;
      if (pct >= 100) return "exceeded";
      if (pct >= 85) return "critical";
      if (pct >= 60) return "warning";
      return "healthy";
    };

    const metrics = {
      workerRequests: {
        current: workerRequestsToday,
        limit: LIMITS.workerDailyRequests,
        unit: "requests/day",
        percentage: Math.min(100, Math.round((workerRequestsToday / LIMITS.workerDailyRequests) * 1000) / 10),
        status: calcStatus(workerRequestsToday, LIMITS.workerDailyRequests),
        period: "daily" as const,
      },
      d1Writes: {
        current: estimatedD1WritesToday,
        limit: LIMITS.d1DailyWrites,
        unit: "writes/day",
        percentage: Math.min(100, Math.round((estimatedD1WritesToday / LIMITS.d1DailyWrites) * 1000) / 10),
        status: calcStatus(estimatedD1WritesToday, LIMITS.d1DailyWrites),
        period: "daily" as const,
      },
      d1Reads: {
        current: estimatedD1ReadsToday,
        limit: LIMITS.d1DailyReads,
        unit: "reads/day",
        percentage: Math.min(100, Math.round((estimatedD1ReadsToday / LIMITS.d1DailyReads) * 1000) / 10),
        status: calcStatus(estimatedD1ReadsToday, LIMITS.d1DailyReads),
        period: "daily" as const,
      },
      d1Storage: {
        current: d1StorageCurrent,
        limit: LIMITS.d1DatabaseStorageBytes,
        unit: "bytes",
        percentage: Math.min(100, Math.round((d1StorageCurrent / LIMITS.d1DatabaseStorageBytes) * 1000) / 10),
        status: calcStatus(d1StorageCurrent, LIMITS.d1DatabaseStorageBytes),
        period: "storage" as const,
      },
      r2Storage: {
        current: r2Bytes,
        limit: LIMITS.r2StorageBytes,
        unit: "bytes",
        percentage: Math.min(100, Math.round((r2Bytes / LIMITS.r2StorageBytes) * 1000) / 10),
        status: calcStatus(r2Bytes, LIMITS.r2StorageBytes),
        period: "storage" as const,
      },
      r2ClassAOps: {
        current: r2ClassA,
        limit: LIMITS.r2MonthlyClassA,
        unit: "ops/month",
        percentage: Math.min(100, Math.round((r2ClassA / LIMITS.r2MonthlyClassA) * 1000) / 10),
        status: calcStatus(r2ClassA, LIMITS.r2MonthlyClassA),
        period: "monthly" as const,
      },
      r2ClassBOps: {
        current: r2ClassB,
        limit: LIMITS.r2MonthlyClassB,
        unit: "ops/month",
        percentage: Math.min(100, Math.round((r2ClassB / LIMITS.r2MonthlyClassB) * 1000) / 10),
        status: calcStatus(r2ClassB, LIMITS.r2MonthlyClassB),
        period: "monthly" as const,
      },
      workerCpuTime: {
        current: cpuCurrent,
        limit: LIMITS.workerCpuTimeMs,
        unit: "ms (p50 / 10ms CPU limit)",
        percentage: cpuLive ? Math.min(100, Math.round((cpuCurrent / LIMITS.workerCpuTimeMs) * 1000) / 10) : 0,
        status: cpuLive ? calcStatus(cpuCurrent, LIMITS.workerCpuTimeMs) : ("healthy" as const),
        period: "per_request" as const,
      },
      workerSubrequests: {
        current: 1,
        limit: LIMITS.workerSubrequests,
        unit: "subrequests/invocation",
        percentage: Math.min(100, Math.round((1 / LIMITS.workerSubrequests) * 1000) / 10),
        status: "healthy" as const,
        period: "per_request" as const,
      },
    };

    const statusWeights: Record<string, number> = { healthy: 0, warning: 1, critical: 2, exceeded: 3 };
    const allStatuses = [
      metrics.workerRequests.status,
      metrics.d1Writes.status,
      metrics.d1Reads.status,
      metrics.d1Storage.status,
      metrics.r2Storage.status,
      metrics.r2ClassAOps.status,
      metrics.r2ClassBOps.status,
      // CPU only counts when it's real: the estimated placeholder is always
      // healthy and must never drive the banner.
      ...(cpuLive ? [metrics.workerCpuTime.status] : []),
    ];
    const highestStatusWeight = Math.max(...allStatuses.map((s) => statusWeights[s] ?? 0));
    const overallStatus = highestStatusWeight >= 3 ? "exceeded" : highestStatusWeight === 2 ? "critical" : highestStatusWeight === 1 ? "warning" : "healthy";

    return json({
      status: overallStatus,
      resetAt: startOfTomorrow,
      timeToResetMs,
      // Live wiring state: the panel shows a Live badge vs the connect-steps
      // banner off this. Older workers omit these fields — the UI treats a
      // missing `sources` as all-estimated.
      connected: live.connected,
      liveAt: live.connected ? live.at : null,
      sources: {
        workerRequests: live.workersRequestsToday !== null ? "live" : "estimated",
        d1Writes: "estimated",
        d1Reads: "estimated",
        d1Storage: live.d1Databases !== null ? "live" : "estimated",
        r2Storage: live.r2Bytes !== null || listedR2Bytes !== null ? "live" : "estimated",
        r2ClassAOps: live.r2ClassAOpsMonth !== null ? "live" : "estimated",
        r2ClassBOps: live.r2ClassBOpsMonth !== null ? "live" : "estimated",
        workerCpuTime: cpuLive ? "live" : "estimated",
      },
      metrics,
      caps: {
        analyticsWriteCap: {
          current: analyticsToday,
          cap: LIMITS.analyticsDailyWriteCap,
          percentage: Math.min(100, Math.round((analyticsToday / LIMITS.analyticsDailyWriteCap) * 1000) / 10),
        },
        qstatsWriteCap: {
          current: qstatsToday,
          cap: LIMITS.qstatsDailyWriteCap,
          percentage: Math.min(100, Math.round((qstatsToday / LIMITS.qstatsDailyWriteCap) * 1000) / 10),
        },
      },
      executionLatency: {
        p50: p50Latency,
        p95: p95Latency,
        max: maxLatency,
      },
      d1Tables,
      totalD1Rows,
      totalD1EstimatedBytes,
      d1MeasuredBytes: measuredD1Bytes,
      d1Databases: live.d1Databases ?? undefined,
      d1DatabaseLimitBytes: D1_FREE_TIER_DB_BYTES,
      d1Shards: d1ShardCount(env),
      safetyThrottles: [
        { name: "Analytics Daily Write Cap", threshold: `${ANALYTICS_DAILY_WRITE_CAP.toLocaleString("en-US")} / day`, status: "active", protectedQuota: "D1 Database Writes (100k/day)" },
        { name: "QBank Choice Stats Write Cap", threshold: `${QBANK_STATS_DAILY_WRITE_CAP.toLocaleString("en-US")} / day`, status: "active", protectedQuota: "D1 Database Writes (100k/day)" },
        { name: "Per-IP Analytics Ingest Rate Limit", threshold: "12 batches / min", status: "active", protectedQuota: "Worker Requests & D1 Writes" },
        { name: "Per-User Analytics Rate Limit", threshold: "12 batches / min", status: "active", protectedQuota: "D1 User Write Quota" },
        { name: "Subrequest Batch Chunking", threshold: "Bounded ≤40 / run", status: "active", protectedQuota: "Worker Subrequests (50/req free cap)" },
        { name: "Automated Data Pruning Crons", threshold: "30-day analytics / 90-day qstats", status: "active", protectedQuota: "D1 Storage & Row Budgets" },
        { name: "Client PII & Token Redaction", threshold: "6 scrub regexes", status: "active", protectedQuota: "Telemetry Privacy" },
      ],
    }, 200, origin, log);
  }

  return null;
}

/* ── Support tickets ─────────────────────────────────────────────────────
 *
 * Users report problems from Settings, QBank (per-question) and the Library
 * article reader. Submission is pre-auth (local guests have no account);
 * signed-in reporters get their account attached so admins can identify them.
 * The client generates the ticket id so its local receipt merges cleanly
 * with server status updates later.
 */

const TICKET_SOURCES = new Set(["settings", "qbank", "library"]);
const TICKET_CATEGORIES = new Set(["bug", "content", "feature", "other"]);
const TICKET_STATUSES = new Set(["open", "in_progress", "resolved"]);

function mapTicketRow(r: any) {
  let context: unknown = null;
  try { context = r.context ? JSON.parse(r.context) : null; } catch { context = null; }
  return {
    id: r.id,
    userId: r.user_id ?? null,
    username: r.username ?? null,
    source: r.source,
    category: r.category,
    subject: r.subject,
    message: r.message,
    context,
    status: r.status,
    reply: r.reply ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at ?? null,
    // Joined account info (admin list only — undefined when not joined).
    userInfo: r.acct_username === undefined ? undefined : r.user_id ? {
      displayName: r.acct_display_name ?? null,
      username: r.acct_username ?? null,
      email: r.acct_email ?? null,
      role: r.acct_role ?? null,
      createdAt: r.acct_created_at ?? null,
    } : null,
  };
}

async function handleSupportTicketCreate(request: Request, env: Env, session: Session | null, origin: string, log: Logger): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 32_000) return json({ error: "Request body too large" }, 413, origin, log);
  const body = await readJson(request);
  if (!body || typeof body !== "object") return json({ error: "Invalid request" }, 400, origin, log);
  const tid = typeof body.id === "string" && body.id.length > 0 && body.id.length <= 64 && !/[\x00-\x1f\x7f]/.test(body.id) ? body.id : null;
  const category = typeof body.category === "string" && TICKET_CATEGORIES.has(body.category) ? body.category : null;
  const source = typeof body.source === "string" && TICKET_SOURCES.has(body.source) ? body.source : null;
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 200) : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 5000) : "";
  if (!tid || !category || !source || !subject || !message) return json({ error: "Invalid ticket payload" }, 400, origin, log);
  let context: string | null = null;
  if (body.context && typeof body.context === "object") {
    // QBank reports attach the full question (stem + choices + explanation),
    // which can reach a few KB of text — cap generously but bounded.
    try { context = JSON.stringify(body.context).slice(0, 16_000); } catch { context = null; }
  }
  const t = now();
  try {
    await env.DB.prepare(
      "INSERT INTO support_tickets (id, user_id, username, source, category, subject, message, context, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)"
    ).bind(tid, session?.user.id ?? null, session ? String(session.user.display_name || session.user.username || "").slice(0, 80) : null, source, category, subject, message, context, t, t).run();
  } catch (error: any) {
    const msg = String(error?.message || "");
    // A client retry for a ticket that already landed is success, not failure —
    // only a genuine insert error (disk, constraint other than PK) is a 500.
    if (/UNIQUE/i.test(msg)) return json({ ok: true }, 200, origin, log);
    log.error("support ticket insert failed", { error: msg });
    return json({ error: "Could not file the ticket" }, 500, origin, log);
  }
  return json({ ok: true }, 200, origin, log);
}

async function handleSupportTicketsMine(env: Env, session: Session, origin: string, log: Logger): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  ).bind(session.user.id).all();
  return json({ tickets: (rows.results || []).map(mapTicketRow) }, 200, origin, log);
}

/* ── Admin handler ── */
async function handleAdmin(request: Request, env: Env, session: Session, url: URL, origin: string, log: Logger): Promise<Response | null> {
  const path = url.pathname;

  /* ── Analytics (admin only) ── */
  if (path.startsWith("/v1/admin/analytics/")) {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    const r = await handleAnalytics(request, env, url, origin, log);
    if (r) return r;
    return json({ error: "Not found" }, 404, origin, log);
  }

  /* ── Identity ── */
  if (request.method === "GET" && path === "/v1/admin/me") {
    return json({ user: adminPublicUser(session.user), capabilities: {
      manageUsers: isAdmin(session), manageContent: isAdminOrContent(session),
      approveContent: isAdmin(session), publishDirect: isAdmin(session),
      viewStats: isAdmin(session), viewAudit: isAdmin(session), manageSessions: isAdmin(session),
    }}, 200, origin, log);
  }

  /* ── Cloudflare Access email (for the admin shell's "protected" gate) ──
   *
   * Returns the `CF-Access-Authenticated-User-Email` request header if it's
   * present (i.e. the Worker is deployed behind a Cloudflare Zero Trust
   * Access policy). The admin shell uses this to decide whether to render
   * the admin UI or show a "protected" screen.
   *
   * Requires a valid admin/content_admin bearer token (like all /v1/admin/*
   * endpoints). The header itself is set by Cloudflare Access before the
   * request reaches the Worker — the Worker just echoes it back.
   *
   * Returns: `{ email: string | null }`
   */
  if (request.method === "GET" && path === "/v1/admin/access") {
    const email = request.headers.get("CF-Access-Authenticated-User-Email")
      ?? request.headers.get("cf-access-authenticated-user-email");
    return json({ email: email ?? null }, 200, origin, { requestId: log.requestId, cacheControl: "no-store" });
  }

  /* ── Email delivery admin ── */
  if (path === "/v1/admin/email" || path === "/v1/admin/email/test") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);

    // POST /v1/admin/email/test — send a branded test email to the acting
    // admin's own address. The fastest way to verify the Gmail relay or
    // Resend setup end to end.
    if (request.method === "POST" && path === "/v1/admin/email/test") {
      if (!emailProviderReady(env) || !env.APP_ORIGIN) return json({ error: "Email is not configured" }, 400, origin, log);
      const to = session.user.email;
      if (!to) return json({ error: "Your account has no email address to send to" }, 400, origin, log);
      try {
        const { html, text } = testEmail();
        const res = await sendEmail(env, env.DB, { to, subject: "Osler test email", text, html });
        return json({ ok: res.ok, providerStatus: res.status }, 200, origin, log);
      } catch (error: any) {
        return json({ error: String(error?.message ?? error).slice(0, 200) }, 502, origin, log);
      }
    }

    // GET /v1/admin/email — provider status, relay health, delivery stats,
    // and the recent delivery log (no bodies/links are stored).
    if (request.method === "GET" && path === "/v1/admin/email") {
      const todayMs = Date.parse(utcDateString(now()));
      const [statsRow, logRows, relayHealth] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, MAX(created_at) AS last_at FROM email_log")
          .bind(todayMs).first<{ total: number; today: number | null; failed: number | null; last_at: number | null }>().catch(() => null),
        env.DB.prepare("SELECT to_address, subject, provider, status, error, created_at FROM email_log ORDER BY created_at DESC LIMIT 50").all().catch(() => ({ results: [] })),
        (async () => {
          try {
            if (env.EMAIL) {
              const r = await env.EMAIL.fetch("https://osler-email/health");
              return { ok: r.ok, status: r.status };
            }
            if (env.EMAIL_WORKER_URL) {
              const r = await fetch(`${env.EMAIL_WORKER_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
              return { ok: r.ok, status: r.status };
            }
          } catch {
            return { ok: false, status: 0 };
          }
          return null;
        })(),
      ]);
      return json({
        provider: {
          mode: emailProviderName(env),
          binding: !!env.EMAIL,
          relayUrl: env.EMAIL_WORKER_URL ?? null,
          resendConfigured: !!(env.RESEND_API_KEY && env.EMAIL_FROM),
          ready: emailProviderReady(env),
        },
        relayHealth,
        stats: {
          total: Number(statsRow?.total) || 0,
          today: Number(statsRow?.today) || 0,
          failed: Number(statsRow?.failed) || 0,
          lastSentAt: statsRow?.last_at ? Number(statsRow.last_at) : null,
        },
        log: (logRows.results || []).map((r: any) => ({
          to: r.to_address,
          subject: r.subject,
          provider: r.provider,
          status: r.status,
          error: r.error ?? null,
          createdAt: Number(r.created_at),
        })),
      }, 200, origin, log);
    }
  }

  /* ── Stats ── */
  if (request.method === "GET" && path === "/v1/admin/stats") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    const [userCount, sessionCount, contentCount, pendingCount, publishedCount, draftCount] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as n FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?").bind(now()).first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects WHERE status = 'pending'").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects WHERE status = 'published'").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects WHERE status = 'draft'").first(),
    ]);
    return json({ userCount: (userCount as any)?.n ?? 0, sessionCount: (sessionCount as any)?.n ?? 0, contentCount: (contentCount as any)?.n ?? 0, pendingCount: (pendingCount as any)?.n ?? 0, publishedCount: (publishedCount as any)?.n ?? 0, draftCount: (draftCount as any)?.n ?? 0 }, 200, origin, log);
  }

  /* ── Audit log ── */
  if (request.method === "GET" && path === "/v1/admin/audit") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const action = (url.searchParams.get("action") || "").trim();
    const limit = 50; const offset = (page - 1) * limit;
    let rows: any, total: any;
    if (action) {
      [rows, total] = await Promise.all([
        env.DB.prepare("SELECT a.*, u.username as actor_username, u.display_name as actor_display_name FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action = ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?").bind(action, limit, offset).all(),
        env.DB.prepare("SELECT COUNT(*) as n FROM admin_audit WHERE action = ?").bind(action).first(),
      ]);
    } else {
      [rows, total] = await Promise.all([
        env.DB.prepare("SELECT a.*, u.username as actor_username, u.display_name as actor_display_name FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
        env.DB.prepare("SELECT COUNT(*) as n FROM admin_audit").first(),
      ]);
    }
    return json({ items: (rows.results || []).map((r: any) => ({ id: r.id, actorId: r.actor_id, actorUsername: r.actor_username ?? null, actorDisplayName: r.actor_display_name ?? null, action: r.action, targetId: r.target_id ?? null, detail: r.detail ? JSON.parse(r.detail) : null, createdAt: r.created_at })), total: (total as any)?.n ?? 0, page, limit }, 200, origin, log);
  }

  /* ── Audit verify (M6 HMAC chain) ── */
  if (request.method === "GET" && path === "/v1/admin/audit/verify") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    const result = await verifyAuditChain(env);
    return json(result, 200, origin, log);
  }

  /* ── Support tickets ── */
  if (path.startsWith("/v1/admin/tickets")) {
    if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
    const ticketPatch = path.match(/^\/v1\/admin\/tickets\/([^/]+)$/);
    if (request.method === "PATCH" && ticketPatch) {
      const body = await readJson(request);
      const status = typeof body.status === "string" && TICKET_STATUSES.has(body.status) ? body.status : null;
      const reply = body.reply === null || body.reply === undefined ? null : typeof body.reply === "string" ? body.reply.trim().slice(0, 2000) || null : undefined;
      if (!status && reply === undefined) return json({ error: "Nothing to update" }, 400, origin, log);
      const tid = decodeURIComponent(ticketPatch[1]);
      const existing = await env.DB.prepare("SELECT * FROM support_tickets WHERE id = ?").bind(tid).first<any>();
      if (!existing) return json({ error: "Ticket not found" }, 404, origin, log);
      const nextStatus = status ?? existing.status;
      const nextReply = reply === undefined ? existing.reply ?? null : reply;
      const t = now();
      await env.DB.prepare(
        "UPDATE support_tickets SET status = ?, reply = ?, updated_at = ?, resolved_at = ? WHERE id = ?"
      ).bind(nextStatus, nextReply, t, nextStatus === "resolved" ? t : null, tid).run();
      await auditLog(env, session.user.id, "ticket.update", ticketPatch[1], { status: nextStatus, replied: nextReply != null });
      const joined = await env.DB.prepare(
        `SELECT t.*, u.username AS acct_username, u.display_name AS acct_display_name, u.email AS acct_email, u.role AS acct_role, u.created_at AS acct_created_at
         FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`
      ).bind(tid).first<any>();
      return json({ ticket: mapTicketRow(joined ? { ...joined, status: nextStatus, reply: nextReply, updated_at: t, resolved_at: nextStatus === "resolved" ? t : null } : { ...existing, status: nextStatus, reply: nextReply, updated_at: t }) }, 200, origin, log);
    }
    if (request.method === "DELETE" && ticketPatch) {
      // Only resolved tickets may be deleted — an open report is actionable.
      const tid = decodeURIComponent(ticketPatch[1]);
      const existing = await env.DB.prepare("SELECT status FROM support_tickets WHERE id = ?").bind(tid).first<{ status: string }>();
      if (!existing) return json({ error: "Ticket not found" }, 404, origin, log);
      if (existing.status !== "resolved") return json({ error: "Only resolved tickets can be deleted" }, 409, origin, log);
      await env.DB.prepare("DELETE FROM support_tickets WHERE id = ?").bind(tid).run();
      await auditLog(env, session.user.id, "ticket.delete", ticketPatch[1], null);
      return json({ ok: true }, 200, origin, log);
    }
    if (request.method === "GET" && path === "/v1/admin/tickets") {
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const statusParam = url.searchParams.get("status") || "";
      const limit = 25;
      const offset = (page - 1) * limit;
      const where = TICKET_STATUSES.has(statusParam) ? "WHERE t.status = ?" : "";
      const binds: unknown[] = TICKET_STATUSES.has(statusParam) ? [statusParam] : [];
      const [rows, total, openCount] = await Promise.all([
        env.DB.prepare(
          `SELECT t.*, u.username AS acct_username, u.display_name AS acct_display_name, u.email AS acct_email, u.role AS acct_role, u.created_at AS acct_created_at
           FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
        ).bind(...binds, limit, offset).all(),
        env.DB.prepare(`SELECT COUNT(*) as n FROM support_tickets ${TICKET_STATUSES.has(statusParam) ? "WHERE status = ?" : ""}`).bind(...binds).first(),
        env.DB.prepare("SELECT COUNT(*) as n FROM support_tickets WHERE status = 'open'").first(),
      ]);
      return json({
        items: (rows.results || []).map(mapTicketRow),
        total: (total as any)?.n ?? 0,
        openCount: (openCount as any)?.n ?? 0,
        page,
        limit,
      }, 200, origin, log);
    }
  }


  /* ── Users ── */
  if (path.startsWith("/v1/admin/users")) {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    if (request.method === "GET" && path === "/v1/admin/users") {
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const q = (url.searchParams.get("q") || "").trim();
      const limit = 25; const offset = (page - 1) * limit;
      let rows: any, total: any;
      if (q) {
        const like = `%${escapeLike(q)}%`;
        [rows, total] = await Promise.all([
          env.DB.prepare("SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(like, like, like, limit, offset).all(),
          env.DB.prepare("SELECT COUNT(*) as n FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'").bind(like, like, like).first(),
        ]);
      } else {
        [rows, total] = await Promise.all([
          env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
          env.DB.prepare("SELECT COUNT(*) as n FROM users").first(),
        ]);
      }
      return json({ users: (rows.results || []).map(adminPublicUser), total: (total as any)?.n ?? 0, page, limit }, 200, origin, log);
    }
    const sessionsMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/sessions$/);
    if (sessionsMatch && request.method === "GET") {
      const targetId = sessionsMatch[1];
      const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(targetId).first();
      if (!user) return json({ error: "User not found" }, 404, origin, log);
      const rows = await env.DB.prepare("SELECT id, expires_at, created_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(targetId).all();
      return json({ sessions: rows.results || [] }, 200, origin, log);
    }
    if (sessionsMatch && request.method === "DELETE") {
      const targetId = sessionsMatch[1];
      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
      if (!user) return json({ error: "User not found" }, 404, origin, log);
      await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), targetId).run();
      await auditLog(env, session.user.id, "revoke_sessions", targetId, { username: user.username }, log);
      return json({ ok: true }, 200, origin, log);
    }
    const progressMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/progress$/);
    if (progressMatch && request.method === "GET") {
      const targetId = progressMatch[1];
      const targetUser = await env.DB.prepare("SELECT id, sync_shard FROM users WHERE id = ?").bind(targetId).first<SyncUser>();
      if (!targetUser) return json({ error: "User not found" }, 404, origin, log);
      const docs = await getAllDocuments(env, targetUser);
      const summary: Record<string, { recordCount: number; updatedAt: number }> = {};
      for (const kind of SYNC_KINDS) summary[kind] = { recordCount: Object.keys(docs[kind].records).length, updatedAt: docs[kind].updatedAt };
      return json(summary, 200, origin, log);
    }
    const userIdMatch = path.match(/^\/v1\/admin\/users\/([^/]+)$/);
    const resetPasswordMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/reset-password$/);
    const geminiKeyMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/gemini-key$/);
    const emailVerifyMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/email-verification$/);
    if (userIdMatch) {
      const targetId = userIdMatch[1];
      if (request.method === "GET") {
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
        if (!user) return json({ error: "User not found" }, 404, origin, log);
        const [sessions, content] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?").bind(targetId, now()).first(),
          env.DB.prepare("SELECT id, title, status, content_type, updated_at FROM content_objects WHERE created_by = ? ORDER BY updated_at DESC LIMIT 25").bind(targetId).all(),
        ]);
        return json({ ...adminPublicUser(user), hasPassword: !!user.has_password, hasGeminiKey: !!user.gemini_api_key, emailVerified: !!user.email_verified_at && user.email_verified_at > 0, activeSessionCount: (sessions as any)?.n ?? 0, content: (content.results || []).map((c: any) => ({ id: c.id, title: c.title, status: c.status, contentType: c.content_type, updatedAt: c.updated_at })) }, 200, origin, log);
      }
      if (request.method === "PATCH") {
        const body = await readJson(request);
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
        if (!user) return json({ error: "User not found" }, 404, origin, log);
        const validRoles = new Set(["student", "admin", "content_admin"]);
        if (targetId === session.user.id && body.role && body.role !== "admin") return json({ error: "You cannot demote yourself" }, 400, origin, log);
        const newRole = body.role && validRoles.has(body.role) ? body.role : user.role;
        const newName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) || user.display_name : user.display_name;
        await env.DB.prepare("UPDATE users SET role = ?, display_name = ?, updated_at = ? WHERE id = ?").bind(newRole, newName, now(), targetId).run();
        await auditLog(env, session.user.id, "change_role", targetId, { from: user.role, to: newRole, displayName: newName }, log);
        const updated = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
        return json(adminPublicUser(updated), 200, origin, log);
      }
      if (request.method === "DELETE") {
        if (targetId === session.user.id) return json({ error: "Cannot delete your own account" }, 400, origin, log);
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
        if (!user) return json({ error: "User not found" }, 404, origin, log);
        await env.DB.batch([
          env.DB.prepare("PRAGMA foreign_keys = ON;"),
          env.DB.prepare("UPDATE content_objects SET created_by = ? WHERE created_by = ?").bind(session.user.id, targetId),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM auth_identities WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM auth_handoffs WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId),
        ]);
        // progress_documents may live on any sync shard, where the users FK
        // cannot cascade across databases — delete it explicitly from the
        // user's own shard, after the core removal succeeded (an orphaned
        // progress row is inert; a deleted user who still owns one is a
        // storage leak).
        const targetShard = userSyncShard(user);
        await ensureShardSchema(env, "sync", targetShard);
        await syncDb(env, targetShard).prepare("DELETE FROM progress_documents WHERE user_id = ?").bind(targetId).run();
        await auditLog(env, session.user.id, "delete_user", targetId, { username: user.username, contentReassignedTo: session.user.id }, log);
        return json({ ok: true }, 200, origin, log);
      }
    }
    if (resetPasswordMatch && request.method === "POST") {
      const targetId = resetPasswordMatch[1];
      const body = await readJson(request);
      const password = typeof body.password === "string" && validPassword(body.password) ? body.password : null;
      if (!password) return json({ error: "Password must be at least 8 characters with 2 character classes" }, 400, origin, log);
      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
      if (!user) return json({ error: "User not found" }, 404, origin, log);
      const hashed = await passwordHash(password);
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(hashed.hash, hashed.salt, now(), targetId),
        env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), targetId),
      ]);
      await auditLog(env, session.user.id, "reset_password", targetId, { username: user.username }, log);
      return json({ ok: true }, 200, origin, log);
    }
    if (geminiKeyMatch && request.method === "DELETE") {
      const targetId = geminiKeyMatch[1];
      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
      if (!user) return json({ error: "User not found" }, 404, origin, log);
      if (!user.gemini_api_key) return json({ error: "User has no Gemini API key stored" }, 404, origin, log);
      await env.DB.prepare("UPDATE users SET gemini_api_key = NULL, gemini_model = NULL, gemini_max_wait = NULL, updated_at = ? WHERE id = ?").bind(now(), targetId).run();
      await auditLog(env, session.user.id, "clear_gemini_key", targetId, { username: user.username }, log);
      return json({ ok: true }, 200, origin, log);
    }
    // Manual email-verification flip. The operator vouches for the address —
    // for instances without a transactional email provider (Resend) there is
    // no other way to mark an address verified, and an unverified email
    // blocks Google sign-in linking (anti-account-jacking guard).
    if (emailVerifyMatch && request.method === "PATCH") {
      const targetId = emailVerifyMatch[1];
      const body = await readJson(request);
      if (typeof body.verified !== "boolean") return json({ error: "verified boolean required" }, 400, origin, log);
      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
      if (!user) return json({ error: "User not found" }, 404, origin, log);
      if (!user.email && body.verified) return json({ error: "User has no email address to verify" }, 400, origin, log);
      const verifiedAt = body.verified ? now() : null;
      await env.DB.prepare("UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?").bind(verifiedAt, now(), targetId).run();
      await auditLog(env, session.user.id, body.verified ? "verify_email" : "unverify_email", targetId, { username: user.username, email: user.email }, log);
      return json({ ok: true, emailVerifiedAt: verifiedAt }, 200, origin, log);
    }
  }

  /* ── Content ── */
  if (path.startsWith("/v1/admin/content")) {
    if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
    if (request.method === "POST" && path === "/v1/admin/content/upload-file") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      // readJsonLarge (not readJson): base64 data-URI bodies for binary files
      // (PDFs, images, audio) far exceed the 1 MB cap that readJson enforces,
      // and hitting that cap previously surfaced as a 500 instead of a 400.
      const body = await readJsonLarge(request);
      const key = typeof body.key === "string" ? body.key.trim() : "";
      const raw = typeof body.body === "string" ? body.body : "";
      if (!key || !raw) return json({ error: "key and body required" }, 400, origin, log);
      if (key.length > 1024) return json({ error: "key too long" }, 400, origin, log);
      // Only the content keyspaces are writable, and keys must stay inside
      // them — reject traversal (`..`), backslash paths, and absolute paths so
      // a bad/malicious key can't create an object outside content-files/.
      const isContentKey = key.startsWith("content-files/") || key.startsWith("content-staging/") || key.startsWith("content-manifests/");
      const isSafePath = !key.includes("..") && !key.includes("\\") && !key.startsWith("/");
      if (!isContentKey || !isSafePath) return json({ error: "Invalid key" }, 400, origin, log);
      const ext = key.split(".").pop()?.toLowerCase() ?? "";
      let content: any; let ct: string;
      if (raw.startsWith("data:")) {
        // Strip any line-wrapping whitespace — atob throws on newlines, and
        // pasted or script-generated base64 is not guaranteed to be single-line.
        const b64 = (raw.split(",")[1] ?? "").replace(/\s+/g, "");
        // Fill the Uint8Array with a plain loop instead of
        // Uint8Array.from(atob(...), charCodeAt) — the iterator+callback form
        // allocates a second large array and is CPU-heavy enough to trip the
        // free-plan CPU time limit on multi-megabyte uploads.
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        content = bytes;
        ct = raw.slice(5, raw.indexOf(";")) || "application/octet-stream";
      } else { content = raw; ct = ext === "json" ? "application/json" : ext === "md" ? "text/markdown; charset=utf-8" : ext === "html" || ext === "htm" ? "text/html; charset=utf-8" : ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : ext === "pdf" ? "application/pdf" : "application/octet-stream"; }
      await env.CONTENT.put(key, content, { httpMetadata: { contentType: ct } });
      return json({ ok: true, key }, 200, origin, log);
    }
    if (request.method === "GET" && path === "/v1/admin/content/r2-keys") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const category = (url.searchParams.get("prefix") || "").trim();
      const scope = (url.searchParams.get("scope") || "content-files") === "content-staging" ? "content-staging" : "content-files";
      if (category.includes("..") || category.includes("\\")) return json({ error: "Invalid prefix" }, 400, origin, log);
      const listed = await env.CONTENT.list({ prefix: scope + "/" + category, limit: 1000, cursor: url.searchParams.get("cursor") || undefined });
      return json({ items: (listed.objects || []).map((o: any) => ({ key: o.key, size: o.size, uploaded: o.uploaded?.toISOString?.() ?? null })), cursor: listed.truncated ? listed.cursor : null }, 200, origin, log);
    }
    if (request.method === "DELETE" && path === "/v1/admin/content/r2-key") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const key = (url.searchParams.get("key") || "").trim();
      if (!key) return json({ error: "key required" }, 400, origin, log);
      if (!key.startsWith("content-files/") && !key.startsWith("content-manifests/") && !key.startsWith("content-staging/")) return json({ error: "Only content-files/, content-staging/ and content-manifests/ keys" }, 400, origin, log);
      await env.CONTENT.delete(key);
      if (key.startsWith("content-files/")) {
        const cat = key.slice("content-files/".length).split("/")[0];
        if (cat && cat in CATEGORY_TYPE_MAP) {
          try { await regenerateManifestForCategory(env, cat); } catch (e) { console.error("manifest regen failed:", e); }
        }
      }
      await auditLog(env, session.user.id, "delete_r2_key", null, { key }, log);
      return json({ ok: true }, 200, origin, log);
    }
    if (request.method === "GET" && path === "/v1/admin/content/r2-content") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const key = (url.searchParams.get("key") || "").trim();
      if (!key || (!key.startsWith("content-files/") && !key.startsWith("content-staging/") && !key.startsWith("content-manifests/"))) return json({ error: "Invalid key" }, 400, origin, log);
      const obj = await env.CONTENT.get(key);
      if (!obj) return json({ error: "Not found" }, 404, origin, log);
      // `?raw=1` returns the object's bytes as-is (with its real content
      // type) instead of decoding to text — used by the admin content browser
      // to preview staged binary assets like images, which would otherwise
      // come back as corrupted text via the JSON wrapper.
      if (url.searchParams.get("raw") === "1") {
        const buf = await obj.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
            "cache-control": "no-store",
            ...cors(origin),
            ...SECURITY_HEADERS,
          } as any,
        });
      }
      const body = await obj.text();
      return json({ body, contentType: obj.httpMetadata?.contentType ?? "application/octet-stream" }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/publish-staged") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const keys = Array.isArray(body.keys) ? body.keys.filter((k: any): k is string => typeof k === "string" && k.startsWith("content-staging/") && !k.includes("..") && !k.includes("\\")) : [];
      if (!keys.length) return json({ error: "keys required" }, 400, origin, log);
      // Dedupe (a folder's staged children can be collected more than once)
      // and skip folder placeholders that carry no student-facing content.
      const unique = [...new Set(keys)].filter((k): k is string => typeof k === "string" && !k.endsWith("/") && !k.endsWith("/.keep"));
      // Each key costs 3 subrequests (get, put, delete) and Workers Free caps
      // subrequests at 50 per invocation — bound the batch and report the
      // remainder so the admin UI can re-invoke.
      const MAX_PUBLISH_PER_RUN = 14;
      const categories = new Set<string>();
      const published: string[] = [];
      let failed = 0;
      for (const key of unique.slice(0, MAX_PUBLISH_PER_RUN)) {
        const rel = key.slice("content-staging/".length);
        const cat = rel.split("/")[0];
        // Guard against staged keys whose top-level segment isn't a content
        // category — regenerating a manifest for a bogus category would
        // create a junk manifest the student app may end up fetching.
        if (!cat || !(cat in CATEGORY_TYPE_MAP)) { failed += 1; continue; }
        try {
          const src = await env.CONTENT.get(key);
          if (!src) continue;
          const buf = await src.arrayBuffer();
          const ct = guessImageContentType(rel);
          const dstKey = `content-files/${rel}`;
          await env.CONTENT.put(dstKey, buf, { httpMetadata: { contentType: ct } });
          await env.CONTENT.delete(key);
          published.push(dstKey);
          categories.add(cat);
        } catch (e) {
          // A single failed copy must not abort the whole batch — the staged
          // key stays in place so the admin can retry or discard it.
          failed += 1;
          console.error("publish-staged copy failed:", key, e);
        }
      }
      for (const cat of categories) {
        try { await regenerateManifestForCategory(env, cat); } catch (e) { console.error("manifest regen failed:", e); }
      }
      const remainingKeys = Math.max(0, unique.length - MAX_PUBLISH_PER_RUN);
      await auditLog(env, session.user.id, "publish_staged", null, { keys: unique.length, published: published.length, failed }, log);
      return json({ ok: true, published, remaining: remainingKeys, complete: remainingKeys === 0 && failed === 0 }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/discard-staged") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const keys: string[] = Array.isArray(body.keys) ? body.keys.filter((k: any): k is string => typeof k === "string" && k.startsWith("content-staging/") && !k.includes("..") && !k.includes("\\")) : [];
      if (!keys.length) return json({ error: "keys required" }, 400, origin, log);
      // One delete subrequest per key — bound the run to stay under the
      // Workers Free 50-subrequest cap and report the remainder.
      const MAX_DISCARD_PER_RUN = 40;
      let deleted = 0;
      for (const key of [...new Set(keys)].slice(0, MAX_DISCARD_PER_RUN)) {
        await env.CONTENT.delete(key);
        deleted += 1;
      }
      const discardRemaining = Math.max(0, keys.length - deleted);
      await auditLog(env, session.user.id, "discard_staged", null, { keys: keys.length, deleted }, log);
      return json({ ok: true, deleted, remaining: discardRemaining, complete: discardRemaining === 0 }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/r2-rename") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const from = typeof body.from === "string" ? body.from.trim() : "";
      const to = typeof body.to === "string" ? body.to.trim() : "";
      if (!from || !to) return json({ error: "from and to required" }, 400, origin, log);
      if (!from.startsWith("content-files/") || !to.startsWith("content-files/")) return json({ error: "Only content-files/ keys" }, 400, origin, log);
      if (from.includes("..") || from.includes("\\") || to.includes("..") || to.includes("\\")) return json({ error: "Invalid key" }, 400, origin, log);
      const src = await env.CONTENT.get(from);
      if (!src) return json({ error: "Source key not found" }, 404, origin, log);
      const buf = await src.arrayBuffer();
      const ct2 = guessImageContentType(to);
      await env.CONTENT.put(to, buf, { httpMetadata: { contentType: ct2 } });
      await env.CONTENT.delete(from);
      await auditLog(env, session.user.id, "rename_r2_key", null, { from, to }, log);
      return json({ ok: true, from, to }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/r2-folder") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const pathArg = typeof body.path === "string" ? body.path.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!pathArg || !pathArg.startsWith("content-files/")) return json({ error: "path must start with content-files/" }, 400, origin, log);
      if (pathArg.includes("..") || pathArg.includes("\\")) return json({ error: "Invalid path" }, 400, origin, log);
      await env.CONTENT.put(pathArg + "/.keep", "", { httpMetadata: { contentType: "text/plain" } });
      await auditLog(env, session.user.id, "create_r2_folder", null, { path: pathArg }, log);
      return json({ ok: true, key: pathArg + "/.keep" }, 200, origin, log);
    }
    /* ── Recursive R2 folder operations ──
     *
     * Folders are just key prefixes, so "delete folder" / "rename folder"
     * list every key under a prefix (in BOTH content-files/ and
     * content-staging/) and operate on each. The category manifest is
     * regenerated afterwards so the student app stops serving removed keys
     * and picks up the new paths.
     */
    const listUnderPrefix = async (prefix: string): Promise<string[]> => {
      if (!env.CONTENT) return [];
      const keys: string[] = [];
      let cursor: string | undefined = undefined;
      for (let page = 0; page < 10; page++) {
        const listed: any = await env.CONTENT.list({ prefix, limit: 1000, cursor });
        if (!listed || !listed.objects) break;
        keys.push(...listed.objects.map((o: any) => o.key));
        if (!listed.truncated) break;
        cursor = listed.cursor;
      }
      return keys;
    };
    if (request.method === "POST" && path === "/v1/admin/content/r2-delete-prefix") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const prefix = typeof body.prefix === "string" ? body.prefix.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!prefix || prefix.includes("..") || prefix.includes("\\")) return json({ error: "Invalid prefix" }, 400, origin, log);
      const cat = prefix.split("/")[0];
      if (!cat || !(cat in CATEGORY_TYPE_MAP)) return json({ error: "Invalid prefix" }, 400, origin, log);
      // Each delete is one subrequest; Workers Free caps subrequests at
      // 50 per invocation (Paid: 1,000), and the list() calls above count too.
      // A qbank-scale folder (~300 files + images) can never finish in one run,
      // so bound each run well under the cap and let the caller re-invoke until
      // complete — already-deleted keys vanish from the list, so resuming is
      // idempotent. The manifest is regenerated only once the run completes.
      const MAX_DELETE_PER_RUN = 35;
      let deleted = 0;
      let remaining = 0;
      for (const scope of ["content-files", "content-staging"]) {
        const keys = await listUnderPrefix(`${scope}/${prefix}/`);
        const budget = Math.max(0, MAX_DELETE_PER_RUN - deleted);
        for (const key of keys.slice(0, budget)) {
          await env.CONTENT.delete(key);
          deleted += 1;
        }
        remaining += Math.max(0, keys.length - budget);
      }
      // Cascade to managed objects whose student-facing copy lived under
      // this folder — otherwise they survive as orphaned drafts and reappear
      // in the tree after reload. Bounded like the R2 deletes above.
      const fullPrefix = `content-files/${prefix}`;
      try {
        const rows = await env.DB.prepare("SELECT id, r2_key_base, published_r2_key FROM content_objects WHERE published_r2_key LIKE ?").bind(fullPrefix + "/%").all<any>();
        const doomed = (rows.results || []).slice(0, Math.max(0, MAX_DELETE_PER_RUN - deleted));
        remaining += Math.max(0, (rows.results || []).length - doomed.length);
        for (const row of doomed) {
          if (row.r2_key_base) await deleteManagedBase(env, row.r2_key_base);
          await env.DB.prepare("DELETE FROM content_objects WHERE id = ?").bind(row.id).run();
          await auditLog(env, session.user.id, "delete_content", row.id, { cascadeOf: fullPrefix }, log);
        }
      } catch (e) {
        // origin/published columns may predate migration — best-effort.
        console.error("folder-delete managed cascade failed:", e);
      }
      const complete = remaining === 0;
      if (complete) {
        try { await regenerateManifestForCategory(env, cat); } catch (e) { console.error("manifest regen failed:", e); }
        await auditLog(env, session.user.id, "delete_r2_folder", null, { prefix, deleted }, log);
      }
      return json({ ok: true, deleted, remaining, complete }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/r2-rename-prefix") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (isManagedOnly(env)) return json({ error: "Direct R2 operations disabled in managed-only mode" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const from = typeof body.from === "string" ? body.from.trim().replace(/^\/+|\/+$/g, "") : "";
      const to = typeof body.to === "string" ? body.to.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!from || !to) return json({ error: "from and to required" }, 400, origin, log);
      if (from === to) return json({ ok: true, moved: 0, remaining: 0, complete: true }, 200, origin, log);
      if (from.includes("..") || from.includes("\\") || to.includes("..") || to.includes("\\")) return json({ error: "Invalid key" }, 400, origin, log);
      const cat = from.split("/")[0];
      if (!cat || !(cat in CATEGORY_TYPE_MAP)) return json({ error: "Invalid prefix" }, 400, origin, log);
      const toCat = to.split("/")[0];
      if (toCat !== cat) return json({ error: "Cannot move across categories" }, 400, origin, log);
      // Each rename costs 3 subrequests (get, put, delete) and Workers Free
      // caps subrequests at 50 per invocation — so a qbank-scale folder can
      // never complete in one invocation. Bound each run well under the cap
      // and let the caller re-invoke until complete. Moved keys leave the
      // source prefix, so resuming is idempotent. The manifest is regenerated
      // only once the run completes.
      const MAX_RENAME_PER_RUN = 12;
      let moved = 0;
      let remaining = 0;
      for (const scope of ["content-files", "content-staging"]) {
        const prefix = `${scope}/${from}/`;
        const keys = await listUnderPrefix(prefix);
        const budget = Math.max(0, MAX_RENAME_PER_RUN - moved);
        for (const key of keys.slice(0, budget)) {
          const rel = key.slice(prefix.length);
          if (!rel) continue;
          const dstKey = `${scope}/${to}/${rel}`;
          const src = await env.CONTENT.get(key);
          if (!src) continue;
          const buf = await src.arrayBuffer();
          await env.CONTENT.put(dstKey, buf, { httpMetadata: { contentType: guessImageContentType(dstKey) } });
          await env.CONTENT.delete(key);
          moved += 1;
        }
        remaining += Math.max(0, keys.length - budget);
      }
      const complete = remaining === 0;
      if (complete) {
        try { await regenerateManifestForCategory(env, cat); } catch (e) { console.error("manifest regen failed:", e); }
        await auditLog(env, session.user.id, "rename_r2_folder", null, { from, to, moved }, log);
      }
      return json({ ok: true, moved, remaining, complete }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/backfill") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);

      const existingRows = await env.DB.prepare("SELECT id, r2_key_base, content_type, published_r2_key FROM content_objects").all<any>();
      const existingByPub = new Map<string, any>();
      const existingByCatAndFile = new Map<string, any>();
      for (const row of existingRows.results || []) {
        if (row.published_r2_key) existingByPub.set(row.published_r2_key, row);
        const tail = (row.r2_key_base || "").split("/").pop();
        if (tail) {
          const expected = row.content_type === "library" ? `${tail}.md` : `${tail}.json`;
          const cat = CONTENT_TYPE_TO_CATEGORY[row.content_type] ?? row.content_type;
          existingByCatAndFile.set(`content-files/${cat}/${expected}`, row);
        }
      }

      const categories = ["qbank", "flashcard", "osce", "library", "videos"];
      let backfilled = 0;
      let existing = 0;
      let processed = 0;
      let stoppedEarly = false;
      const errors: string[] = [];
      const BATCH_SIZE = 25;
      // Workers Free caps subrequests at 50 per invocation; a full backfill
      // costs ~4 subrequests per file (get, 2 puts, image list), so a full run
      // (~476 files) can never complete in one invocation. Bound each run to
      // stay under the cap and let the caller re-invoke until complete — the
      // published_r2_key check resumes.
      const MAX_FILES_PER_RUN = 8;

      for (const cat of categories) {
        const dbStatements: any[] = [];
        const prefix = `content-files/${cat}/`;
        let cursor: string | undefined = undefined;
        let hitCap = false;
        for (let page = 0; page < 20; page++) {
          const listed: any = await env.CONTENT.list({ prefix, limit: 1000, cursor });
          const objects: any[] = listed.objects || [];
          for (const item of objects) {
            const key: string = item.key;
            const rel = key.slice(prefix.length);
            if (!rel || rel.endsWith("/") || rel.endsWith("/.keep") || rel === "manifest.json" || rel.includes("/images/")) {
              continue;
            }
            // Sidecar article metadata is not standalone content — it rides
            // along with its .md sibling and must never be adopted.
            if (isArticleMetaFileName(rel)) continue;
            if (!rel.endsWith(".json") && !rel.endsWith(".md") && !rel.endsWith(".html") && !rel.endsWith(".pdf")) {
              continue;
            }

            const already = existingByPub.get(key) || existingByCatAndFile.get(key);
            if (already) {
              if (already.published_r2_key !== key) {
                dbStatements.push(env.DB.prepare("UPDATE content_objects SET published_r2_key = ?, status = 'published', updated_at = ? WHERE id = ?").bind(key, now(), already.id));
              }
              existing += 1;
              continue;
            }

            if (processed >= MAX_FILES_PER_RUN) {
              hitCap = true;
              break;
            }
            processed += 1;

            try {
              const fileSegment = rel;
              const tail = fileSegment.split("/").pop() ?? fileSegment;
              const idBase = tail.replace(/\.[^.]+$/, "");
              const src = await env.CONTENT.get(key);
              if (!src) continue;
              const text = await src.text();

              let contentType: string | undefined;
              if (fileSegment.endsWith(".md") || fileSegment.endsWith(".html") || fileSegment.endsWith(".pdf")) {
                contentType = "library";
              } else if (fileSegment.endsWith(".json")) {
                try {
                  const j = JSON.parse(text);
                  const jHasMcq = (Array.isArray(j.questions) && j.questions.length > 0) ||
                    (Array.isArray(j.passages) && j.passages.length > 0);
                  const jHasWritten = Array.isArray(j.prompts) && j.prompts.length > 0;
                  if (typeof j.type === "string" && j.type.trim()) contentType = j.type.trim();
                  else if (jHasMcq && jHasWritten) contentType = "mixed";
                  else if (Array.isArray(j.questions)) contentType = "quiz";
                  else if (Array.isArray(j.passages)) contentType = "bank";
                  else if (Array.isArray(j.prompts)) contentType = "written";
                  else if (Array.isArray(j.cards) || Array.isArray(j.decks) || Array.isArray(j.subdecks)) contentType = "flashcard";
                  else if (Array.isArray(j.stations)) contentType = "osce";
                  else if (Array.isArray(j.videos)) contentType = "video";
                } catch {}
              }
              if (!contentType) {
                contentType = CATEGORY_TO_DEFAULT_TYPE[cat] || "quiz";
              }

              const objectId = id();
              const r2Base = `content/${contentType}/${objectId}`;
              let title = idBase.replace(/[-_]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              try {
                const j = JSON.parse(text);
                if (typeof j.title === "string" && j.title.trim()) title = j.title.trim().slice(0, 200);
              } catch {}

              await Promise.all([
                r2Put(env, r2Draft(r2Base), text),
                r2Put(env, r2Published(r2Base), text),
              ]);

              const dir = fileSegment.includes("/") ? fileSegment.slice(0, fileSegment.lastIndexOf("/") + 1) : "";
              const imgPrefix = `content-files/${cat}/${dir}images/`;
              const imgListed: any = await env.CONTENT.list({ prefix: imgPrefix, limit: 100 });
              if (imgListed && imgListed.objects) {
                for (const imgObj of imgListed.objects) {
                  const imgRel = String(imgObj.key).slice(imgPrefix.length);
                  if (!imgRel || imgRel.endsWith("/")) continue;
                  const imgFile = await env.CONTENT.get(imgObj.key);
                  if (!imgFile) continue;
                  const imgBuf = await imgFile.arrayBuffer();
                  await env.CONTENT.put(`${r2Base}/images/${imgRel}`, imgBuf, {
                    httpMetadata: { contentType: guessImageContentType(imgRel) }
                  });
                }
              }

              dbStatements.push(
                env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, published_r2_key, created_by, created_at, updated_at, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, 'en', 'published', ?, ?, ?, ?, ?, ?)").bind(objectId, r2Base, contentType, title, key, session.user.id, now(), now(), session.user.id, now())
              );
              existingByPub.set(key, { id: objectId });
              backfilled += 1;
            } catch (err: any) {
              errors.push(`${key}: ${err.message}`);
            }
          }
          if (!listed.truncated) break;
          cursor = listed.cursor;
        }

        // Commit this category's rows before moving on, so a mid-run failure
        // leaves durable progress a retry resumes via published_r2_key.
        for (let i = 0; i < dbStatements.length; i += BATCH_SIZE) {
          const chunk = dbStatements.slice(i, i + BATCH_SIZE);
          try {
            await env.DB.batch(chunk);
          } catch (err: any) {
            return json({ error: `DB write failed for ${cat}: ${err.message}`, backfilled, existing }, 500, origin, log);
          }
        }
        if (hitCap) {
          stoppedEarly = true;
          break;
        }
      }

      const complete = !stoppedEarly;
      await auditLog(env, session.user.id, "backfill_content", null, { backfilled, existing, errors: errors.length, complete }, log);
      return json({ ok: true, backfilled, existing, total: backfilled + existing, errors, complete }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/gc-orphans") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const rows = await env.DB.prepare("SELECT r2_key_base FROM content_objects WHERE r2_key_base IS NOT NULL").all<any>();
      const referenced = new Set<string>();
      for (const row of rows.results || []) if (row.r2_key_base) referenced.add(row.r2_key_base);
      // Workers Free caps subrequests at 50 per invocation (each delete is
      // one subrequest and the list() scans above count too). Deletes are
      // bounded per invocation; already-deleted orphans vanish from the list,
      // so re-invoking until complete is idempotent.
      const MAX_ORPHAN_DELETES = 30;
      const prefixes = ["content/quiz/", "content/bank/", "content/written/", "content/mixed/", "content/flashcard/", "content/osce/", "content/library/", "content/video/"];
      let scanned = 0;
      let deleted = 0;
      let remaining = 0;
      let budget = MAX_ORPHAN_DELETES;
      for (const pfx of prefixes) {
        let cursor: string | undefined = undefined;
        for (let page = 0; page < 40; page++) {
          const listed: any = await env.CONTENT.list({ prefix: pfx, limit: 1000, cursor });
          if (!listed || !listed.objects) break;
          for (const obj of listed.objects) {
            const key = obj.key;
            if (!key.startsWith(pfx)) continue;
            const tail = key.slice(pfx.length);
            const slash = tail.indexOf("/");
            if (slash <= 0) continue;
            const base = pfx + tail.slice(0, slash);
            scanned += 1;
            if (referenced.has(base)) continue;
            if (budget > 0) {
              await env.CONTENT.delete(key);
              deleted += 1;
              budget -= 1;
            } else {
              remaining += 1;
            }
          }
          if (!listed.truncated) break;
          cursor = listed.cursor;
        }
      }
      const complete = remaining === 0;
      await auditLog(env, session.user.id, "gc_orphans", null, { scanned, deleted, remaining, complete }, log);
      return json({ ok: true, scanned, deleted, remaining, complete }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/regenerate-manifest") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const cat = typeof body.category === "string" ? body.category.trim() : "";
      if (!cat) return json({ error: "category required" }, 400, origin, log);
      if (cat !== "all" && !(cat in CATEGORY_TYPE_MAP)) return json({ error: "Invalid category" }, 400, origin, log);
      if (cat.includes("..") || cat.includes("\\")) return json({ error: "Invalid category" }, 400, origin, log);
      const categories = cat === "all" ? ["qbank","flashcard","osce","library","videos"] : [cat];
      const results: Record<string, string> = {};
      for (const c of categories) { try { results[c] = await regenerateManifestForCategory(env, c) ? "ok" : "empty"; } catch (e: any) { results[c] = "error: " + e.message; } }
      await auditLog(env, session.user.id, "regenerate_manifest", null, { category: cat }, log);
      return json({ ok: true, results }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/validate") {
      if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
      const body = await readJson(request);
      const ct = typeof body.contentType === "string" ? body.contentType : "";
      if (!["quiz","bank","flashcard","written","mixed","osce","library","video"].includes(ct)) return json({ error: "Invalid content type" }, 400, origin, log);
      // Library articles are markdown/html/pdf, not JSON — validating them
      // here reported every article as "Invalid JSON". Nothing structural
      // to check server-side yet; treat them as valid.
      if (ct === "library") return json({ errors: [] }, 200, origin, log);
      let parsed: any;
      try { parsed = JSON.parse(typeof body.body === "string" ? body.body : "{}"); } catch (e: any) { return json({ errors: ["Invalid JSON: " + e.message] }, 200, origin, log); }
      return json({ errors: validateContent(ct, parsed) }, 200, origin, log);
    }
    if (request.method === "GET" && path === "/v1/admin/content/pending") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      const rows = await env.DB.prepare("SELECT co.*, u.username as creator_username, u.display_name as creator_display_name FROM content_objects co JOIN users u ON u.id = co.created_by WHERE co.status = 'pending' ORDER BY co.submitted_at ASC").all();
      return json({ items: rows.results || [] }, 200, origin, log);
    }
    if (request.method === "GET" && path === "/v1/admin/content") {
      const status = url.searchParams.get("status") || "published";
      const q = (url.searchParams.get("q") || "").trim();
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      const offset = (page - 1) * limit;
      const safeStatus = ["draft","pending","published","rejected","all"].includes(status) ? status : "published";
      const like = q ? "%" + escapeLike(q) + "%" : null;
      const where: string[] = []; const params: any[] = [];
      if (isAdmin(session)) { if (safeStatus !== "all") { where.push("co.status = ?"); params.push(safeStatus); } }
      else { if (safeStatus === "published") { where.push("co.status = 'published'"); } else { where.push("co.created_by = ?"); where.push("co.status = ?"); params.push(session.user.id, safeStatus); } }
      if (like) { where.push("co.title LIKE ? ESCAPE '\\'"); params.push(like); }
      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
      const [rows, total] = await Promise.all([
        env.DB.prepare("SELECT co.*, u.username as creator_username FROM content_objects co JOIN users u ON u.id = co.created_by" + whereSql + " ORDER BY co.updated_at DESC LIMIT ? OFFSET ?").bind(...params, limit, offset).all(),
        env.DB.prepare("SELECT COUNT(*) as n FROM content_objects co JOIN users u ON u.id = co.created_by" + whereSql).bind(...params).first(),
      ]);
      return json({ items: rows.results || [], total: (total as any)?.n ?? 0, page, limit }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content") {
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      if (!body.contentType || !["quiz","bank","flashcard","written","mixed","osce","library","video"].includes(body.contentType)) return json({ error: "Invalid content type" }, 400, origin, log);
      const objectId = id();
      const r2Base = "content/" + body.contentType + "/" + objectId;
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : null;
      const rawTarget = typeof body.targetPath === "string" ? body.targetPath.trim().replace(/^\/+|\/+$/g, "") : "";
      if (rawTarget.includes("..") || rawTarget.includes("\\")) return json({ error: "Invalid targetPath" }, 400, origin, log);
      const targetPathVal = rawTarget || null;
      await r2Put(env, r2Draft(r2Base), body.content || JSON.stringify({ title: title || "Untitled" }, null, 2));
      try {
        await env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, target_path, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)").bind(objectId, r2Base, body.contentType, title, body.language || "en", targetPathVal, session.user.id, now(), now()).run();
      } catch {
        // Pre-migration DB without target_path column — fall back to the old shape.
        await env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)").bind(objectId, r2Base, body.contentType, title, body.language || "en", session.user.id, now(), now()).run();
      }
      await auditLog(env, session.user.id, "create_content", objectId, { title, contentType: body.contentType, targetPath: targetPathVal }, log);
      return json({ id: objectId, r2KeyBase: r2Base, status: "draft" }, 201, origin, log);
    }

    /* ── Lookup content_object by student-facing R2 key (unified browser) ──
     *
     * Two ways a managed object can map to a content-files/.../...json key:
     *   1. The object's hybrid target path (computed at publish time via
     *      hybridPublish()) matches the requested key exactly.
     *   2. The object's id appears as the basename of the R2 key (fallback
     *      used when no explicit targetPath was supplied at publish time).
     *
     * Returns 200 + object row, or 404 if no managed object claims the key.
     */
    if (request.method === "GET" && path === "/v1/admin/content/by-r2-key") {
      if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
      const key = (url.searchParams.get("key") || "").trim();
      if (!key || !key.startsWith("content-files/")) return json({ error: "key must start with content-files/" }, 400, origin, log);
      if (key.includes("..") || key.includes("\\")) return json({ error: "Invalid key" }, 400, origin, log);
      const rel = key.slice("content-files/".length);
      const slash = rel.indexOf("/");
      if (slash <= 0) return json({ found: false }, 200, origin, log);
      const category = rel.slice(0, slash);
      const fileSegment = rel.slice(slash + 1);

      // Fast path: an object that published to this exact key (covers custom
      // targetPath publishes that the basename reconstruction below misses).
      try {
        const byPublished = await env.DB.prepare("SELECT co.*, u.username as creator_username FROM content_objects co JOIN users u ON u.id = co.created_by WHERE co.published_r2_key = ?").bind(key).first<any>();
        if (byPublished) return json({ found: true, object: byPublished }, 200, origin, log);
      } catch {}

      // Pull all candidate objects whose content_type maps to this category.
      // Cheap query — content_objects is small.
      const typeForCat = CATEGORY_TYPE_TO_TYPE[category];
      if (!typeForCat) return json({ found: false }, 200, origin, log);
      const rows = await env.DB.prepare(
        "SELECT co.*, u.username as creator_username FROM content_objects co JOIN users u ON u.id = co.created_by WHERE co.content_type IN (" + typeForCat.map(() => "?").join(",") + ")"
      ).bind(...typeForCat).all<any>();
      for (const obj of rows.results || []) {
        // Reconstruct the hybrid target path that hybridPublish() would
        // have written for this object — same logic as in hybridPublish().
        const tail = (obj.r2_key_base || "").split("/").pop();
        if (!tail) continue;
        const expected = obj.content_type === "library" ? `${tail}.md` : `${tail}.json`;
        if (fileSegment === expected) {
          return json({ found: true, object: obj }, 200, origin, log);
        }
      }
      return json({ found: false }, 200, origin, log);
    }

    /* ── Adopt a loose R2 file as a managed content_object ──
     *
     * Body: { key: "content-files/<category>/<path>", contentType?, title?, language? }
     *  - contentType is inferred from the file extension / category if absent.
     *  - title defaults to the filename without extension.
     *  - language defaults to "en".
     *
     * Steps:
     *   1. Fetch the raw body from the loose key (must exist).
     *   2. Infer contentType from path + category.
     *   3. Create a new content_objects row (status=draft).
     *   4. Copy the body into content/<type>/<uuid>/draft.json.
     *   5. Leave the original content-files/.../key as-is — it remains the
     *      student-facing copy. The admin can publish the draft (which will
     *      overwrite the student copy via hybridPublish) when ready.
     *
     * If a managed object already exists for this key, return its id without
     * making a new one (idempotent).
     */
    if (request.method === "POST" && path === "/v1/admin/content/adopt") {
      if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const key = typeof body.key === "string" ? body.key.trim() : "";
      if (!key || !key.startsWith("content-files/")) return json({ error: "key must start with content-files/" }, 400, origin, log);
      if (key.includes("..") || key.includes("\\")) return json({ error: "Invalid key" }, 400, origin, log);
      // Pull the raw body
      const raw = await env.CONTENT.get(key);
      if (!raw) return json({ error: "R2 key not found" }, 404, origin, log);
      const text = await raw.text();

      // Idempotency: if there's already a managed object that maps to this
      // key, return it. Two paths — the exact published_r2_key (covers
      // custom targetPath publishes) and the default basename match.
      const rel = key.slice("content-files/".length);
      const slash = rel.indexOf("/");
      if (slash <= 0) return json({ error: "Invalid key shape" }, 400, origin, log);
      const category = rel.slice(0, slash);
      const fileSegment = rel.slice(slash + 1);
      const tail = fileSegment.split("/").pop() ?? fileSegment;
      const idBase = tail.replace(/\.[^.]+$/, "");
      const expectedKeyFor = (ct: string, oid: string) => ct === "library" ? `${oid}.md` : `${oid}.json`;
      // Idempotency check 1 — an object previously adopted from this exact
      // key (origin_r2_key). Without this, re-adopting an adopted draft
      // created another content_object every time: drafts have
      // published_r2_key = NULL and never match the basename shape below.
      try {
        const byOrigin = await env.DB.prepare("SELECT * FROM content_objects WHERE origin_r2_key = ?").bind(key).first<any>();
        if (byOrigin) {
          return json({ id: byOrigin.id, r2KeyBase: byOrigin.r2_key_base, status: byOrigin.status, adopted: false, alreadyExisted: true }, 200, origin, log);
        }
      } catch {}
      // Idempotency check 2 — an object that published to this exact key.
      try {
        const byPublished = await env.DB.prepare("SELECT * FROM content_objects WHERE published_r2_key = ?").bind(key).first<any>();
        if (byPublished) {
          return json({ id: byPublished.id, r2KeyBase: byPublished.r2_key_base, status: byPublished.status, adopted: false, alreadyExisted: true }, 200, origin, log);
        }
      } catch {}
      const candidateTypes = CATEGORY_TYPE_TO_TYPE[category] || [];
      for (const ct of candidateTypes) {
        const row = await env.DB.prepare("SELECT * FROM content_objects WHERE content_type = ? AND r2_key_base LIKE ?").bind(ct, `content/${ct}/%`).all<any>();
        for (const obj of row.results || []) {
          if (fileSegment === expectedKeyFor(obj.content_type, obj.id)) {
            return json({ id: obj.id, r2KeyBase: obj.r2_key_base, status: obj.status, adopted: false, alreadyExisted: true }, 200, origin, log);
          }
        }
      }

      // Infer content_type. Priority: explicit body.contentType → by extension → by category.
      let contentType: string | undefined = typeof body.contentType === "string" ? body.contentType : undefined;
      if (!contentType) {
        if (fileSegment.endsWith(".md") || fileSegment.endsWith(".html") || fileSegment.endsWith(".pdf")) contentType = "library";
        else if (fileSegment.endsWith(".json")) {
          // sniff the JSON body for shape hints
          try {
            const j = JSON.parse(text);
            const jHasMcq = (Array.isArray(j.questions) && j.questions.length > 0) ||
              (Array.isArray(j.passages) && j.passages.length > 0);
            const jHasWritten = Array.isArray(j.prompts) && j.prompts.length > 0;
            if (typeof j.type === "string" && j.type.trim()) contentType = j.type.trim();
            else if (jHasMcq && jHasWritten) contentType = "mixed";
            else if (Array.isArray(j.questions)) contentType = "quiz";
            else if (Array.isArray(j.passages)) contentType = "bank";
            else if (Array.isArray(j.prompts)) contentType = "written";
            else if (Array.isArray(j.cards) || Array.isArray(j.decks) || Array.isArray(j.subdecks)) contentType = "flashcard";
            else if (Array.isArray(j.stations)) contentType = "osce";
            else if (Array.isArray(j.videos)) contentType = "video";
          } catch {}
        }
      }
      if (!contentType) {
        // fall back to category → type
        const byCat = CATEGORY_TO_DEFAULT_TYPE[category];
        contentType = byCat;
      }
      if (!contentType || !["quiz","bank","flashcard","written","mixed","osce","library","video"].includes(contentType)) {
        return json({ error: "Could not infer contentType; pass it explicitly" }, 400, origin, log);
      }

      const objectId = id();
      const r2Base = "content/" + contentType + "/" + objectId;
      const title = (typeof body.title === "string" ? body.title.trim() : "") || idBase.replace(/[-_]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      const language = (typeof body.language === "string" ? body.language.trim() : "") || "en";
      await r2Put(env, r2Draft(r2Base), text);
      await env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at, origin_r2_key) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)").bind(objectId, r2Base, contentType, title.slice(0, 200), language, session.user.id, now(), now(), key).run();
      await auditLog(env, session.user.id, "adopt_content", objectId, { key, contentType, title }, log);
      return json({ id: objectId, r2KeyBase: r2Base, status: "draft", adopted: true, alreadyExisted: false }, 201, origin, log);
    }

    const cim = path.match(/^\/v1\/admin\/content\/([^/]+)(\/(.+))?$/);
    if (cim) {
      const objectId = cim[1]; const action = cim[3] || null;
      if (["pending","upload-file","r2-keys","r2-key","r2-content","r2-rename","r2-rename-prefix","r2-delete-prefix","r2-folder","regenerate-manifest","validate","by-r2-key","adopt","publish-staged","discard-staged","backfill"].includes(objectId)) return json({ error: "Not found" }, 404, origin, log);
      const obj = await env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(objectId).first<any>();
      if (!obj) return json({ error: "Content not found" }, 404, origin, log);
      if (!isAdmin(session) && obj.created_by !== session.user.id && obj.status !== "published") return json({ error: "Forbidden" }, 403, origin, log);

      if (request.method === "PUT" && action === "asset") {
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        if (!isAdmin(session) && obj.created_by !== session.user.id) return json({ error: "Forbidden" }, 403, origin, log);
        let rel = (url.searchParams.get("path") || "").trim().replace(/^\/+|\/+$/g, "");
        if (!rel || rel.includes("..") || rel.includes("\\")) return json({ error: "Invalid path" }, 400, origin, log);
        if (!rel.includes("/")) {
          rel = `images/${rel}`;
        }
        const r2Key = `${obj.r2_key_base}/${rel}`;
        let contentType = request.headers.get("content-type") || guessImageContentType(rel);

        let payload: any;
        if (contentType.includes("application/json")) {
          const body = await readJsonLarge(request);
          const raw = typeof body.body === "string" ? body.body : "";
          if (raw.startsWith("data:")) {
            const b64 = (raw.split(",")[1] ?? "").replace(/\s+/g, "");
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            payload = bytes;
            contentType = raw.slice(5, raw.indexOf(";")) || guessImageContentType(rel);
          } else {
            payload = raw;
          }
        } else {
          payload = request.body || (await request.arrayBuffer());
        }

        await env.CONTENT.put(r2Key, payload, { httpMetadata: { contentType } });
        await env.DB.prepare("UPDATE content_objects SET updated_at = ? WHERE id = ?").bind(now(), objectId).run();
        await auditLog(env, session.user.id, "upload_asset", objectId, { key: r2Key, relPath: rel }, log);
        return json({ ok: true, key: r2Key, relPath: rel }, 200, origin, log);
      }
      if (request.method === "GET" && action === "asset") {
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        let rel = (url.searchParams.get("path") || "").trim().replace(/^\/+|\/+$/g, "");
        if (!rel || rel.includes("..") || rel.includes("\\")) return json({ error: "Invalid path" }, 400, origin, log);
        if (!rel.includes("/")) {
          rel = `images/${rel}`;
        }
        const r2Key = `${obj.r2_key_base}/${rel}`;
        const asset = await env.CONTENT.get(r2Key);
        if (!asset) return json({ error: "Asset not found" }, 404, origin, log);
        const buf = await asset.arrayBuffer();
        // Executable content types must download, never render inline —
        // mirrors the public /v1/content/ endpoint's force-download rule.
        const assetExt = rel.split(".").pop()?.toLowerCase() ?? "";
        const assetForceDownload = ["html", "htm", "svg", "js", "mjs", "xml", "xhtml"].includes(assetExt);
        return new Response(buf, {
          status: 200,
          headers: {
            "content-type": asset.httpMetadata?.contentType ?? guessImageContentType(rel),
            "cache-control": "no-cache",
            ...(assetForceDownload ? { "content-disposition": `attachment; filename="${rel.split("/").pop()?.replace(/[^\w.-]/g, "_") || "download"}"` } : {}),
            ...cors(origin),
            ...SECURITY_HEADERS,
          } as any,
        });
      }

      if (request.method === "PATCH" && action === "schedule") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        const body = await readJson(request);
        const updates: string[] = []; const sp: any[] = [];
        if (body.publishAt !== undefined) { updates.push("scheduled_publish_at = ?"); sp.push(body.publishAt === null ? null : Number(body.publishAt)); }
        if (body.unpublishAt !== undefined) { updates.push("scheduled_unpublish_at = ?"); sp.push(body.unpublishAt === null ? null : Number(body.unpublishAt)); }
        if (!updates.length) return json({ error: "Provide publishAt and/or unpublishAt" }, 400, origin, log);
        updates.push("updated_at = ?"); sp.push(now(), objectId);
        await env.DB.prepare("UPDATE content_objects SET " + updates.join(", ") + " WHERE id = ?").bind(...sp).run();
        await auditLog(env, session.user.id, "schedule_content", objectId, { title: obj.title, publishAt: body.publishAt ?? null, unpublishAt: body.unpublishAt ?? null }, log);
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "GET" && !action) {
        const bodyKey = obj.status === "published" ? r2Published(obj.r2_key_base) : r2Draft(obj.r2_key_base);
        return json({ ...obj, body: await r2Get(env, bodyKey) ?? null }, 200, origin, log);
      }
      if (request.method === "GET" && action === "diff") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        const [pending, published] = await Promise.all([r2Get(env, r2Pending(obj.r2_key_base)), r2Get(env, r2Published(obj.r2_key_base))]);
        return json({ pending: pending ?? null, published: published ?? null }, 200, origin, log);
      }
      if (request.method === "PUT" && action === "draft") {
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        if (!isAdmin(session) && obj.created_by !== session.user.id) return json({ error: "Forbidden" }, 403, origin, log);
        const body = await request.text();
        if (!body || body.length > 1_000_000) return json({ error: "Invalid body" }, 400, origin, log);
        await r2Put(env, r2Draft(obj.r2_key_base), body);
        let newTitle: string | null = null;
        try { const j = JSON.parse(body); if (typeof j.title === "string") newTitle = j.title.trim().slice(0, 200); } catch {}
        await env.DB.prepare("UPDATE content_objects SET title = COALESCE(?, title), updated_at = ? WHERE id = ?").bind(newTitle, now(), objectId).run();
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "POST" && action === "submit") {
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        if (!isAdmin(session) && obj.created_by !== session.user.id) return json({ error: "Forbidden" }, 403, origin, log);
        const draft = await r2Get(env, r2Draft(obj.r2_key_base));
        if (!draft) return json({ error: "Draft is empty" }, 400, origin, log);
        await r2Put(env, r2Pending(obj.r2_key_base), draft);
        await env.DB.prepare("UPDATE content_objects SET status = 'pending', submitted_at = ?, reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL, updated_at = ? WHERE id = ?").bind(now(), now(), objectId).run();
        await auditLog(env, session.user.id, "submit_content", objectId, { title: obj.title }, log);
        return json({ ok: true, status: "pending" }, 200, origin, log);
      }
      if (request.method === "POST" && action === "reject") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        const body = await readJson(request);
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
        await env.DB.prepare("UPDATE content_objects SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ?").bind(session.user.id, now(), reason || null, now(), objectId).run();
        await auditLog(env, session.user.id, "reject", objectId, { title: obj.title, reason }, log);
        return json({ ok: true, status: "rejected" }, 200, origin, log);
      }
      if (request.method === "POST" && action === "publish") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        const draft = await r2Get(env, r2Draft(obj.r2_key_base));
        if (!draft) return json({ error: "Draft is empty" }, 400, origin, log);
        await r2Put(env, r2Published(obj.r2_key_base), draft);
        let targetPath: string | null = null; let doHybrid = true;
        try { const b: any = await request.clone().json(); if (typeof b.targetPath === "string") targetPath = b.targetPath.trim().replace(/^\/+|\/+$/g, ""); if (targetPath && (targetPath.includes("..") || targetPath.includes("\\"))) return json({ error: "Invalid targetPath" }, 400, origin, log); if (b.hybrid === false) doHybrid = false; } catch {}
        if (targetPath) { try { await env.DB.prepare("UPDATE content_objects SET target_path = ? WHERE id = ?").bind(targetPath, objectId).run(); (obj as any).target_path = targetPath; } catch {} }
        const hybridKeys = doHybrid ? await hybridPublish(env, obj, draft, targetPath) : [];
        if (!doHybrid) {
          // Publishing without a student-facing copy — drop any stale key
          // from a previous hybrid publish.
          try { await env.DB.prepare("UPDATE content_objects SET published_r2_key = NULL WHERE id = ?").bind(objectId).run(); } catch {}
        }
        await env.DB.prepare("UPDATE content_objects SET status = 'published', reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?").bind(session.user.id, now(), now(), objectId).run();
        await auditLog(env, session.user.id, "publish_direct", objectId, { title: obj.title, hybridKeys }, log);
        return json({ ok: true, status: "published", hybridKeys }, 200, origin, log);
      }
      if (request.method === "POST" && action === "approve") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        const pending = await r2Get(env, r2Pending(obj.r2_key_base));
        if (!pending) return json({ error: "No pending snapshot found" }, 400, origin, log);
        await r2Put(env, r2Published(obj.r2_key_base), pending);
        let targetPath: string | null = null;
        try { const b: any = await request.clone().json(); if (typeof b.targetPath === "string") targetPath = b.targetPath.trim().replace(/^\/+|\/+$/g, ""); if (targetPath && (targetPath.includes("..") || targetPath.includes("\\"))) return json({ error: "Invalid targetPath" }, 400, origin, log); } catch {}
        if (targetPath) { try { await env.DB.prepare("UPDATE content_objects SET target_path = ? WHERE id = ?").bind(targetPath, objectId).run(); (obj as any).target_path = targetPath; } catch {} }
        const hybridKeys = await hybridPublish(env, obj, pending, targetPath);
        await env.DB.prepare("UPDATE content_objects SET status = 'published', reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?").bind(session.user.id, now(), now(), objectId).run();
        await auditLog(env, session.user.id, "approve", objectId, { title: obj.title, hybridKeys }, log);
        return json({ ok: true, status: "published", hybridKeys }, 200, origin, log);
      }
      if (request.method === "POST" && action === "validate") {
        // Library content is markdown/html/pdf — not JSON-parseable, and
        // validating it reported every article as invalid.
        if (obj.content_type === "library") return json({ errors: [] }, 200, origin, log);
        let body: string | null = null;
        try { const parsed: any = await request.clone().json(); if (typeof parsed.body === "string") body = parsed.body; } catch {}
        if (body == null) body = await r2Get(env, r2Draft(obj.r2_key_base));
        if (body == null) return json({ errors: ["Draft is empty"] }, 200, origin, log);
        let parsed: any;
        try { parsed = JSON.parse(body); } catch (e: any) { return json({ errors: ["Invalid JSON: " + e.message] }, 200, origin, log); }
        return json({ errors: validateContent(obj.content_type, parsed) }, 200, origin, log);
      }
      if (request.method === "POST" && action === "unpublish") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        // Drop the student-facing hybrid copy too — flipping status alone
        // left content-files/<cat>/<path> live and students kept serving it.
        const staleKey = obj.published_r2_key;
        if (staleKey && env.CONTENT) {
          try { await env.CONTENT.delete(staleKey); } catch (e) { console.error("unpublish r2 cleanup failed:", e); }
        }
        await env.DB.prepare("UPDATE content_objects SET status = 'draft', published_r2_key = NULL, updated_at = ? WHERE id = ?").bind(now(), objectId).run();
        if (staleKey && staleKey.startsWith("content-files/")) {
          const rel = staleKey.slice("content-files/".length);
          const cat = rel.split("/")[0];
          if (cat && cat in CATEGORY_TYPE_MAP) {
            try { await updateManifestIncremental(env, cat, [rel]); } catch (e) { try { await regenerateManifestForCategory(env, cat); } catch {} }
          }
        }
        await auditLog(env, session.user.id, "unpublish", objectId, { title: obj.title }, log);
        return json({ ok: true, status: "draft" }, 200, origin, log);
      }
      if (request.method === "DELETE" && !action) {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        // Snapshot before deletion — needed for the manifest rebuild below.
        const pubKey = obj.published_r2_key;
        if (obj.r2_key_base) await deleteManagedBase(env, obj.r2_key_base);
        // Remove the student-facing hybrid copy so a deleted object stops
        // being served from content-files/.
        if (pubKey && env.CONTENT) {
          try { await env.CONTENT.delete(pubKey); } catch (e) { console.error("delete r2 cleanup failed:", e); }
        }
        await env.DB.prepare("DELETE FROM content_objects WHERE id = ?").bind(objectId).run();
        if (pubKey && pubKey.startsWith("content-files/")) {
          const rel = pubKey.slice("content-files/".length);
          const cat = rel.split("/")[0];
          if (cat && cat in CATEGORY_TYPE_MAP) {
            try { await updateManifestIncremental(env, cat, [rel]); } catch (e) { try { await regenerateManifestForCategory(env, cat); } catch {} }
          }
        }
        await auditLog(env, session.user.id, "delete_content", objectId, { title: obj.title }, log);
        return json({ ok: true }, 200, origin, log);
      }
    }
    return json({ error: "Not found" }, 404, origin, log);
  }

  /* ── Webhooks ── */
  if (path === "/v1/admin/webhooks") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    if (request.method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM webhooks ORDER BY created_at DESC").all();
      return json({ webhooks: rows.results || [] }, 200, origin, log);
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const val = validate(body, [{ field: "url", type: "string", required: true, min: 1, max: 2048 }, { field: "events", type: "string", required: true, min: 2 }, { field: "secret", type: "string", min: 1, max: 512 }]);
      if (!val.valid) return json({ error: val.errors.join("; ") }, 400, origin, log);
      const webhookCheck = validWebhookUrl(body.url);
      if (!webhookCheck.ok) return json({ error: webhookCheck.reason }, 400, origin, log);
      let eventsList: unknown;
      try { eventsList = JSON.parse(body.events); } catch { return json({ error: "events must be a JSON array string" }, 400, origin, log); }
      if (!Array.isArray(eventsList) || !eventsList.every((e) => typeof e === "string")) {
        return json({ error: "events must be a JSON array of event names" }, 400, origin, log);
      }
      await env.DB.prepare("INSERT INTO webhooks (id, url, events, secret, enabled, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)").bind(id(), body.url, body.events, body.secret || null, session.user.id, now()).run();
      await auditLog(env, session.user.id, "create_webhook", null, { url: body.url, events: body.events }, log);
      return json({ ok: true }, 201, origin, log);
    }
  }
  const wdm = path.match(/^\/v1\/admin\/webhooks\/([^/]+)$/);
  if (wdm && request.method === "DELETE") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    const hook = await env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(wdm[1]).first<any>();
    if (!hook) return json({ error: "Webhook not found" }, 404, origin, log);
    await env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(wdm[1]).run();
    await auditLog(env, session.user.id, "delete_webhook", wdm[1], { url: hook.url }, log);
    return json({ ok: true }, 200, origin, log);
  }

  /* ── API tokens (MCP access) — users manage their own tokens only.
   * Tokens authenticate AI agents against POST /v1/mcp and are capped at the
   * content-authoring surface regardless of the owner's role. The plaintext
   * is returned exactly once, at creation; only a hash is stored. ── */
  if (path === "/v1/admin/tokens") {
    if (request.method === "GET") return json({ items: await listApiTokens(env, session.user.id) }, 200, origin, log);
    if (request.method === "POST") {
      const body = await readJson(request);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 80) return json({ error: "Token name required (max 80 chars)" }, 400, origin, log);
      const days = Number(body.expiresInDays);
      const expiresInDays = Number.isFinite(days) && days > 0 ? Math.min(3650, Math.floor(days)) : null;
      const requestedScope = body.scope === "admin" ? "admin" : "content_admin";
      const { token, view } = await mintApiToken(env, session.user.id, session.user.role, name, expiresInDays, requestedScope);
      await auditLog(env, session.user.id, "create_api_token", view.id, { name: view.name, scope: view.scope, expiresAt: view.expiresAt }, log);
      return json({ token, ...view }, 201, origin, log);
    }
  }
  const atm = path.match(/^\/v1\/admin\/tokens\/([^/]+)$/);
  if (atm && request.method === "DELETE") {
    const ok = await revokeApiToken(env, session.user.id, atm[1]);
    if (!ok) return json({ error: "Token not found" }, 404, origin, log);
    await auditLog(env, session.user.id, "revoke_api_token", atm[1], null, log);
    return json({ ok: true }, 200, origin, log);
  }

  /* ── Config ── */
  if (path === "/v1/admin/config") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
    if (request.method === "GET") {
      const obj = await env.CONTENT.get("_osler.config.json");
      if (!obj) return json({ site: { name: "Osler", shortName: "Osler", tagline: "Your medical companion", githubRepo: "", organisation: "", supportEmail: "" }, engines: {}, themes: { default: "light", custom: [] }, defaults: { view: "dashboard", language: { ui: "en", content: "all" }, quiz: { count: 10, secPerQuestion: 90, tutor: false, shuffle: true }, ai: { model: "gemini-3.5-flash-lite", enabled: true, temperature: 0.7 }, sync: { method: "webrtc", room: "" } }, wizard: { completed: false } }, 200, origin, log);
      const text = await obj.text();
      try { JSON.parse(text); } catch { return json({ error: "Corrupt config" }, 500, origin, log); }
      return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...cors(origin), ...SECURITY_HEADERS, "x-request-id": log.requestId } as any });
    }
    if (request.method === "PUT") {
      // The config drives theme CSS injection, engine enablement, and default
      // URLs on every client — validate the envelope before storing: object
      // shape, bounded nesting depth, and a sane top-level key allowlist so a
      // typo'd or hostile write can't smuggle arbitrary sections in.
      const body = await readJson(request);
      const text = JSON.stringify(body ?? {});
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Config must be a JSON object" }, 400, origin, log);
      const CONFIG_KEYS = new Set(["site", "engines", "themes", "defaults", "cloud", "email", "wizard", "sync", "schemaVersion", "$schema", "$comment"]);
      for (const key of Object.keys(body)) {
        if (!CONFIG_KEYS.has(key)) return json({ error: `Unknown config section: ${key}` }, 400, origin, log);
      }
      if (jsonDepth(text) > 16) return json({ error: "Config is too deeply nested" }, 400, origin, log);
      await env.CONTENT.put("_osler.config.json", JSON.stringify(body, null, 2), { httpMetadata: { contentType: "application/json" } });
      await auditLog(env, session.user.id, "update_config", null, { updatedKeys: Object.keys(body) }, log);
      return json({ ok: true }, 200, origin, log);
    }
  }
  return null;
}
// ─── Main fetch handler ─────────────────────────────────────────────────────

// eslint-disable-next-line import/no-anonymous-default-export -- a default-exported handler object is the Cloudflare Workers platform convention.
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (env.DB) {
      ctx.waitUntil(cleanupStale(env));
      ctx.waitUntil(processScheduledContent(env));
    }
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = requestOrigin(request, env);
    if (!origin) return json({ error: "Origin is not allowed" }, 403, "", { requestId: "blocked" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (!env.DB || !env.JWT_SECRET) return json({ error: "Worker is not configured" }, 503, origin, { requestId: "unconfigured" });

    const url = new URL(request.url);
    const ip = clientIp(request);
    const log: Logger = createLogger(request, ctx);

    try {
      // ── Public health check ──
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return json({ ok: true, googleEnabled: googleReady(env), turnstileEnabled: env.TURNSTILE_ENABLED === "true" }, 200, origin, { requestId: log.requestId, cacheControl: "public, max-age=60" });
      }

      // ── Public content serving (R2-backed and CDN-cacheable) ──
      // These endpoints are fetched cross-origin from the Pages site, so the
      // response must include `Access-Control-Allow-Origin` (via cors(origin))
      // AND must relax `Cross-Origin-Resource-Policy` to `cross-origin` so
      // the browser allows the Pages site to read the body. The default
      // SECURITY_HEADERS has CORP=same-origin, which would block these reads.
      if (request.method === "GET" && url.pathname.startsWith("/v1/content/")) {
        // Public but billed: every miss costs a Worker request + an R2 read.
        // 240/min/IP is far above real study traffic, while capping the
        // blast radius of cache-busting junk requests on the free tier.
        if (!rateLimit(ip, "content")) return json({ error: "Too many requests" }, 429, origin, log);
        let contentPath = url.pathname.slice("/v1/content/".length).replace(/\/{2,}/g, "/");
        // Paths can carry percent-encoded characters (folder names with spaces,
        // e.g. "Cardiology AR" → "Cardiology%20AR"). Decode BEFORE validating so
        // encoded traversal (%2e%2e%2f) can't slip past the ".." check.
        try {
          contentPath = decodeURIComponent(contentPath);
        } catch {
          return json({ error: "Not found" }, 404, origin, log);
        }
        if (!contentPath || contentPath.includes("..") || contentPath.includes("\\") || contentPath.startsWith("/") || /[\u0000-\u001f]/.test(contentPath)) return json({ error: "Not found" }, 404, origin, log);
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        const r2Key = `content-files/${contentPath}`;
        const ext = contentPath.split(".").pop()?.toLowerCase() ?? "";
        const cacheable = ext !== "json" && ext !== "md";
        // Edge-cache lookup first — an immutable asset served from cache bills
        // neither a Worker subrequest nor an R2 read. Cache hits skip the R2
        // round-trip entirely, protecting the free-tier request budget.
        if (cacheable) {
          try {
            const cached = await caches.default.match(new Request(request.url, { method: "GET" }));
            if (cached) return cached;
          } catch {}
        }
        const obj = await env.CONTENT.get(r2Key);
        if (!obj) return json({ error: "Not found" }, 404, origin, log);
        const contentType =
          ext === "json" ? "application/json" : ext === "md" ? "text/markdown; charset=utf-8"
          : ext === "html" || ext === "htm" ? "text/html; charset=utf-8" : ext === "pdf" ? "application/pdf"
          : ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png"
          : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif"
          : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif"
          : ext === "bmp" ? "image/bmp" : ext === "ico" ? "image/x-icon"
          : ext === "mp3" || ext === "m4a" ? "audio/mpeg" : ext === "mp4" ? "video/mp4"
          : ext === "webm" ? "video/webm" : ext === "m3u8" ? "application/vnd.apple.mpegurl"
          : ext === "css" ? "text/css" : ext === "js" ? "application/javascript"
          : "application/octet-stream";
        // HTML/SVG/JS/XML served from the Worker origin could execute script
        // in a browsing context (same-origin <script src> is allowed by this
        // endpoint's CSP). Force them to download instead of render so a
        // malicious/compromised content upload can never turn the Worker into
        // a script host. Images, PDFs and data files stay inline.
        const forceDownload = ["html", "htm", "svg", "js", "mjs", "xml", "xhtml"].includes(ext);
        const cacheControl = cacheable ? "public, max-age=86400, immutable" : "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
        const contentHeaders: Record<string, string> = {
          "content-type": contentType,
          "cache-control": cacheControl,
          ...(forceDownload ? { "content-disposition": `attachment; filename="${contentPath.split("/").pop()?.replace(/[^\w.-]/g, "_") || "download"}"` } : {}),
          ...cors(origin),
          ...SECURITY_HEADERS,
          // Override CORP so the Pages site (different origin) can read this.
          "cross-origin-resource-policy": "cross-origin",
        };
        const response = new Response(obj.body, { status: 200, headers: contentHeaders as any });
        // Cache immutable assets at the Cloudflare edge. Workers responses are
        // NOT auto-cached from cache-control headers alone; without an explicit
        // Cache API put, every pack fetch bills a Worker request + an R2 read,
        // which can exhaust the free-tier 100k requests/day under classroom load.
        if (cacheable) {
          const req = new Request(request.url, { method: "GET" });
          try { await caches.default.put(req, response.clone()); } catch {}
        }
        return response;
      }

      // ── Public content version stamp (drives client manifest cache-busting) ──
      // Must stay uncached: students poll it and only re-download manifests
      // when the returned version differs from what they already hold.
      if (request.method === "GET" && url.pathname === "/v1/content-version") {
        const version = await readContentVersion(env);
        return new Response(JSON.stringify({ version }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            ...cors(origin),
            ...SECURITY_HEADERS,
            "cross-origin-resource-policy": "cross-origin",
          },
        });
      }

      // ── Public content manifests (R2-backed) ──
      if (request.method === "GET" && url.pathname.startsWith("/v1/content-manifests/")) {
        const versioned = url.searchParams.has("v");
        const cacheReq = new Request(request.url, { method: "GET" });
        if (versioned) {
          try {
            const cached = await caches.default.match(cacheReq);
            if (cached) return cached;
          } catch {}
        }
        let manifestPath = url.pathname.slice("/v1/content-manifests/".length).replace(/\/{2,}/g, "/");
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        try { manifestPath = decodeURIComponent(manifestPath); } catch { return json({ error: "Not found" }, 404, origin, log); }
        const category = manifestPath.split("/")[0];
        const knownFile = /^manifest\.json$/i.test(manifestPath.split("/").slice(1).join("/"));
        if (!manifestPath || !category || !knownFile || !(category in CATEGORY_TYPE_MAP)) return json({ error: "Not found" }, 404, origin, log);
        if (manifestPath.includes("..") || manifestPath.includes("\\")) return json({ error: "Not found" }, 404, origin, log);
        const r2Key = `content-manifests/${manifestPath}`;
        const obj = await env.CONTENT.get(r2Key);
        if (!obj) return json({ error: "Not found" }, 404, origin, log);
        const manifestHeaders: Record<string, string> = {
          "content-type": "application/json",
          "cache-control": versioned
            ? "public, max-age=31536000, immutable"
            : "no-cache, no-store, must-revalidate",
          ...cors(origin),
          ...SECURITY_HEADERS,
          "cross-origin-resource-policy": "cross-origin",
        };
        const response = new Response(obj.body, { status: 200, headers: manifestHeaders as any });
        if (versioned) {
          try { await caches.default.put(cacheReq, response.clone()); } catch {}
        }
        return response;
      }

      // ── Google OAuth ──
      if (request.method === "GET" && url.pathname === "/v1/auth/google/start") {
        if (!googleReady(env)) return json({ error: "Google sign-in is not configured" }, 503, origin, log);
        // Each call inserts an oauth_states row - a D1 WRITE. Unthrottled, an
        // attacker could exhaust the free-tier daily write quota in hours,
        // taking down login/sync/audit for the whole instance.
        if (!rateLimit(ip, "auth:google:start")) return json({ error: "Too many attempts" }, 429, origin, log);
        const returnTo = url.searchParams.get("returnTo") || "";
        let validatedReturnTo: URL;
        try { validatedReturnTo = new URL(returnTo); } catch { return json({ error: "Invalid return URL" }, 400, origin, log); }
        if (validatedReturnTo.origin !== env.ALLOWED_ORIGIN) return json({ error: "Invalid return URL" }, 400, origin, log);
        const state = `${id()}${id()}`;
        const nonce = `${id()}${id()}`;
        await env.DB.prepare("INSERT INTO oauth_states (state, nonce, return_to, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(state, nonce, returnTo, now() + OAUTH_TTL_MS, now()).run();
        const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authorize.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || "", redirect_uri: workerCallback(env), response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account" }).toString();
        return Response.redirect(authorize.toString(), 302);
      }
      if (request.method === "GET" && url.pathname === "/v1/auth/google/callback") {
        const stateValue = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code");
        const authState = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?").bind(stateValue, now()).first<any>();
        if (authState) await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(stateValue).run();
        if (!authState || !code || !googleReady(env)) return Response.redirect(`${env.ALLOWED_ORIGIN}/?cloudAuthError=google`, 302);
        const form = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID || "", client_secret: env.GOOGLE_CLIENT_SECRET || "", redirect_uri: workerCallback(env), grant_type: "authorization_code" });
        const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
        if (!response.ok) return Response.redirect(`${authState.return_to}/?cloudAuthError=google`, 302);
        const tokenResponse: any = await response.json();
        const claims = await verifyGoogleIdToken(tokenResponse.id_token, env, authState.nonce);
        const user = await googleUser(env, claims);
        if (!user) return Response.redirect(`${authState.return_to.replace(/\/$/, "")}/?cloudAuthError=email_claimed`, 302);
        const ticket = await createAuthHandoff(env, user.id);
        // Ticket travels in the URL fragment, not the query — fragments are
        // never sent to servers (no access logs, no Referer leakage).
        return Response.redirect(`${authState.return_to.replace(/\/$/, "")}/#cloudAuth=${encodeURIComponent(ticket)}`, 302);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/google/consume") {
        if (!rateLimit(ip, "auth:google:consume")) return json({ error: "Too many attempts" }, 429, origin, log);
        const body = await readJson(request);
        const ticket = typeof body.ticket === "string" ? body.ticket : "";
        const handoff = ticket && await env.DB.prepare("SELECT * FROM auth_handoffs WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(ticket), now()).first<any>();
        if (!handoff) return json({ error: "This sign-in link is invalid or expired" }, 400, origin, log);
        await env.DB.prepare("UPDATE auth_handoffs SET used_at = ? WHERE id = ?").bind(now(), handoff.id).run();
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(handoff.user_id).first<any>();
        return json(await issueSession(user, env, request.headers.get("user-agent")), 200, origin, log);
      }

      // ── Username availability ──
      if (request.method === "GET" && url.pathname === "/v1/auth/username-available") {
        if (!rateLimit(ip, "auth:register")) return json({ error: "Too many attempts" }, 429, origin, log);
        const username = url.searchParams.get("username")?.trim() || "";
        if (!validUsername(username)) return json({ available: false }, 200, origin, log);
        const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
        return json({ available: !existing }, 200, origin, log);
      }

      // ── Registration ──
      if (request.method === "POST" && url.pathname === "/v1/auth/register") {
        if (!rateLimit(ip, "auth:register")) return json({ error: "Too many registration attempts" }, 429, origin, log);
        const body = await readJson(request);
        const username = String(body.username || "").trim();
        const email = body.email ? String(body.email).trim().toLowerCase() : null;
        const displayName = String(body.displayName || username).trim().slice(0, 80);
        if (!validUsername(username) || !validEmail(email) || !validPassword(body.password) || !displayName) return json({ error: "Invalid registration details" }, 400, origin, log);
        if (!await verifyTurnstile(body.turnstileToken, env)) return json({ error: "Verification failed" }, 400, origin, log);
        const userId = id(); const password = await passwordHash(body.password);
        try {
          await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, sync_shard, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)").bind(userId, username, email, displayName, password.hash, password.salt, syncShardForUserId(userId), now(), now()).run();
        } catch { return json({ error: "That username or email is already in use" }, 409, origin, log); }
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();
        return json(await issueSession(user, env, request.headers.get("user-agent")), 201, origin, log);
      }

      // ── Login ──
      if (request.method === "POST" && url.pathname === "/v1/auth/login") {
        if (!rateLimit(ip, "auth:login")) return json({ error: "Too many login attempts" }, 429, origin, log);
        const body = await readJson(request); const identifier = String(body.identifier || "").trim();
        if (!identifier || !validPassword(body.password)) return json({ error: "Invalid username or password" }, 401, origin, log);
        // Distributed brute-force guard: identifier+IP pairs locked in D1
        // after repeated consecutive failures (shared across all isolates).
        // The identifier is lowercased for both the lockout key AND the user
        // lookup below, so "Admin"/"ADMIN" rotations can't spread attempts
        // across separate lockout rows for the same account.
        const identifierKey = identifier.toLowerCase();
        if (!(await loginLockoutCheck(env, identifierKey, ip))) {
          await verifyDummyPassword(body.password);
          return json({ error: "Too many failed attempts - try again later" }, 429, origin, log);
        }
        if (!await verifyTurnstile(body.turnstileToken, env)) return json({ error: "Verification failed" }, 400, origin, log);
        // COLLATE NOCASE handles ASCII case-insensitivity; lowercasing first
        // keeps the lookup consistent with the lockout key.
        const user = await env.DB.prepare("SELECT * FROM users WHERE has_password = 1 AND (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE)").bind(identifierKey, identifierKey).first<any>();
        if (!user) {
          await verifyDummyPassword(body.password);
          await loginFailureRecord(env, identifierKey, ip);
          return json({ error: "Invalid username or password" }, 401, origin, log);
        }
        if (!(await passwordMatches(body.password, user.password_salt, user.password_hash))) {
          await loginFailureRecord(env, identifierKey, ip);
          return json({ error: "Invalid username or password" }, 401, origin, log);
        }
        await loginFailureClear(env, identifierKey, ip);
        return json(await issueSession(user, env, request.headers.get("user-agent")), 200, origin, log);
      }

      // ── Logout ──
      if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
        const session = await requireUser(request, env); if (session) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(now(), session.sessionId).run();
        return json({ ok: true }, 200, origin, log);
      }

      // ── Session refresh (sliding expiry) ──
      // Accepts the current (possibly just-expired) bearer token, validates
      // the signature + session row, and returns a brand-new session. Lets
      // the client rotate a token before/after expiry instead of forcing a
      // full re-login — see refreshSession() for the exact semantics.
      if (request.method === "POST" && url.pathname === "/v1/auth/refresh") {
        if (!rateLimit(ip, "auth:refresh")) return json({ error: "Too many attempts" }, 429, origin, log);
        const refreshed = await refreshSession(request, env);
        if (!refreshed) return json({ error: "Session is no longer valid — please sign in again" }, 401, origin, log);
        return json(refreshed, 200, origin, log);
      }

      // ── Password reset ──
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/request") {
        if (!rateLimit(ip, "auth:reset")) return json({ error: "Too many reset attempts" }, 429, origin, log);
        const body = await readJson(request); const email = String(body.email || "").trim().toLowerCase();
        // Fail closed on the challenge regardless of email validity so a bot
        // can't probe or mail-bomb the endpoint without first solving
        // Turnstile. Account existence is still never revealed (ok:true below).
        if (!await verifyTurnstile(body.turnstileToken, env)) return json({ error: "Verification failed" }, 400, origin, log);
        if (!(await emailEnabled(env))) return json({ error: "Email is disabled" }, 400, origin, log);
        if (validEmail(email)) {
          const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(email).first<any>();
          if (user && emailProviderReady(env) && env.APP_ORIGIN) {
            const token = `${id()}${id()}`; const expiresAt = now() + RESET_TTL_MS;
            // Revoke any earlier outstanding reset links before issuing a fresh
            // one, so a compromised old link dies the moment a new reset is
            // requested instead of remaining usable for its full TTL.
            await env.DB.batch([
              env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL").bind(now(), user.id),
              env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(id(), user.id, await sha256(token), expiresAt, now()),
            ]);
            const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/?reset=${encodeURIComponent(token)}`;
            try {
              const { html, text } = passwordResetEmail(link);
              await sendEmail(env, env.DB, { to: user.email, subject: "Reset your Osler password", text, html });
            } catch (error) {
              // A Resend outage must not surface as a 500 — that would flip the
              // always-{ok:true} no-enumeration contract into an account-existence
              // oracle for the outage's duration. The token simply goes undelivered
              // and expires; the next request revokes it anyway.
              console.error("password-reset email send failed:", error);
            }
          }
        }
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/confirm") {
        if (!rateLimit(ip, "auth:reset")) return json({ error: "Too many reset attempts" }, 429, origin, log);
        const body = await readJson(request);
        // Setting a new password is a high-value action — require a fresh
        // challenge even though the reset link itself is already a bearer of intent.
        if (!await verifyTurnstile(body.turnstileToken, env)) return json({ error: "Verification failed" }, 400, origin, log);
        if (typeof body.token !== "string" || !validPassword(body.password)) return json({ error: "Invalid reset request" }, 400, origin, log);
        const row = await env.DB.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(body.token), now()).first<any>();
        if (!row) return json({ error: "This reset link is invalid or expired" }, 400, origin, log);
        const password = await passwordHash(body.password);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(password.hash, password.salt, now(), row.user_id),
          env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").bind(now(), row.id),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), row.user_id),
        ]);
        return json({ ok: true }, 200, origin, log);
      }

      // ── Email verification ──
      if (request.method === "POST" && url.pathname === "/v1/auth/verify/request") {
        if (!rateLimit(ip, "auth:register")) return json({ error: "Too many attempts" }, 429, origin, log);
        const body = await readJson(request);
        // Verifying sends an email that could otherwise be used to mail-bomb a
        // victim — gate it on the challenge like every other unauthenticated
        // mail-triggering endpoint.
        if (!await verifyTurnstile(body.turnstileToken, env)) return json({ error: "Verification failed" }, 400, origin, log);
        if (!(await emailEnabled(env))) return json({ error: "Email is disabled" }, 400, origin, log);
        const email = String(body.email || "").trim().toLowerCase();
        if (!validEmail(email)) return json({ error: "Invalid email" }, 400, origin, log);
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE AND email_verified_at IS NULL").bind(email).first<any>();
        if (user && emailProviderReady(env) && env.APP_ORIGIN) {
          const existing = await env.DB.prepare("SELECT id FROM email_verify_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at > ?").bind(user.id, now()).first<any>();
          if (!existing) {
            const token = `${id()}${id()}`; const expiresAt = now() + RESET_TTL_MS;
            await env.DB.prepare("INSERT INTO email_verify_tokens (id, user_id, token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id(), user.id, await sha256(token), email, expiresAt, now()).run();
            const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/?verify=${encodeURIComponent(token)}`;
            try {
              const { html, text } = verifyEmail(link);
              await sendEmail(env, env.DB, { to: user.email, subject: "Verify your Osler email address", text, html });
            } catch (error) {
              console.error("verify-email send failed:", error);
            }
          }
        }
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/verify/confirm") {
        if (!rateLimit(ip, "auth:register")) return json({ error: "Too many attempts" }, 429, origin, log);
        const body = await readJson(request);
        if (typeof body.token !== "string" || !body.token) return json({ error: "Invalid verification request" }, 400, origin, log);
        const row = await env.DB.prepare("SELECT * FROM email_verify_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(body.token), now()).first<any>();
        if (!row) return json({ error: "This verification link is invalid or expired" }, 400, origin, log);
        // The token proves ownership of row.email — not of whatever address
        // the user has since switched to. If the account's current email no
        // longer matches, the link is stale: reject instead of marking an
        // address the user may not own as verified.
        const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(row.user_id).first<{ email: string | null }>();
        const currentEmail = (user?.email ?? "").toLowerCase();
        const tokenEmail = String(row.email ?? "").toLowerCase();
        if (!currentEmail || !tokenEmail || currentEmail !== tokenEmail) {
          return json({ error: "This verification link was issued for a different email address" }, 400, origin, log);
        }
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").bind(now(), row.user_id),
          env.DB.prepare("UPDATE email_verify_tokens SET used_at = ? WHERE id = ?").bind(now(), row.id),
        ]);
        return json({ ok: true, verified: true }, 200, origin, log);
      }

      // ── Search (M8) ──
      if (request.method === "GET" && url.pathname === "/v1/search") {
        const session = await requireUser(request, env);
        if (!session) return json({ error: "Authentication required" }, 401, origin, log);
        // users/audit scopes are privileged recon — students get content only.
        const requestedTypes = (url.searchParams.get("types") || "content").split(",");
        const privileged = isAdmin(session);
        const types = requestedTypes.filter((t) => t === "content" || (privileged && (t === "users" || t === "audit")));
        if (!types.includes("content")) url.searchParams.set("types", privileged ? requestedTypes.join(",") : "");
        else url.searchParams.set("types", types.join(","));
        if (!rateLimit(ip, "search")) return json({ error: "Too many requests" }, 429, origin, log);
        return handleSearch(request, env, session, log);
      }

      // ── Guest Turnstile gate (pre-auth) ──
      // POST /v1/guest/verify — guest (local-only) sessions have no account,
      // but they still must pass the bot check. Mirrors the auth endpoints'
      // fail-closed Turnstile verification: when TURNSTILE_ENABLED is off the
      // call passes and guests are unaffected.
      if (request.method === "POST" && url.pathname === "/v1/guest/verify") {
        if (!rateLimit(ip, "guest")) return json({ error: "Too many requests" }, 429, origin, log);
        const body = await readJson(request).catch(() => null);
        if (!body || typeof body.turnstileToken !== "string") return json({ error: "Invalid request" }, 400, origin, log);
        if (!await verifyTurnstile(body.turnstileToken, env)) return json({ error: "Verification failed" }, 400, origin, log);
        return json({ ok: true }, 200, origin, log);
      }

      // ── Analytics ingest (pre-auth) ──
      // POST /v1/analytics/events — performance metrics only, no PII. Must
      // sit BEFORE the authenticated-route gate: the deployed app runs most
      // sessions as guests (local-only), and those would otherwise 401 before
      // anything reached the database. Guests are rate-limited per IP; the
      // global daily write cap (ANALYTICS_DAILY_WRITE_CAP) backstops abuse.
      if (request.method === "POST" && url.pathname === "/v1/analytics/events") {
        if (!rateLimit(ip, "analytics")) return json({ error: "Too many requests" }, 429, origin, log);
        const ingestSession = await requireUser(request, env);
        if (ingestSession && !rateLimit(ingestSession.user.id, "analytics_user")) {
          return json({ error: "Too many requests" }, 429, origin, log);
        }
        return handleAnalyticsIngest(request, env, origin, log);
      }

      // ── QBank choice stats (pre-auth) ──
      // POST /v1/qbank/stats — one aggregated report per finished session.
      // GET  /v1/qbank/stats?uid=… — peer choice percentages for review mode.
      // Guests are included (local sessions have no account); no identity is
      // stored either way, so there is nothing to distinguish or leak. Abuse
      // is bounded by per-IP/per-user limits + the daily write cap.
      if (request.method === "POST" && url.pathname === "/v1/qbank/stats") {
        if (!rateLimit(ip, "qstats")) return json({ error: "Too many requests" }, 429, origin, log);
        const statsSession = await requireUser(request, env);
        if (statsSession && !rateLimit(statsSession.user.id, "qstats_user")) {
          return json({ error: "Too many requests" }, 429, origin, log);
        }
        return handleQuestionStatsReport(request, env, statsSession, origin, log);
      }
      if (request.method === "GET" && url.pathname === "/v1/qbank/stats") {
        if (!rateLimit(ip, "qstats_read")) return json({ error: "Too many requests" }, 429, origin, log);
        return handleQuestionStatsGet(url, env, origin, log);
      }

      // ── Dynamic OG social card generator ──────────────────────────────────
      // GET /og?title=…&type=quiz|bank|flashcard|osce|library|video&sub=…&site=…
      // Public, no auth, safe for open sharing.
      //
      // IMPORTANT — this always served (and still serves by default) an SVG
      // body. Most social crawlers that actually render og:image previews —
      // Facebook/Meta's, Twitter/X's, and others — do not accept SVG there at
      // all, so a link pointing straight at this URL renders no preview image
      // on those platforms regardless of how correct the markup is. Rasterizing
      // to a real PNG at request time needs a renderer this Worker doesn't
      // carry (no native canvas in the Workers runtime, and adding an
      // unverified WASM image dependency isn't something to ship blind in a
      // hardening pass), so instead: ?format=png resolves to the closest
      // pre-generated static PNG for that content type (see
      // scripts/generate-social-images.js), which is real, crawler-safe, and
      // needs no new runtime dependency. The frontend is fully static and has
      // no per-URL server, so it can't point og:image at this endpoint at all
      // for individual pages — it uses those same static per-type PNGs
      // directly (see the per-section layout.tsx files). This endpoint is
      // kept for direct API consumers who want a titled card and can render
      // SVG themselves (e.g. the Tauri admin panel), with format=png as an
      // explicit, working escape hatch to a static image for anyone who can't.
      if (request.method === "GET" && url.pathname === "/og") {
        const title = (url.searchParams.get("title") || "Osler").slice(0, 100);
        const sub = (url.searchParams.get("sub") || "").slice(0, 80);
        const type = url.searchParams.get("type") || "quiz";
        const site = (url.searchParams.get("site") || "Osler").slice(0, 40);

        const STATIC_OG_TYPES = new Set(["quiz", "bank", "flashcard", "osce", "library", "video", "written"]);
        if ((url.searchParams.get("format") || "").toLowerCase() === "png") {
          const staticType = STATIC_OG_TYPES.has(type) ? type : "quiz";
          const staticOrigin = env.ALLOWED_ORIGIN || "";
          const location = `${staticOrigin}/assets/og/${staticType}.png`;
          return new Response(null, {
            status: 302,
            headers: { location, "cache-control": "public, max-age=86400", ...cors(origin) },
          });
        }

        const esc = (s: string) => s.replace(/[<>&"]/g, (c: string) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));

        // Brand + palette: hexes from the app icon (public/assets/icon.svg —
        // navy gradient square, azure gradient pulse) and the app's design
        // tokens, converted exactly like scripts/generate-social-images.js
        // does at runtime — keep in sync.
        const INK = { bg: "#0f172a", text: "#f3f5f8", muted: "#96a0a7", mutedDim: "#80878d" };
        const BRAND = { markFrom: "#1e3a8a", markTo: "#0f172a", pulseFrom: "#60a5fa", pulseTo: "#3b82f6", cross: "#60a5fa" };
        const ENGINE: Record<string, { color: string }> = {
          quiz:      { color: "#2389e2" },
          bank:      { color: "#1380c7" },
          flashcard: { color: "#45ba50" },
          osce:      { color: "#ff5c73" },
          library:   { color: "#7f82e8" },
          video:     { color: "#00b8ba" },
          written:   { color: "#ecaa0b" },
        };
        const meta = ENGINE[type] || ENGINE.quiz;

        // Truncate to fit the card (system fonts run wider than the static
        // cards' Poppins, so the title cap is tighter here).
        const displayTitle = title.length > 32 ? title.slice(0, 30) + "…" : title;
        const displaySub = sub.length > 58 ? sub.slice(0, 56) + "…" : sub;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="depth" cx="0.16" cy="0.06" r="0.9">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.045"/>
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.markFrom}"/><stop offset="100%" stop-color="${BRAND.markTo}"/>
    </linearGradient>
    <linearGradient id="mark-pulse" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.pulseFrom}"/><stop offset="100%" stop-color="${BRAND.pulseTo}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="${INK.bg}"/>
  <rect width="1200" height="630" fill="url(#depth)"/>
  <g transform="translate(96 84)">
    <g transform="scale(0.52)">
      <rect width="100" height="100" rx="22" fill="url(#mark-bg)"/>
      <g fill="${BRAND.cross}" opacity="0.18">
        <rect x="44.1" y="28.5" width="11.7" height="43" rx="2.7"/>
        <rect x="28.5" y="44.1" width="43" height="11.7" rx="2.7"/>
      </g>
      <path d="M18.75 50 L32.42 50 L40.23 34.37 L48.05 65.63 L55.86 42.19 L63.67 50 L81.25 50" fill="none" stroke="url(#mark-pulse)" stroke-width="4.7" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="72" y="34" font-family="system-ui,-apple-system,sans-serif" font-size="22" font-weight="500" fill="${INK.muted}">${esc(site)}</text>
  </g>
  <rect x="96" y="266" width="72" height="6" rx="3" fill="${meta.color}"/>
  <text x="96" y="366" font-family="system-ui,-apple-system,sans-serif" font-size="56" font-weight="700" fill="${INK.text}" letter-spacing="-1">${esc(displayTitle)}</text>
  ${displaySub ? `<text x="96" y="424" font-family="system-ui,-apple-system,sans-serif" font-size="24" font-weight="400" fill="${INK.muted}">${esc(displaySub)}</text>` : ""}
  <line x1="96" y1="548" x2="1104" y2="548" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="1"/>
  <text x="96" y="583" font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="500" fill="${INK.mutedDim}">Offline-ready · Open source</text>
</svg>`;

        return new Response(svg, {
          status: 200,
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400",
            "x-content-type-options": "nosniff",
            ...cors(origin),
          } as any,
        });
      }

      // ── Support tickets ──
      // POST /v1/support/tickets — file a report. Pre-auth so local guests can
      // report too; signed-in reporters get their account attached server-side
      // (never trusted from the body). GET returns the caller's own tickets.
      if (request.method === "POST" && url.pathname === "/v1/support/tickets") {
        if (!rateLimit(ip, "ticket")) return json({ error: "Too many requests" }, 429, origin, log);
        const ticketSession = await requireUser(request, env).catch(() => null);
        if (ticketSession && !rateLimit(ticketSession.user.id, "ticket_user")) {
          return json({ error: "Too many requests" }, 429, origin, log);
        }
        return handleSupportTicketCreate(request, env, ticketSession, origin, log);
      }
      if (request.method === "GET" && url.pathname === "/v1/support/tickets") {
        const session = await requireUser(request, env);
        if (!session) return json({ error: "Authentication required" }, 401, origin, log);
        return handleSupportTicketsMine(env, session, origin, log);
      }

      // ── MCP OAuth 2.1 (browser-based client authorization) ──
      // Lets MCP clients connect by pasting the server URL: the client
      // discovers the well-known metadata documents, registers itself
      // dynamically, and the admin approves the request in the web UI
      // (consent page on ALLOWED_ORIGIN, authenticated with their normal
      // Osler session). Exchanged codes mint ordinary api_tokens rows, so
      // OAuth-granted access appears in — and is revocable from — the same
      // admin-panel token list as manual tokens. See mcp/oauth.ts.
      if (
        url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname.startsWith("/v1/mcp/oauth/")
      ) {
        const oauthHost: McpOAuthHost = {
          requireAdminSession: async (req) => {
            const s = await requireUser(req, env);
            return s && isAdminOrContent(s)
              ? { id: s.user.id, username: s.user.username, displayName: s.user.display_name, role: s.user.role }
              : null;
          },
          rateLimit: (key, bucket) => rateLimit(key, bucket),
          sha256,
          auditLog: (actorId, action, targetId, detail) => auditLog(env, actorId, action, targetId, detail),
          now,
        };
        if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") return handleProtectedResource(request, origin);
        if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") return handleServerMetadata(request, origin);
        if (url.pathname === "/v1/mcp/oauth/register") return handleRegister(request, env, origin, ip, oauthHost);
        if (url.pathname === "/v1/mcp/oauth/authorize") {
          return request.method === "GET"
            ? handleAuthorizeGet(request, env, origin, ip, oauthHost)
            : handleAuthorizePost(request, env, origin, ip, oauthHost);
        }
        if (url.pathname === "/v1/mcp/oauth/token") return handleToken(request, env, origin, ip, oauthHost);
        return json({ error: "Not found" }, 404, origin, log);
      }

      // ── MCP endpoint for AI agents ──
      // Authenticated with dedicated API tokens (not sessions) minted from
      // the web admin panel; capped at the content-authoring surface —
      // agents can create/upload/submit but never publish. Non-browser
      // clients send no Origin header, which requestOrigin() maps to
      // ALLOWED_ORIGIN, so they pass the same origin gate as first-party
      // traffic. Shares the admin rate bucket.
      if (url.pathname === "/v1/mcp") {
        if (!rateLimit(ip, "admin")) return json({ error: "Too many requests" }, 429, origin, log);
        return handleMcpRequest(request, env, origin, log, {
          auditLog,
          r2Get,
          r2Put,
          r2Delete: async (e, k) => { if (e.CONTENT) await e.CONTENT.delete(k); },
          validateContent,
          publishObject: async (e, id, rev, target) => publishContentObject(e, id, rev, target),
          unpublishObject: async (e, id, act) => unpublishContentObject(e, id, act),
          deleteObject: async (e, id, act) => deleteContentObject(e, id, act),
          updateManifestIncremental: async (e, cat, paths) => updateManifestIncremental(e, cat, paths),
          getConfig: async (e) => {
            if (!e.CONTENT) throw new Error("Content storage not configured");
            const obj = await e.CONTENT.get("_osler.config.json");
            return obj ? JSON.parse(await obj.text()) : null;
          },
          putConfig: async (e, cfg) => {
            if (!e.CONTENT) throw new Error("Content storage not configured");
            await e.CONTENT.put("_osler.config.json", JSON.stringify(cfg, null, 2), { httpMetadata: { contentType: "application/json" } });
          },
          readContentVersion: async (e) => readContentVersion(e),
          getAuditTrail: async (e, opts) => {
            const limit = Math.min(100, Math.max(1, opts.limit || 50));
            const offset = (Math.max(1, opts.page || 1) - 1) * limit;
            if (opts.action) {
              const [rows, total] = await Promise.all([
                e.DB.prepare("SELECT a.*, u.username as actor_username, u.display_name as actor_display_name FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action = ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?").bind(opts.action, limit, offset).all(),
                e.DB.prepare("SELECT COUNT(*) as n FROM admin_audit WHERE action = ?").bind(opts.action).first(),
              ]);
              return { items: rows.results || [], total: (total as any)?.n ?? 0 };
            }
            const [rows, total] = await Promise.all([
              e.DB.prepare("SELECT a.*, u.username as actor_username, u.display_name as actor_display_name FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all(),
              e.DB.prepare("SELECT COUNT(*) as n FROM admin_audit").first(),
            ]);
            return { items: rows.results || [], total: (total as any)?.n ?? 0 };
          },
          waitUntil: (p) => ctx.waitUntil(p),
          rateLimitToken: (tokenId) => rateLimit(tokenId, "mcp_token"),
        });
      }

      // ── Realtime sync pokes (WebSocket) ──
      // Browsers cannot set an Authorization header on a WS upgrade, so the
      // client first mints a 60-second ticket (POST /v1/realtime/ticket) and
      // passes it as a query param. The ticket is verified against JWT_SECRET
      // AND the D1 session row (revoked/expired sessions can't open sockets),
      // then the upgrade is forwarded to the user's hub DO.
      if (request.method === "GET" && url.pathname === "/v1/realtime") {
        if (!env.USER_SYNC_HUB) return json({ error: "Realtime sync is not configured" }, 503, origin, log);
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket upgrade required" }, 426, origin, log);
        if (!rateLimit(ip, "realtime")) return json({ error: "Too many requests" }, 429, origin, log);
        const verified = await verifyRealtimeTicket(env, url.searchParams.get("ticket") ?? "");
        if (!verified) return json({ error: "Invalid realtime ticket" }, 401, origin, log);
        const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?").bind(verified.sessionId, now()).first<{ user_id: string }>();
        if (!row || row.user_id !== verified.userId) return json({ error: "Invalid realtime ticket" }, 401, origin, log);
        const stub = env.USER_SYNC_HUB.getByName(verified.userId);
        return stub.fetch(new Request(`https://user-sync-hub.ws/upgrade?conn=${encodeURIComponent(url.searchParams.get("conn") ?? "")}`, { headers: { upgrade: "websocket" } }));
      }

      // ── From here on: authenticated routes ──
      const session = await requireUser(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, origin, log);

      // Mint a short-lived ticket for the /v1/realtime WebSocket upgrade. The
      // ticket inherits the session's identity (sub + sid) so the upgrade can
      // re-check the session row without the client exposing its bearer token
      // in a URL.
      if (request.method === "POST" && url.pathname === "/v1/realtime/ticket") {
        if (!rateLimit(ip, "realtime")) return json({ error: "Too many requests" }, 429, origin, log);
        const { ticket, expiresAt } = await mintRealtimeTicket(env, session.sessionId, session.user.id);
        return json({ ticket, expiresAt, ttlMs: REALTIME_TICKET_TTL_MS }, 200, origin, log);
      }

      // Admin namespace
      if (url.pathname.startsWith("/v1/admin")) {
        if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
        const adminResponse = await handleAdmin(request, env, session, url, origin, log);
        if (adminResponse) return adminResponse;
        return json({ error: "Not found" }, 404, origin, log);
      }

      // ── Account routes ──
      if (request.method === "GET" && url.pathname === "/v1/auth/me") return json(await accountPayload(env, session.user), 200, origin, log);

      // ── Session / device management ──
      // Users can list the devices signed in to their account and revoke
      // any of them. Revoking the current session behaves like a logout.
      if (request.method === "GET" && url.pathname === "/v1/account/sessions") {
        const rows = await env.DB.prepare(
          "SELECT id, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 50"
        ).bind(session.user.id, now()).all<any>();
        const sessions = (rows.results ?? []).map((r) => ({
          id: r.id,
          userAgent: typeof r.user_agent === "string" ? r.user_agent : null,
          createdAt: Number(r.created_at),
          lastSeenAt: Number(r.last_seen_at ?? r.created_at),
          expiresAt: Number(r.expires_at),
          current: r.id === session.sessionId,
        }));
        return json({ sessions }, 200, origin, log);
      }
      if (request.method === "POST" && url.pathname === "/v1/account/sessions/revoke-others") {
        await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
          .bind(now(), session.user.id, session.sessionId).run();
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/v1/account/sessions/")) {
        const targetId = url.pathname.slice("/v1/account/sessions/".length);
        if (!targetId || targetId === "revoke-others") return json({ error: "Not found" }, 404, origin, log);
        const result = await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
          .bind(now(), targetId, session.user.id).run();
        if ((result.meta?.changes ?? 0) === 0) return json({ error: "Session not found" }, 404, origin, log);
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "PATCH" && url.pathname === "/v1/account") {
        const body = await readJson(request);
        const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : session.user.display_name;
        const email = body.email === null || body.email === "" ? null : typeof body.email === "string" ? body.email.trim().toLowerCase() : session.user.email;
        if (!displayName || !validEmail(email)) return json({ error: "Invalid account details" }, 400, origin, log);
        // Changing the email must clear verification — a verification that was
        // issued for the old address must not validate the new one (the new
        // address could belong to someone else and become a Google-link anchor).
        const emailChanged = email !== session.user.email;
        try { await env.DB.prepare("UPDATE users SET display_name = ?, email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?").bind(displayName, email, emailChanged ? null : session.user.email_verified_at ?? null, now(), session.user.id).run(); } catch { return json({ error: "That email is already in use" }, 409, origin, log); }
        return json(await accountPayload(env, await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user.id).first<any>()), 200, origin, log);
      }
      if (request.method === "POST" && url.pathname === "/v1/account/password") {
        const body = await readJson(request);
        if (!validPassword(body.password)) return json({ error: "Password must be at least 8 characters with 2 character classes" }, 400, origin, log);
        if (Number(session.user.has_password ?? 1) === 1 && !await passwordMatches(String(body.currentPassword || ""), session.user.password_salt, session.user.password_hash)) return json({ error: "Current password is incorrect" }, 401, origin, log);
        const password = await passwordHash(body.password);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(password.hash, password.salt, now(), session.user.id),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?").bind(now(), session.user.id, session.sessionId),
        ]);
        return json(await issueSession(await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user.id).first<any>(), env, request.headers.get("user-agent")), 200, origin, log);
      }
      if (request.method === "GET" && url.pathname === "/v1/account/export") return json({ account: await accountPayload(env, session.user), progress: await getAllDocuments(env, session.user), exportedAt: now() }, 200, origin, log);
      if (request.method === "DELETE" && url.pathname === "/v1/account") {
        const body = await readJson(request);
        if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm account deletion" }, 400, origin, log);
        if (Number(session.user.has_password ?? 1) === 1 && !await passwordMatches(String(body.password || ""), session.user.password_salt, session.user.password_hash)) return json({ error: "Current password is incorrect" }, 401, origin, log);
        await env.DB.batch([
          env.DB.prepare("PRAGMA foreign_keys = ON;"),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM auth_identities WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM auth_handoffs WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(session.user.id),
        ]);
        // Sync shard: no FK cascade across databases (see admin user delete).
        const syncShard = userSyncShard(session.user);
        await ensureShardSchema(env, "sync", syncShard);
        await syncDb(env, syncShard).prepare("DELETE FROM progress_documents WHERE user_id = ?").bind(session.user.id).run();
        return json({ ok: true }, 200, origin, log);
      }

      // ── Gemini API key management ──
      if (request.method === "GET" && url.pathname === "/v1/account/gemini-key") {
        const row = await env.DB.prepare("SELECT gemini_api_key, gemini_model, gemini_max_wait FROM users WHERE id = ?").bind(session.user.id).first<any>();
        const key = row?.gemini_api_key ? await decryptField(row.gemini_api_key, env.GEMINI_ENCRYPTION_KEY) : null;
        return json({ apiKey: key, model: row?.gemini_model ?? null, maxWait: row?.gemini_max_wait ?? null, hasKey: !!key }, 200, origin, log);
      }
      if (request.method === "PUT" && url.pathname === "/v1/account/gemini-key") {
        const body = await readJson(request);
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim().slice(0, 200) : "";
        const model = typeof body.model === "string" ? body.model.trim().slice(0, 80) : null;
        const maxWait = Number.isFinite(body.maxWait) ? Math.min(120, Math.max(5, body.maxWait)) : null;
        // A model / max-wait-only save sends no key. That must NOT wipe an
        // existing saved key — clearing is explicit via the DELETE endpoint.
        // COALESCE(?, gemini_api_key) keeps the stored key when the bound
        // value is NULL.
        const before = await env.DB.prepare("SELECT gemini_api_key FROM users WHERE id = ?").bind(session.user.id).first<any>();
        const hasKey = apiKey.length > 0 || !!before?.gemini_api_key;
        const storedKey = apiKey ? await encryptField(apiKey, env.GEMINI_ENCRYPTION_KEY) : null;
        await env.DB.prepare("UPDATE users SET gemini_api_key = COALESCE(?, gemini_api_key), gemini_model = ?, gemini_max_wait = ?, updated_at = ? WHERE id = ?").bind(storedKey, model, maxWait, now(), session.user.id).run();
        return json({ ok: true, hasKey }, 200, origin, log);
      }
      if (request.method === "DELETE" && url.pathname === "/v1/account/gemini-key") {
        await env.DB.prepare("UPDATE users SET gemini_api_key = NULL, gemini_model = NULL, gemini_max_wait = NULL, updated_at = ? WHERE id = ?").bind(now(), session.user.id).run();
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "POST" && url.pathname === "/v1/account/gemini/proxy") {
        const row = await env.DB.prepare("SELECT gemini_api_key, gemini_model FROM users WHERE id = ?").bind(session.user.id).first<any>();
        const decryptedKey = row?.gemini_api_key ? await decryptField(row.gemini_api_key, env.GEMINI_ENCRYPTION_KEY) : null;
        if (!decryptedKey) return json({ error: "No Gemini API key saved" }, 400, origin, log);
        const body = await readJson(request);
        const endpoint = typeof body.endpoint === "string" ? body.endpoint : "generateContent";
        const model = (typeof body.model === "string" && body.model.trim()) || row.gemini_model || "gemini-3.5-flash-lite";
        if (!/^[a-zA-Z0-9._-]+$/.test(model)) return json({ error: "Invalid model name" }, 400, origin, log);
        if (!/^(generateContent|streamGenerateContent|countTokens)$/.test(endpoint)) {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(decryptedKey)}`, { method: "GET", headers: { "content-type": "application/json" } });
          const text = await r.text();
          return new Response(text, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", ...cors(origin) } as any });
        }
        const url2 = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${encodeURIComponent(decryptedKey)}`;
        const r = await fetch(url2, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body.body ?? {}) });
        const text = await r.text();
        return new Response(text, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store", ...cors(origin), ...SECURITY_HEADERS } as any });
      }

      // ── Sync ──
      if (request.method === "GET" && url.pathname === "/v1/sync") {
        if (!rateLimit(ip, "sync")) return json({ error: "Too many requests" }, 429, origin, log);
        const syncShard = userSyncShard(session.user);
        const isHead = url.searchParams.get("head") === "true" || url.searchParams.get("head") === "1";
        if (isHead) {
          const { timestamps, usedBytes } = await getSyncHead(env, session.user);
          return json({ timestamps, quota: { usedBytes, limitBytes: MAX_USER_STORAGE_BYTES } }, 200, origin, log);
        }
        const requestedKinds = url.searchParams.get("kinds")?.split(",").map(k => k.trim()).filter(Boolean);
        const docs = requestedKinds && requestedKinds.length > 0
          ? await getSelectedDocuments(env, session.user, requestedKinds)
          : await getAllDocuments(env, session.user);
        const sizeRow = await syncDb(env, syncShard).prepare("SELECT COALESCE(SUM(raw_bytes),0) as total FROM progress_documents WHERE user_id = ?").bind(session.user.id).first<{ total: number }>();
        return json({ ...docs, quota: { usedBytes: Number(sizeRow?.total ?? 0), limitBytes: MAX_USER_STORAGE_BYTES } }, 200, origin, log);
      }
      if (request.method === "PUT" && url.pathname === "/v1/sync") {
        if (!rateLimit(ip, "sync")) return json({ error: "Too many requests" }, 429, origin, log);
        const syncShard = userSyncShard(session.user);
        await ensureShardSchema(env, "sync", syncShard);
        const body = await readJsonBody(request, MAX_GZIP_BODY_BYTES); const statements: any[] = []; const changedKinds: string[] = []; const response: Record<string, any> = {};
        const bodyKinds = new Set<string>();
        for (const kind of SYNC_KINDS) if (body[kind] && typeof body[kind] === "object") bodyKinds.add(kind);
        const kindsToSync = SYNC_KINDS.filter((kind) => bodyKinds.has(kind));
        // Fetch the storage budget and every in-flight document in parallel —
        // previously each kind's doc was awaited sequentially inside the loop,
        // stretching a multi-kind push to N round-trips.
        const [sizeRows, ...currentDocs] = await Promise.all([
          syncDb(env, syncShard).prepare("SELECT kind, raw_bytes FROM progress_documents WHERE user_id = ?").bind(session.user.id).all<{ kind: string; raw_bytes: number }>(),
          ...kindsToSync.map((kind) => getDocument(env, session.user, kind)),
        ]);
        const currentByKind = new Map<string, { records: Record<string, any>; updatedAt: number }>();
        kindsToSync.forEach((kind, i) => { currentByKind.set(kind, currentDocs[i]); });
        // Retired kinds (RETIRED_SYNC_KINDS): legacy per-kind docs are dead
        // weight now that session-bound data rides inside the sessions doc.
        // Drop the rows lazily — the sizeRows scan above already knows whether
        // they exist — so they stop counting against the user's storage budget.
        const retiredSet = new Set<string>(RETIRED_SYNC_KINDS);
        const retiredCleanup = (sizeRows.results || []).some((row) => retiredSet.has(row?.kind ?? ""))
          ? [syncDb(env, syncShard).prepare("DELETE FROM progress_documents WHERE user_id = ? AND kind IN ('highlights', 'writtenDrafts')").bind(session.user.id)]
          : [];
        // Per-user storage budget: start from the raw bytes of stored rows NOT
        // being rewritten in this request, then add each merged doc's size.
        // Segment rows fold into their logical kind, so a pushed kind drops
        // ALL of its segment rows from the baseline.
        let projectedBytes = (sizeRows.results || []).reduce((sum, row) => {
          const kind = row?.kind ?? "";
          // Retired rows are deleted by this same request — don't count them.
          return sum + (bodyKinds.has(baseKindOfRow(kind)) || retiredSet.has(kind) ? 0 : (Number(row?.raw_bytes) || 0));
        }, 0);
        for (const kind of kindsToSync) {
          const local = body[kind].records;
          if (!local || typeof local !== "object" || Array.isArray(local)) return json({ error: "Invalid progress document" }, 400, origin, log);
          const current = currentByKind.get(kind)!;
          // Per-kind optimistic concurrency: each document compares against
          // the updatedAt snapshot the client saw for THAT kind, so a qbank
          // change doesn't spuriously 409 the flashcards write (and vice versa).
          const sinceRaw = request.headers.get(`x-sync-since-${kind}`) ?? request.headers.get("If-Unmodified-Since");
          if (sinceRaw) {
            const since = Number(sinceRaw);
            if (!isNaN(since) && current.updatedAt > since) return json({ error: "Conflict: data has been modified since last fetch", conflict: true, serverUpdatedAt: current.updatedAt, kind }, 409, origin, log);
          }
          const merged = mergeKind(current.records, local, kind);
          // Skip the write entirely when nothing changed — avoids burning a D1
          // write (and bumping updated_at) on every no-op push.
          if (!merged.changed) { response[kind] = { records: current.records, updatedAt: current.updatedAt }; continue; }
          const updatedAt = now();
          response[kind] = { records: merged.records, updatedAt };
          // One poke per LOGICAL kind — segmentation is invisible to the
          // realtime hub, so a multi-segment push never multiplies pokes.
          changedKinds.push(kind);
          if (SEGMENTED_KINDS.has(kind)) {
            // Orchestrator write path: repack the merged kind into sequential
            // segments (a new one starts at 85% occupancy), rewrite them all
            // in this batch, and drop the previous layout — stale segment
            // rows plus the pre-segmentation plain row would otherwise keep
            // serving (and being double-counted) forever.
            const existingSegmentCount = (sizeRows.results || []).filter((row) => splitSegmentKind(row?.kind ?? "")?.base === kind).length;
            const { segments, deleteKinds } = packKindSegments(kind, merged.records, existingSegmentCount);
            for (const stale of [kind, ...deleteKinds]) {
              statements.push(syncDb(env, syncShard).prepare("DELETE FROM progress_documents WHERE user_id = ? AND kind = ?").bind(session.user.id, stale));
            }
            for (const segment of segments) {
              // Store gzip-compressed to save D1 space (~5-8x); raw_bytes
              // tracks the uncompressed JSON so the per-user budget is
              // enforced on real content, not compressed size.
              const compressedB64 = await gzipString(segment.json);
              const storedBytes = encoder.encode(compressedB64).length;
              if (storedBytes > MAX_STORED_PAYLOAD_BYTES) return json({ error: "Progress document is too large to store" }, 400, origin, log);
              const segmentBytes = encoder.encode(segment.json).length;
              projectedBytes += segmentBytes;
              statements.push(syncDb(env, syncShard).prepare("INSERT INTO progress_documents (user_id, kind, payload, compressed, raw_bytes, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET payload = excluded.payload, compressed = 1, raw_bytes = excluded.raw_bytes, updated_at = excluded.updated_at").bind(session.user.id, segment.kind, compressedB64, segmentBytes, updatedAt));
            }
          } else {
            const mergedBytes = encoder.encode(merged.json).length;
            if (mergedBytes > MAX_DOCUMENT_BYTES) return json({ error: "Progress document is too large after merge" }, 400, origin, log);
            // Guard the STORED size too: base64 gzip of a 2MB raw doc stays far
            // under D1's 2MB row limit for compressible progress data, but this
            // check guarantees it even for incompressible (e.g. already-encoded)
            // content that gzip can't shrink.
            const compressedB64 = await gzipString(merged.json);
            const storedBytes = encoder.encode(compressedB64).length;
            if (storedBytes > MAX_STORED_PAYLOAD_BYTES) return json({ error: "Progress document is too large to store" }, 400, origin, log);
            projectedBytes += mergedBytes;
            statements.push(syncDb(env, syncShard).prepare("INSERT INTO progress_documents (user_id, kind, payload, compressed, raw_bytes, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET payload = excluded.payload, compressed = 1, raw_bytes = excluded.raw_bytes, updated_at = excluded.updated_at").bind(session.user.id, kind, compressedB64, mergedBytes, updatedAt));
          }
          if (projectedBytes > MAX_USER_STORAGE_BYTES) return json({ error: "Sync storage limit exceeded (15MB per user). Remove old progress to free space.", limit: MAX_USER_STORAGE_BYTES }, 413, origin, log);
        }
        if (statements.length || retiredCleanup.length) {
          await syncDb(env, syncShard).batch([...statements, ...retiredCleanup]);
          // Fire-and-forget poke: the user's other connected devices pull
          // immediately over the realtime hub (clients no longer idle-poll).
          // The pushing
          // connection (x-osler-realtime-conn) is skipped by the hub; a
          // missing binding (unmigrated instance) or hub failure must never
          // fail the sync response itself. Only pokes when a live kind
          // actually changed — a cleanup-only batch needs no fan-out.
          if (changedKinds.length && env.USER_SYNC_HUB) {
            ctx.waitUntil(env.USER_SYNC_HUB.getByName(session.user.id).notify(request.headers.get("x-osler-realtime-conn") ?? "", changedKinds).catch(() => {}));
          }
        }
        // Include the storage budget in the PUT response so push-only sync
        // cycles (which no longer HEAD first) keep the client's quota widget
        // fresh without an extra request.
        return json({ ...response, quota: { usedBytes: projectedBytes, limitBytes: MAX_USER_STORAGE_BYTES } }, 200, origin, log);
      }

      return json({ error: "Not found" }, 404, origin, log);
    } catch (error: any) {
      console.error("Unhandled error:", error);
      return json({ error: "Internal server error" }, 500, origin, log);
    }
  },
};
