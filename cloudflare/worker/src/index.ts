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
import { SYNC_KINDS, mergeKind, gzipString, gunzipBytes, gunzipBytesBounded, base64ToBytes } from "./sync-docs";
import { verifyAssertion } from "./cose";
import { sendEmail, passwordResetEmail, verifyEmail } from "./email";
import { handleMcpRequest, listApiTokens, mintApiToken, revokeApiToken } from "./mcp";
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
// Hard ceiling for a single merged sync document's raw JSON. D1 caps each
// string/BLOB/row at 2MB, so a doc can never exceed that. Payload is stored
// gzip-compressed (~5-8x smaller for progress data), so a 2MB raw doc only
// occupies ~300-500KB on disk.
const MAX_DOCUMENT_BYTES = 2_000_000;
// Stored payload (base64 gzip) budget for a single doc — leaves headroom under
// D1's 2MB row limit for the other columns (user_id, kind, timestamps).
const MAX_STORED_PAYLOAD_BYTES = 1_800_000;
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
  "biometric": 6,
  "ip:global": 600,
  "content": 240,
  "admin": 600,
  "sync": 30,
  "search": 30,
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
// from starving the rest of the app.
const ANALYTICS_MAX_BATCH = 20;
const ANALYTICS_MAX_PATH_LEN = 255;
const ANALYTICS_MAX_DETAIL_BYTES = 512;
// Global daily write cap for analytics events. When exceeded, new events
// are rejected with 429 until the next UTC midnight. This protects the D1
// daily row-write quota (100K/day free tier) from being exhausted by a
// single determined authenticated user. Cached in-memory per worker
// instance for 60s to avoid a COUNT(*) on every request.
const ANALYTICS_DAILY_WRITE_CAP = 50_000;
const ANALYTICS_DAILY_CAP_CACHE_TTL_MS = 60_000;

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
const QBANK_STATS_DAILY_CAP_CACHE_TTL_MS = 60_000;

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
  CONTENT?: R2Bucket;
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
  APP_ORIGIN?: string;
  GEMINI_ENCRYPTION_KEY?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_RP_ID?: string;
  CONTENT_ONLY_MANAGED?: string | boolean;
  /** Minimum respondents before students see peer percentages (default 5). */
  QBANK_STATS_MIN_SAMPLE?: string;
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
    "access-control-allow-headers": "authorization, content-type, content-encoding, if-unmodified-since, x-sync-since-qbank, x-sync-since-flashcards, x-sync-since-sessions, x-sync-since-notes, x-sync-since-highlights, x-sync-since-articleHighlights, x-sync-since-writtenDrafts, x-sync-since-bookmarks, x-sync-since-achievements, x-sync-since-*",
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

async function issueSession(user: UserRow, env: Env) {
  const sessionId = id();
  const expiresAt = now() + SESSION_TTL_MS;
  const payload = b64url(encoder.encode(JSON.stringify({ sub: user.id, sid: sessionId, role: user.role, exp: Math.floor(expiresAt / 1000) })));
  const token = `${payload}.${await hmac(payload, env.JWT_SECRET)}`;
  const tokenHash = await sha256(token);
  const result = await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
    SELECT ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?) < ?
  `).bind(sessionId, user.id, tokenHash, expiresAt, now(), user.id, now(), MAX_SESSIONS_PER_USER).run();
  if ((result.meta?.rows_written ?? 1) === 0) {
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id IN (SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at ASC LIMIT 1)").bind(now(), user.id, now()),
      env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(sessionId, user.id, tokenHash, expiresAt, now()),
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
  const row = await env.DB.prepare("SELECT s.id as _sid, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?")
    .bind(claims.sid, await sha256(token), now()).first<Record<string, unknown>>();
  if (!row) return null;
  const { _sid, ...userFields } = row;
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
  return issueSession(user, env);
}

// ─── Sync merging ────────────────────────────────────────────────────────────
// mergeQbank / mergeFlashcards now live in ./sync-docs (pure, unit-tested).

async function getDocument(env: Env, userId: string, kind: string): Promise<{ records: Record<string, any>; updatedAt: number }> {
  const row = await env.DB.prepare("SELECT payload, compressed, updated_at FROM progress_documents WHERE user_id = ? AND kind = ?").bind(userId, kind).first<{ payload: string; compressed: number; updated_at: number }>();
  if (!row || !row.payload) return { records: {}, updatedAt: 0 };
  try {
    const json = row.compressed ? await gunzipBytes(base64ToBytes(row.payload)) : row.payload;
    return { records: JSON.parse(json), updatedAt: row.updated_at };
  } catch { return { records: {}, updatedAt: 0 }; }
}

async function getAllDocuments(env: Env, userId: string): Promise<Record<string, { records: Record<string, any>; updatedAt: number }>> {
  const docs: Record<string, { records: Record<string, any>; updatedAt: number }> = {};
  const results = await Promise.all(SYNC_KINDS.map((kind) => getDocument(env, userId, kind)));
  SYNC_KINDS.forEach((kind, i) => { docs[kind] = results[i]; });
  return docs;
}

async function getSelectedDocuments(env: Env, userId: string, kinds: string[]): Promise<Record<string, { records: Record<string, any>; updatedAt: number }>> {
  const validKinds = new Set<string>(SYNC_KINDS);
  const kindsToFetch = kinds.filter((kind) => validKinds.has(kind));
  const docs: Record<string, { records: Record<string, any>; updatedAt: number }> = {};
  const results = await Promise.all(kindsToFetch.map((kind) => getDocument(env, userId, kind)));
  kindsToFetch.forEach((kind, i) => { docs[kind] = results[i]; });
  return docs;
}

async function getSyncHead(env: Env, userId: string): Promise<{ timestamps: Record<string, number>; usedBytes: number }> {
  const rows = await env.DB.prepare("SELECT kind, updated_at, raw_bytes FROM progress_documents WHERE user_id = ?").bind(userId).all<{ kind: string; updated_at: number; raw_bytes: number }>();
  const timestamps: Record<string, number> = {};
  for (const k of SYNC_KINDS) timestamps[k] = 0;
  let usedBytes = 0;
  for (const row of rows.results || []) {
    if (row.kind && typeof row.updated_at === "number") {
      timestamps[row.kind] = row.updated_at;
    }
    usedBytes += Number(row.raw_bytes || 0);
  }
  return { timestamps, usedBytes };
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
      await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
        .bind(userId, await availableGoogleUsername(env, claims.email), claims.email.toLowerCase(), String(claims.name || claims.email.split("@")[0]).slice(0, 80), generatedPassword.hash, generatedPassword.salt, now(), now()).run();
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
      env.DB.prepare("DELETE FROM biometric_sessions WHERE expires_at < ? OR used_at IS NOT NULL").bind(now()),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").bind(now()),
      // Lockout rows past their lock window are dead weight - drop them.
      env.DB.prepare("DELETE FROM login_failures WHERE locked_until IS NOT NULL AND locked_until < ?").bind(now() - LOGIN_LOCKOUT_MS),
      env.DB.prepare("DELETE FROM admin_audit WHERE created_at < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM analytics_events WHERE created_at < ?").bind(analyticsCutoff),
      // Choice-stats respondent rows: only needed to dedup contributors;
      // past this window a contributor may legitimately count again.
      env.DB.prepare("DELETE FROM question_choice_respondents WHERE created_at < ?").bind(now() - QBANK_STATS_RESPONDENT_RETENTION_MS),
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
  quiz: "qbank", bank: "qbank", written: "qbank",
  flashcard: "flashcard", osce: "osce",
  library: "library", video: "videos",
};

/** Reverse of CONTENT_TYPE_TO_CATEGORY — for a given R2 content-files/
 *  category folder, which content_types might publish into it.
 *  Used by the unified browser's /by-r2-key lookup. */
const CATEGORY_TYPE_TO_TYPE: Record<string, string[]> = {
  qbank: ["quiz", "bank", "written"],
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
/* ── Biometric helpers ── */
function windowOrigin(env: Env): string {
  try { return new URL(env.ALLOWED_ORIGIN).hostname; } catch { return "localhost"; }
}

function decodeClientDataJSON(b64: string): { type: string; challenge: string; origin: string; crossOrigin?: boolean } | null {
  try {
    const raw = unb64url(b64);
    return JSON.parse(decoder.decode(raw));
  } catch { return null; }
}

/* ── Biometric (WebAuthn) handlers ── */
async function handleBiometricRegister(_request: Request, env: Env, session: Session, log: Logger): Promise<Response> {
  if (!env.WEBAUTHN_RP_NAME || !env.WEBAUTHN_RP_ID) return json({ error: "WebAuthn not configured" }, 503, "", log);
  const existing = await env.DB.prepare("SELECT id FROM biometric_credentials WHERE user_id = ?").bind(session.user.id).all();
  if ((existing.results?.length ?? 0) >= 10) return json({ error: "Maximum 10 credentials per user" }, 400, "", log);
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const credentialId = id();
  const b64Challenge = btoa(String.fromCharCode(...challenge));
  const rpId = env.WEBAUTHN_RP_ID;
  await env.DB.prepare("INSERT INTO biometric_sessions (id, user_id, challenge, rp_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(credentialId, session.user.id, b64Challenge, rpId, now(), now() + 5 * 60 * 1000).run();
  return json({
    publicKey: {
      rp: { name: env.WEBAUTHN_RP_NAME, id: rpId },
      user: { id: btoa(session.user.id), name: session.user.username, displayName: session.user.display_name },
      challenge: Array.from(challenge),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
      attestation: "none",
      sessionId: credentialId,
    }
  }, 200, "", log);
}

async function handleBiometricRegisterComplete(request: Request, env: Env, session: Session, log: Logger): Promise<Response> {
  const body = await readJson(request);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const credData = body.credential;
  if (!sessionId || !credData) return json({ error: "sessionId and credential required" }, 400, "", log);
  const bs = await env.DB.prepare("SELECT * FROM biometric_sessions WHERE id = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?").bind(sessionId, session.user.id, now()).first<any>();
  if (!bs) return json({ error: "Invalid or expired session" }, 400, "", log);
  await env.DB.prepare("UPDATE biometric_sessions SET used_at = ? WHERE id = ?").bind(now(), sessionId).run();
  const rawId = typeof credData.rawId === "string" ? credData.rawId : JSON.stringify(credData.rawId || credData.id || "");
  const clientDataJSON = typeof credData.clientDataJSON === "string" ? credData.clientDataJSON : "";
  const attestationObject = typeof credData.attestationObject === "string" ? credData.attestationObject : "";
  if (!rawId || !clientDataJSON || !attestationObject) return json({ error: "Incomplete credential data" }, 400, "", log);
  const cdj = decodeClientDataJSON(clientDataJSON);
  if (!cdj || cdj.type !== "webauthn.create") return json({ error: "Invalid client data" }, 400, "", log);
  const storedB64url = bs.challenge.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (cdj.challenge !== storedB64url) return json({ error: "Challenge mismatch" }, 400, "", log);
  const rpOrigin = env.ALLOWED_ORIGIN.replace(/\/$/, "");
  if (cdj.origin !== rpOrigin) return json({ error: "Origin mismatch" }, 400, "", log);
  // Seed the rollback detector with the authenticator's initial counter.
  let seedSignCount = 0;
  try {
    const attBytes = unb64url(attestationObject);
    if (attBytes.length > 37) {
      seedSignCount = ((attBytes[33] << 24) | (attBytes[34] << 16) | (attBytes[35] << 8) | attBytes[36]) >>> 0;
    }
  } catch {}
  await env.DB.prepare("INSERT INTO biometric_credentials (id, user_id, credential_id, credential_data_json, sign_count, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id(), session.user.id, rawId, JSON.stringify({ clientDataJSON, attestationObject, rawId }), seedSignCount, typeof body.deviceName === "string" ? body.deviceName.trim().slice(0, 100) : "Unknown device", now()).run();
  return json({ ok: true }, 200, "", log);
}

async function handleBiometricAuthenticate(request: Request, env: Env, _session: Session | null, log: Logger): Promise<Response> {
  let uid: string | null = null;
  if (_session) uid = _session.user.id;
  if (!uid) {
    const body = await readJson(request);
    let userId = typeof body.userId === "string" ? body.userId.trim() : "";
    // Uniform no-challenge response for unknown users/ids: returning
    // distinct 404s here would leak which usernames have accounts.
    const NOT_REGISTERED = () => json({ error: "Biometric unlock is not available for this account" }, 404, "", log);
    if (!userId && typeof body.username === "string" && body.username.trim()) {
      // The login screen's quick unlock only knows the locally-stored
      // username, not the account's row id — resolve it case-insensitively.
      const byName = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(body.username.trim()).first<any>();
      if (!byName) return NOT_REGISTERED();
      userId = byName.id;
    }
    if (!userId) return json({ error: "userId or username required" }, 400, "", log);
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
    if (!user) return NOT_REGISTERED();
    uid = userId;
  }
  const creds = await env.DB.prepare("SELECT * FROM biometric_credentials WHERE user_id = ?").bind(uid).all<any>();
  if (!creds.results?.length) {
    return json({ error: "Biometric unlock is not available for this account" }, 404, "", log);
  }
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const b64Challenge = btoa(String.fromCharCode(...challenge));
  const sessionId = id();
  await env.DB.prepare("INSERT INTO biometric_sessions (id, user_id, challenge, rp_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(sessionId, uid, b64Challenge, env.WEBAUTHN_RP_ID || windowOrigin(env), now(), now() + 5 * 60 * 1000).run();
  return json({
    publicKey: {
      challenge: Array.from(challenge),
      allowCredentials: creds.results.map((c: any) => ({ id: c.credential_id, type: "public-key", transports: ["internal"] })),
      userVerification: "required",
      sessionId,
    }
  }, 200, "", log);
}

async function handleBiometricAuthenticateComplete(request: Request, env: Env, _session: Session | null, log: Logger): Promise<Response> {
  const body = await readJson(request);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const credData = body.credential;
  if (!sessionId || !credData) return json({ error: "sessionId and credential required" }, 400, "", log);
  const bs = await env.DB.prepare("SELECT * FROM biometric_sessions WHERE id = ? AND used_at IS NULL AND expires_at > ?").bind(sessionId, now()).first<any>();
  if (!bs) return json({ error: "Invalid or expired session" }, 400, "", log);
  await env.DB.prepare("UPDATE biometric_sessions SET used_at = ? WHERE id = ?").bind(now(), sessionId).run();

  const rawId = typeof credData.rawId === "string" ? credData.rawId : typeof credData.id === "string" ? credData.id : "";
  const responseData = credData.response || {};
  const clientDataJSON = typeof responseData.clientDataJSON === "string" ? responseData.clientDataJSON : (typeof credData.clientDataJSON === "string" ? credData.clientDataJSON : "");
  if (!rawId || !clientDataJSON) return json({ error: "Incomplete assertion data" }, 400, "", log);

  const cdj = decodeClientDataJSON(clientDataJSON);
  if (!cdj || cdj.type !== "webauthn.get") return json({ error: "Invalid client data" }, 400, "", log);
  const storedB64url = bs.challenge.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (cdj.challenge !== storedB64url) return json({ error: "Challenge mismatch" }, 400, "", log);
  const rpOrigin = env.ALLOWED_ORIGIN.replace(/\/$/, "");
  if (cdj.origin !== rpOrigin) return json({ error: "Origin mismatch" }, 400, "", log);

  // The clientDataJSON above is fully attacker-supplied, so the ONLY thing
  // that proves possession of the enrolled key is the assertion signature.
  // Before this, the handler issued a session based solely on the client's
  // (leakable) credential id — a full account-takeover for any user with a
  // registered biometric. Fetch the stored enrollment and verify the ECDSA
  // signature over authenticatorData || SHA256(clientDataJSON) now.
  const credential = await env.DB.prepare("SELECT * FROM biometric_credentials WHERE credential_id = ? AND user_id = ?").bind(rawId, bs.user_id).first<any>();
  if (!credential) return json({ error: "Credential not found" }, 400, "", log);
  const authenticatorData = typeof responseData.authenticatorData === "string" ? responseData.authenticatorData : "";
  const assertionSignature = typeof responseData.signature === "string" ? responseData.signature : "";
  if (!authenticatorData || !assertionSignature) return json({ error: "Assertion data missing" }, 400, "", log);
  const rpId = bs.rp_id || windowOrigin(env);
  const storedCred: { attestationObject?: string } = (() => { try { return JSON.parse(credential.credential_data_json ?? "{}"); } catch { return {}; } })();
  const verified = await verifyAssertion(storedCred.attestationObject ?? "", rpId, authenticatorData, assertionSignature, clientDataJSON);
  if (!verified) return json({ error: "Biometric verification failed" }, 401, "", log);
  // Sign-count rollback detection: a genuine hardware authenticator
  // increments its counter on every assertion. A counter that goes backwards
  // (or never moves from a non-zero seed) indicates a cloned key — reject and
  // force re-enrollment. Software passkeys that legitimately always report 0
  // are exempt (counter stays 0 from enrollment onward).
  try {
    const authDataBytes = unb64url(authenticatorData);
    const currentCount = ((authDataBytes[33] << 24) | (authDataBytes[34] << 16) | (authDataBytes[35] << 8) | authDataBytes[36]) >>> 0;
    const storedCount = Number(credential.sign_count ?? 0) >>> 0;
    if (storedCount > 0 && (currentCount === 0 || currentCount < storedCount)) {
      await env.DB.prepare("DELETE FROM biometric_credentials WHERE id = ?").bind(credential.id).run();
      return json({ error: "Credential failed integrity check — re-enroll this device" }, 401, "", log);
    }
    if (currentCount !== storedCount) {
      await env.DB.prepare("UPDATE biometric_credentials SET sign_count = ? WHERE id = ?").bind(currentCount, credential.id).run();
    }
  } catch {
    // Malformed counter bytes already fail signature verification above.
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(bs.user_id).first<any>();
  if (!user) return json({ error: "User not found" }, 404, "", log);
  return json(await issueSession(user, env), 200, "", log);
}

async function handleBiometricCredentials(request: Request, env: Env, session: Session, log: Logger): Promise<Response> {
  const creds = await env.DB.prepare("SELECT id, credential_id, device_name, created_at FROM biometric_credentials WHERE user_id = ? ORDER BY created_at ASC").bind(session.user.id).all();
  return json({ credentials: creds.results || [] }, 200, "", log);
}

async function handleBiometricDelete(request: Request, env: Env, session: Session, log: Logger, _url: URL): Promise<Response> {
  const credentialId = _url.pathname.split("/").pop() || "";
  if (!credentialId) return json({ error: "credentialId required" }, 400, "", log);
  const cred = await env.DB.prepare("SELECT * FROM biometric_credentials WHERE id = ? AND user_id = ?").bind(credentialId, session.user.id).first();
  if (!cred) return json({ error: "Credential not found" }, 404, "", log);
  await env.DB.prepare("DELETE FROM biometric_credentials WHERE id = ? AND user_id = ?").bind(credentialId, session.user.id).run();
  return json({ ok: true }, 200, "", log);
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

// ── Global daily write cap (DoS protection for D1 quota) ──
//
// The D1 free tier allows 100,000 rows written per day for the ENTIRE
// database. A single authenticated user sending 50 events per batch at
// 60 batches/min could exhaust this in ~33 minutes, taking down auth,
// sync, and content management. This cap rejects new events once the
// daily total reaches ANALYTICS_DAILY_WRITE_CAP (50K), leaving 50K for
// the rest of the app.
//
// Implementation: in-memory cache per worker instance, refreshed every 60s
// via a COUNT(*) query. Multiple worker instances may each have their own
// cache, so the effective cap is (N_instances * 60s_worth_of_writes) above
// the target — acceptable given the 50K margin.

let analyticsDailyCount: { date: string; count: number; checkedAt: number } = {
  date: "",
  count: 0,
  checkedAt: 0,
};

/** Returns the UTC date string (YYYY-MM-DD) for the given epoch ms. */
function utcDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Check if the global daily analytics write cap has been exceeded.
 *  Cached for ANALYTICS_DAILY_CAP_CACHE_TTL_MS to avoid a COUNT(*) per
 *  request. Returns true if writes are allowed, false if over cap. */
async function analyticsDailyCapOk(env: Env): Promise<boolean> {
  const today = utcDateString(now());
  const t = now();
  // Cache hit — return cached result.
  if (
    analyticsDailyCount.date === today &&
    t - analyticsDailyCount.checkedAt < ANALYTICS_DAILY_CAP_CACHE_TTL_MS
  ) {
    return analyticsDailyCount.count < ANALYTICS_DAILY_WRITE_CAP;
  }
  // Cache miss or date changed — query D1 for today's count.
  // Start of today in UTC millis.
  const startOfToday = Date.UTC(
    new Date(t).getUTCFullYear(),
    new Date(t).getUTCMonth(),
    new Date(t).getUTCDate(),
  );
  try {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM analytics_events WHERE created_at >= ?"
    ).bind(startOfToday).first<{ n: number }>();
    const count = row?.n ?? 0;
    analyticsDailyCount = { date: today, count, checkedAt: t };
    return count < ANALYTICS_DAILY_WRITE_CAP;
  } catch {
    // If the COUNT fails (DB error), allow the write — better to risk
    // exceeding the cap than to block legitimate telemetry. The per-IP
    // and per-user rate limits still apply.
    return true;
  }
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
  // Pre-check Content-Length to avoid parsing a huge body that we'll reject
  // anyway. 20 events * ~1KB each ≈ 20KB; reject anything over 100KB to
  // leave headroom for JSON overhead.
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 100_000) {
    return json({ error: "Request body too large" }, 413, origin, log);
  }

  // Global daily write cap — protects D1 free-tier quota (100K rows/day
  // for the ENTIRE database) from being exhausted by analytics alone.
  if (!(await analyticsDailyCapOk(env))) {
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
      env.DB.prepare(
        "INSERT INTO analytics_events (id, session_id, event_type, path, metric_name, value, detail, browser, device, connection, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id(), clientSessionId, eventType, path, metricName, value, detail, browser, device, connection, clientTs)
    );
    accepted += 1;
  }

  if (stmts.length === 0) return json({ ok: true, accepted: 0 }, 200, origin, log);
  try {
    await env.DB.batch(stmts);
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

let qstatsDailyCount: { date: string; count: number; checkedAt: number } = {
  date: "",
  count: 0,
  checkedAt: 0,
};

/** Same pattern as analyticsDailyCapOk: cached COUNT guard protecting the D1
 *  daily row-write quota from being exhausted by choice-stats reports. */
async function qstatsDailyCapOk(env: Env): Promise<boolean> {
  const t = now();
  const today = new Date(t).toISOString().slice(0, 10);
  if (
    qstatsDailyCount.date === today &&
    t - qstatsDailyCount.checkedAt < QBANK_STATS_DAILY_CAP_CACHE_TTL_MS
  ) {
    return qstatsDailyCount.count < QBANK_STATS_DAILY_WRITE_CAP;
  }
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM question_choice_stats WHERE updated_at >= ?")
    .bind(t - 24 * 60 * 60 * 1000)
    .first<{ n: number }>();
  // Note: this counts rows TOUCHED in the window, not writes — a hot (uid,qid,
  // choice) counter updated many times counts once. That under-counts, but the
  // per-question write volume is inherently small (first attempts only), so
  // the guard still catches flooding while staying cheap.
  qstatsDailyCount = { date: today, count: row?.n ?? 0, checkedAt: t };
  return qstatsDailyCount.count < QBANK_STATS_DAILY_WRITE_CAP;
}

function sanitizeStatsId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const v = raw.slice(0, QBANK_STATS_ID_MAX_LEN);
  if (/[\x00-\x1f\x7f]/.test(v)) return null;
  return v;
}

async function handleQuestionStatsReport(request: Request, env: Env, session: Session | null, origin: string, log: Logger): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 100_000) {
    return json({ error: "Request body too large" }, 413, origin, log);
  }
  if (!(await qstatsDailyCapOk(env))) {
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
      env.DB.prepare(
        `INSERT INTO question_choice_stats (uid, qid, choice, options_count, count, updated_at)
         SELECT ?, ?, ?, ?, 1, ?
         WHERE NOT EXISTS (SELECT 1 FROM question_choice_respondents WHERE aid = ? AND uid = ? AND qid = ?)
         ON CONFLICT(uid, qid, choice) DO UPDATE SET count = count + 1, options_count = excluded.options_count, updated_at = excluded.updated_at`
      ).bind(uid, qid, choice, optionsCount, t, aid, uid, qid)
    );
    stmts.push(
      env.DB.prepare(
        "INSERT INTO question_choice_respondents (aid, uid, qid, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(aid, uid, qid) DO NOTHING"
      ).bind(aid, uid, qid, t)
    );
  }

  if (stmts.length === 0) return json({ ok: true, accepted: 0 }, 200, origin, log);
  try {
    const results = await env.DB.batch(stmts);
    // Odd-indexed results are the respondent inserts; changes === 1 means
    // this contributor's first-ever answer to that question was counted.
    const accepted = results.filter((_, i) => i % 2 === 1).reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
    return json({ ok: true, accepted }, 200, origin, log);
  } catch (error: any) {
    log.error("choice stats report failed", { error: error.message, count: stmts.length });
    return json({ error: "Failed to store choice stats" }, 500, origin, log);
  }
}

async function handleQuestionStatsGet(url: URL, env: Env, origin: string, log: Logger): Promise<Response> {
  const uid = sanitizeStatsId(url.searchParams.get("uid"));
  if (!uid) return json({ error: "Missing uid" }, 400, origin, log);

  interface StatsRow { qid: string; choice: number; options_count: number; count: number }
  let rows: StatsRow[];
  try {
    ({ results: rows } = await env.DB.prepare(
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

  const [userRows, docRows] = await Promise.all([
    env.DB.prepare("SELECT id, username, display_name FROM users").all<{ id: string; username: string | null; display_name: string | null }>(),
    env.DB.prepare("SELECT user_id, kind, payload, compressed FROM progress_documents WHERE kind IN ('qbank','flashcards')").all<{ user_id: string; kind: string; payload: string; compressed: number }>(),
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
  const path = url.pathname;

  /* ── Overview ── */
  if (request.method === "GET" && path === "/v1/admin/analytics/overview") {
    const since = now() - analyticsRangeMs(url);
    const since24h = now() - 24 * 60 * 60 * 1000;
    const row = await env.DB.prepare(
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
    const row24 = await env.DB.prepare(
      `SELECT
         COUNT(*) AS events_24h,
         COUNT(DISTINCT session_id) AS sessions_24h,
         SUM(CASE WHEN event_type = 'js_error' THEN 1 ELSE 0 END) AS js_errors_24h
       FROM analytics_events WHERE created_at >= ?`
    ).bind(since24h).first<any>();
    return json({
      range: analyticsRangeLabel(url),
      totalEvents:          row?.total_events ?? 0,
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
    const rows = await env.DB.prepare(
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
    const rows = await env.DB.prepare(
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
    const rows = await env.DB.prepare(
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
    const rows = await env.DB.prepare(
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
    const rows = await env.DB.prepare(
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
      const packs = await env.DB.prepare(
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
    const rows = await env.DB.prepare(
      "SELECT qid, choice, options_count, count FROM question_choice_stats WHERE uid = ?"
    ).bind(uid).all<StatsRow>();
    return json({ pack: uid, stats: groupChoiceRows(rows.results || [], 0) }, 200, origin, log);
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
      const docs = await getAllDocuments(env, targetId);
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
          env.DB.prepare("DELETE FROM progress_documents WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM auth_identities WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM auth_handoffs WHERE user_id = ?").bind(targetId),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetId),
        ]);
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
                  if (Array.isArray(j.questions)) contentType = "quiz";
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
      const prefixes = ["content/quiz/", "content/bank/", "content/written/", "content/flashcard/", "content/osce/", "content/library/", "content/video/"];
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
      if (!["quiz","bank","flashcard","written","osce","library","video"].includes(ct)) return json({ error: "Invalid content type" }, 400, origin, log);
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
      if (!body.contentType || !["quiz","bank","flashcard","written","osce","library","video"].includes(body.contentType)) return json({ error: "Invalid content type" }, 400, origin, log);
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
            if (Array.isArray(j.questions)) contentType = "quiz";
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
      if (!contentType || !["quiz","bank","flashcard","written","osce","library","video"].includes(contentType)) {
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

      // ── Public content manifests (R2-backed) ──
      if (request.method === "GET" && url.pathname.startsWith("/v1/content-manifests/")) {
        let manifestPath = url.pathname.slice("/v1/content-manifests/".length).replace(/\/{2,}/g, "/");
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        // Only the known category manifests are public — never let a path
        // escape the content-manifests keyspace or reach non-manifest keys.
        // Decode first so encoded traversal can't slip past the ".." check.
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
          "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
          ...cors(origin),
          ...SECURITY_HEADERS,
          "cross-origin-resource-policy": "cross-origin",
        };
        return new Response(obj.body, { status: 200, headers: manifestHeaders as any });
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
        return json(await issueSession(user, env), 200, origin, log);
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
          await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(userId, username, email, displayName, password.hash, password.salt, now(), now()).run();
        } catch { return json({ error: "That username or email is already in use" }, 409, origin, log); }
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<any>();
        return json(await issueSession(user, env), 201, origin, log);
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
        return json(await issueSession(user, env), 200, origin, log);
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
          if (user && env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_ORIGIN) {
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
              await sendEmail(env, { to: user.email, subject: "Reset your Osler password", text, html });
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
        if (user && env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_ORIGIN) {
          const existing = await env.DB.prepare("SELECT id FROM email_verify_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at > ?").bind(user.id, now()).first<any>();
          if (!existing) {
            const token = `${id()}${id()}`; const expiresAt = now() + RESET_TTL_MS;
            await env.DB.prepare("INSERT INTO email_verify_tokens (id, user_id, token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id(), user.id, await sha256(token), email, expiresAt, now()).run();
            const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/?verify=${encodeURIComponent(token)}`;
            try {
              const { html, text } = verifyEmail(link);
              await sendEmail(env, { to: user.email, subject: "Verify your Osler email address", text, html });
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

      // ── Biometric (M1) ──
      if (url.pathname.startsWith("/v1/biometric")) {
        if (request.method === "GET" && url.pathname === "/v1/biometric/register") {
          const session = await requireUser(request, env);
          if (!session) return json({ error: "Authentication required" }, 401, origin, log);
          if (!rateLimit(ip, "biometric")) return json({ error: "Too many requests" }, 429, origin, log);
          return handleBiometricRegister(request, env, session, log);
        }
        if (request.method === "POST" && url.pathname === "/v1/biometric/register-complete") {
          const session = await requireUser(request, env);
          if (!session) return json({ error: "Authentication required" }, 401, origin, log);
          if (!rateLimit(ip, "biometric")) return json({ error: "Too many requests" }, 429, origin, log);
          return handleBiometricRegisterComplete(request, env, session, log);
        }
        if (request.method === "POST" && url.pathname === "/v1/biometric/authenticate") {
          if (!rateLimit(ip, "biometric")) return json({ error: "Too many requests" }, 429, origin, log);
          const session = await requireUser(request, env).catch(() => null);
          return handleBiometricAuthenticate(request, env, session, log);
        }
        if (request.method === "POST" && url.pathname === "/v1/biometric/authenticate-complete") {
          if (!rateLimit(ip, "biometric")) return json({ error: "Too many requests" }, 429, origin, log);
          const session = await requireUser(request, env).catch(() => null);
          return handleBiometricAuthenticateComplete(request, env, session, log);
        }
        if (request.method === "GET" && url.pathname === "/v1/biometric/credentials") {
          const session = await requireUser(request, env);
          if (!session) return json({ error: "Authentication required" }, 401, origin, log);
          return handleBiometricCredentials(request, env, session, log);
        }
        const bmDel = url.pathname.match(/^\/v1\/biometric\/credentials\/([^/]+)$/);
        if (bmDel && request.method === "DELETE") {
          const session = await requireUser(request, env);
          if (!session) return json({ error: "Authentication required" }, 401, origin, log);
          return handleBiometricDelete(request, env, session, log, url);
        }
        return json({ error: "Not found" }, 404, origin, log);
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
      // Returns a branded SVG social card for use as og:image on shared links.
      // Public, no auth, safe for open sharing.
      if (request.method === "GET" && url.pathname === "/og") {
        const title = (url.searchParams.get("title") || "Osler").slice(0, 100);
        const sub = (url.searchParams.get("sub") || "").slice(0, 80);
        const type = url.searchParams.get("type") || "quiz";
        const site = (url.searchParams.get("site") || "Osler").slice(0, 40);

        const esc = (s: string) => s.replace(/[<>&"]/g, (c: string) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));

        const ENGINE: Record<string, { bg: string; border: string; text: string; label: string }> = {
          quiz:      { bg: "#1e293b", border: "#3b82f6", text: "#93c5fd", label: "Quiz" },
          bank:      { bg: "#1e293b", border: "#2563eb", text: "#93c5fd", label: "Question Bank" },
          flashcard: { bg: "#1e293b", border: "#16a34a", text: "#86efac", label: "Flashcards" },
          osce:      { bg: "#1e293b", border: "#dc2626", text: "#fca5a5", label: "OSCE Station" },
          library:   { bg: "#1e293b", border: "#7c3aed", text: "#d8b4fe", label: "Clinical Library" },
          video:     { bg: "#1e293b", border: "#0891b2", text: "#67e8f9", label: "Video Lesson" },
          written:   { bg: "#1e293b", border: "#d97706", text: "#fcd34d", label: "Written Cases" },
        };
        const meta = ENGINE[type] || ENGINE.quiz;

        // Truncate title to ~40 chars to fit within the card
        const displayTitle = title.length > 42 ? title.slice(0, 40) + "…" : title;
        const displaySub = sub.length > 60 ? sub.slice(0, 58) + "…" : sub;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="50%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
    <linearGradient id="ac" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#93c5fd"/><stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g opacity="0.04" stroke="#fff" stroke-width="1">
    <line x1="0" y1="105" x2="1200" y2="105"/><line x1="0" y1="210" x2="1200" y2="210"/>
    <line x1="0" y1="315" x2="1200" y2="315"/><line x1="0" y1="420" x2="1200" y2="420"/>
    <line x1="0" y1="525" x2="1200" y2="525"/>
    <line x1="200" y1="0" x2="200" y2="630"/><line x1="400" y1="0" x2="400" y2="630"/>
    <line x1="600" y1="0" x2="600" y2="630"/><line x1="800" y1="0" x2="800" y2="630"/>
    <line x1="1000" y1="0" x2="1000" y2="630"/>
  </g>
  <!-- Logo mark -->
  <g transform="translate(120,105)">
    <rect x="0" y="0" width="70" height="70" rx="18" fill="#1e3a8a" stroke="#3b82f6" stroke-width="2"/>
    <path d="M12 35 L22 35 L28 20 L35 50 L42 27 L49 35 L58 35" stroke="url(#ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
  <text x="210" y="150" font-family="system-ui,-apple-system,sans-serif" font-size="32" font-weight="800" fill="#ffffff">${esc(site)}</text>
  <!-- Engine badge -->
  <g transform="translate(120,210)">
    <rect x="0" y="0" width="168" height="38" rx="19" fill="${meta.bg}" stroke="${meta.border}" stroke-width="1.5"/>
    <text x="84" y="24" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="${meta.text}" text-anchor="middle">${esc(meta.label)}</text>
  </g>
  <!-- Main title -->
  <text x="120" y="330" font-family="system-ui,-apple-system,sans-serif" font-size="56" font-weight="800" fill="#f8fafc" letter-spacing="-0.02em">${esc(displayTitle)}</text>
  ${displaySub ? `<text x="120" y="395" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="400" fill="#94a3b8">${esc(displaySub)}</text>` : ""}
  <!-- Footer -->
  <line x1="120" y1="520" x2="1080" y2="520" stroke="#334155" stroke-width="1"/>
  <text x="120" y="560" font-family="system-ui,sans-serif" font-size="16" font-weight="500" fill="#64748b">Adaptive Medical Study · Offline Ready · Open Source</text>
</svg>`;

        return new Response(svg, {
          status: 200,
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400",
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
        });
      }

      // ── From here on: authenticated routes ──
      const session = await requireUser(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, origin, log);

      // Admin namespace
      if (url.pathname.startsWith("/v1/admin")) {
        if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
        const adminResponse = await handleAdmin(request, env, session, url, origin, log);
        if (adminResponse) return adminResponse;
        return json({ error: "Not found" }, 404, origin, log);
      }

      // ── Account routes ──
      if (request.method === "GET" && url.pathname === "/v1/auth/me") return json(await accountPayload(env, session.user), 200, origin, log);
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
        return json(await issueSession(await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user.id).first<any>(), env), 200, origin, log);
      }
      if (request.method === "GET" && url.pathname === "/v1/account/export") return json({ account: await accountPayload(env, session.user), progress: await getAllDocuments(env, session.user.id), exportedAt: now() }, 200, origin, log);
      if (request.method === "DELETE" && url.pathname === "/v1/account") {
        const body = await readJson(request);
        if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm account deletion" }, 400, origin, log);
        if (Number(session.user.has_password ?? 1) === 1 && !await passwordMatches(String(body.password || ""), session.user.password_salt, session.user.password_hash)) return json({ error: "Current password is incorrect" }, 401, origin, log);
        await env.DB.batch([
          env.DB.prepare("PRAGMA foreign_keys = ON;"),
          env.DB.prepare("DELETE FROM progress_documents WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM auth_identities WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM auth_handoffs WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(session.user.id),
        ]);
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
        const isHead = url.searchParams.get("head") === "true" || url.searchParams.get("head") === "1";
        if (isHead) {
          const { timestamps, usedBytes } = await getSyncHead(env, session.user.id);
          return json({ timestamps, quota: { usedBytes, limitBytes: MAX_USER_STORAGE_BYTES } }, 200, origin, log);
        }
        const requestedKinds = url.searchParams.get("kinds")?.split(",").map(k => k.trim()).filter(Boolean);
        const docs = requestedKinds && requestedKinds.length > 0
          ? await getSelectedDocuments(env, session.user.id, requestedKinds)
          : await getAllDocuments(env, session.user.id);
        const sizeRow = await env.DB.prepare("SELECT COALESCE(SUM(raw_bytes),0) as total FROM progress_documents WHERE user_id = ?").bind(session.user.id).first<{ total: number }>();
        return json({ ...docs, quota: { usedBytes: Number(sizeRow?.total ?? 0), limitBytes: MAX_USER_STORAGE_BYTES } }, 200, origin, log);
      }
      if (request.method === "PUT" && url.pathname === "/v1/sync") {
        if (!rateLimit(ip, "sync")) return json({ error: "Too many requests" }, 429, origin, log);
        const body = await readJsonBody(request, MAX_GZIP_BODY_BYTES); const statements: any[] = []; const response: Record<string, any> = {};
        const bodyKinds = new Set<string>();
        for (const kind of SYNC_KINDS) if (body[kind] && typeof body[kind] === "object") bodyKinds.add(kind);
        const kindsToSync = SYNC_KINDS.filter((kind) => bodyKinds.has(kind));
        // Fetch the storage budget and every in-flight document in parallel —
        // previously each kind's doc was awaited sequentially inside the loop,
        // stretching a multi-kind push to N round-trips.
        const [sizeRows, ...currentDocs] = await Promise.all([
          env.DB.prepare("SELECT kind, raw_bytes FROM progress_documents WHERE user_id = ?").bind(session.user.id).all<{ kind: string; raw_bytes: number }>(),
          ...kindsToSync.map((kind) => getDocument(env, session.user.id, kind)),
        ]);
        const currentByKind = new Map<string, { records: Record<string, any>; updatedAt: number }>();
        kindsToSync.forEach((kind, i) => { currentByKind.set(kind, currentDocs[i]); });
        // Per-user storage budget: start from the raw bytes of stored docs NOT
        // being rewritten in this request, then add each merged doc's size.
        let projectedBytes = (sizeRows.results || []).reduce((sum, row) => {
          const kind = row?.kind ?? "";
          return sum + (bodyKinds.has(kind) ? 0 : (Number(row?.raw_bytes) || 0));
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
          if (projectedBytes > MAX_USER_STORAGE_BYTES) return json({ error: "Sync storage limit exceeded (15MB per user). Remove old progress to free space.", limit: MAX_USER_STORAGE_BYTES }, 413, origin, log);
          const updatedAt = now(); response[kind] = { records: merged.records, updatedAt };
          // Store gzip-compressed to save D1 space (~5-8x) and support far more
          // progress per user; raw_bytes tracks the uncompressed JSON so the
          // per-user budget is enforced on real content, not compressed size.
          statements.push(env.DB.prepare("INSERT INTO progress_documents (user_id, kind, payload, compressed, raw_bytes, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET payload = excluded.payload, compressed = 1, raw_bytes = excluded.raw_bytes, updated_at = excluded.updated_at").bind(session.user.id, kind, compressedB64, mergedBytes, updatedAt));
        }
        if (statements.length) await env.DB.batch(statements);
        return json(response, 200, origin, log);
      }

      return json({ error: "Not found" }, 404, origin, log);
    } catch (error: any) {
      console.error("Unhandled error:", error);
      return json({ error: "Internal server error" }, 500, origin, log);
    }
  },
};
