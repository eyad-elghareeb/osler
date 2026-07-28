// Osler Cloud Worker — TypeScript
// ---------------------------------------------------------------------------
// Plan: implement Sprint 3 (M6→M3→M1→M7→M8) and Sprint 4 (Q3→Q4→Q1→Q2→Q5→Q6)
// from sprint-3-4-plan.md. Sequence: Q3 (validation), Q4 (logging), Q1 (TS),
// Q5 (CORS), Q6 (CSP), M6 (audit HMAC), M3 (scheduling), M1 (biometric),
// M7 (webhooks), M8 (search). No restructuring — patch in place.
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
const PASSWORD_ITERATIONS = 310_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 900_000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_BUCKETS = new Map<string, { count: number; expiresAt: number }>();
const RATE_LIMIT_MAX: Record<string, number> = {
  "auth:login": 12,
  "auth:register": 6,
  "auth:reset": 6,
  "auth:google:consume": 12,
  "biometric": 6,
  "ip:global": 240,
  "content": 240,
  "admin": 60,
  "sync": 30,
  "search": 30,
};

const MAX_SESSIONS_PER_USER = 12;
const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

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

async function readJson(request: Request): Promise<any> {
  const text = await request.text();
  if (text.length > 1_000_000) throw new Error("Request body is too large");
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
    "access-control-allow-headers": "authorization, content-type",
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
  const ipKey = "ip:global";
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
  if (RATE_LIMIT_BUCKETS.size > 2000) {
    const keys = [...RATE_LIMIT_BUCKETS.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (let i = 0; i < 100 && i < keys.length; i += 1) RATE_LIMIT_BUCKETS.delete(keys[i][0]);
  }
  return entry.count <= (RATE_LIMIT_MAX[bucket] ?? 60);
}

// ─── Turnstile ───────────────────────────────────────────────────────────────

async function verifyTurnstile(token: string | undefined, request: Request, env: Env): Promise<boolean> {
  if (env.TURNSTILE_ENABLED !== "true") return true;
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const fb = new FormData();
  fb.set("secret", env.TURNSTILE_SECRET_KEY);
  fb.set("response", token);
  const rip = request.headers.get("CF-Connecting-IP");
  if (rip) fb.set("remoteip", rip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fb });
  return result.ok && ((await result.json()) as { success: boolean }).success === true;
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
  if (!payload || !signature || signature !== await hmac(payload, env.JWT_SECRET)) return null;
  let claims: any;
  try { claims = JSON.parse(decoder.decode(unb64url(payload))); } catch { return null; }
  if (!claims?.sub || !claims?.sid || Number(claims.exp) * 1000 <= now()) return null;
  const row = await env.DB.prepare("SELECT s.id as _sid, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?")
    .bind(claims.sid, await sha256(token), now()).first<Record<string, unknown>>();
  if (!row) return null;
  const { _sid, ...userFields } = row;
  return { sessionId: claims.sid, user: userFields as unknown as UserRow };
}

// ─── Sync merging ────────────────────────────────────────────────────────────

function mergeQbank(remote: Record<string, any>, local: Record<string, any>): Record<string, any> {
  const out = { ...remote };
  for (const [key, value] of Object.entries(local || {})) {
    if (!value || typeof value !== "object") continue;
    if (!out[key] || Number(value.timestamp || 0) >= Number(out[key]?.timestamp || 0)) out[key] = value;
  }
  return out;
}

function mergeFlashcards(remote: Record<string, any>, local: Record<string, any>): Record<string, any> {
  const out = { ...remote };
  for (const [key, value] of Object.entries(local || {})) {
    if (!value || typeof value !== "object") continue;
    if (!out[key] || Number(value.lastReviewed || 0) >= Number(out[key]?.lastReviewed || 0)) out[key] = value;
  }
  return out;
}

async function getDocument(env: Env, userId: string, kind: string): Promise<{ records: Record<string, any>; updatedAt: number }> {
  const row = await env.DB.prepare("SELECT payload, updated_at FROM progress_documents WHERE user_id = ? AND kind = ?").bind(userId, kind).first<{ payload: string; updated_at: number }>();
  if (!row) return { records: {}, updatedAt: 0 };
  try { return { records: JSON.parse(row.payload), updatedAt: row.updated_at }; } catch { return { records: {}, updatedAt: 0 }; }
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

async function googleUser(env: Env, claims: any): Promise<UserRow> {
  const existingIdentity = await env.DB.prepare("SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'google' AND i.provider_subject = ?").bind(claims.sub).first<UserRow>();
  if (existingIdentity) return existingIdentity;
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(claims.email.toLowerCase()).first<UserRow>();
  if (!user) {
    const generatedPassword = await passwordHash(`${id()}${id()}`);
    const userId = id();
    await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
      .bind(userId, await availableGoogleUsername(env, claims.email), claims.email.toLowerCase(), String(claims.name || claims.email.split("@")[0]).slice(0, 80), generatedPassword.hash, generatedPassword.salt, now(), now()).run();
    user = (await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>())!;
  }
  await env.DB.prepare("INSERT INTO auth_identities (provider, provider_subject, user_id, provider_email, created_at) VALUES ('google', ?, ?, ?, ?)")
    .bind(claims.sub, user.id, claims.email.toLowerCase(), now()).run();
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
    const prev = await env.DB.prepare("SELECT row_hash FROM admin_audit ORDER BY created_at DESC LIMIT 1").first<{ row_hash: string }>();
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
  const rows = await env.DB.prepare("SELECT id, action, target_id, detail, prev_hash, row_hash, created_at FROM admin_audit ORDER BY created_at ASC").all<any>();
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
    await env.DB.batch([
      env.DB.prepare("PRAGMA foreign_keys = ON;"),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM auth_handoffs WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM email_verify_tokens WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").bind(now()),
      env.DB.prepare("DELETE FROM admin_audit WHERE created_at < ?").bind(cutoff),
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

const CONTENT_TYPE_TO_CATEGORY: Record<string, string> = {
  quiz: "qbank", bank: "qbank", written: "qbank",
  flashcard: "flashcard", osce: "osce",
  library: "library", video: "videos",
};

async function hybridPublish(env: Env, obj: any, body: string, targetPath?: string | null): Promise<string[]> {
  if (!env.CONTENT) return [];
  const category = CONTENT_TYPE_TO_CATEGORY[obj.content_type] ?? obj.content_type;
  const safePath = (targetPath || "").replace(/^\/+|\/+$/g, "");
  let fileSegment: string;
  if (safePath && /\.[a-z0-9]+$/i.test(safePath)) {
    fileSegment = safePath;
  } else if (safePath) {
    fileSegment = safePath + (obj.content_type === "library" ? "/index.md" : "/content.json");
  } else {
    const tail = obj.r2_key_base.split("/").pop();
    fileSegment = obj.content_type === "library" ? `${tail}.md` : `${tail}.json`;
  }
  const r2Key = `content-files/${category}/${fileSegment}`;
  const ct = obj.content_type === "library" ? "text/markdown" : "application/json";
  await env.CONTENT.put(r2Key, body, { httpMetadata: { contentType: ct } });
  try {
    await regenerateManifestForCategory(env, category);
  } catch (e) {
    console.error("manifest regen failed:", e);
  }
  return [r2Key];
}

const ASSET_FOLDERS = new Set(["images", "assets"]);
const CATEGORY_TYPE_MAP: Record<string, string | null> = { qbank: null, flashcard: "flashcard", osce: "osce", library: "library", videos: "video" };
const FILE_TYPE_KEYS: Record<string, string> = { questions: "quiz", passages: "bank", prompts: "written", cards: "flashcard", videos: "video", stations: "osce" };

function inferTypeFromFileName(files: string[]): string | null {
  for (const f of files) {
    const base = f.replace(/\.[^.]+$/, "");
    if (FILE_TYPE_KEYS[base]) return FILE_TYPE_KEYS[base];
  }
  return null;
}

function sanitizeSeg(s: string): string { return s.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || s; }
function buildUid(type: string, segments: string[]): string { return [type, ...segments.map(sanitizeSeg)].filter(Boolean).join("-"); }

async function regenerateManifestForCategory(env: Env, category: string): Promise<any> {
  if (!env.CONTENT) return null;
  const prefix = `content-files/${category}/`;
  const listed = await env.CONTENT.list({ prefix, limit: 1000 });
  if (!listed || !listed.objects) return null;
  const keys = listed.objects.map((o: any) => o.key);
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
      if (file.toLowerCase().endsWith(".json") || file.toLowerCase().endsWith(".md") || file.toLowerCase().endsWith(".html") || file.toLowerCase().endsWith(".pdf")) {
        f.files.push(file);
      } else if (file.match(/\.(png|jpe?g|gif|svg|webp|avif|bmp|mp3|m4a|mp4)$/i)) {
        f.images.push(file);
      }
    }
  }
  for (const path of [...folders.keys()]) {
    const seg = path.split("/").pop();
    if (seg && ASSET_FOLDERS.has(seg)) folders.delete(path);
  }
  const parentType = CATEGORY_TYPE_MAP[category] || null;
  const nodes = new Map<string, any>();
  for (const [fp, info] of folders.entries()) {
    const inferredType = parentType || inferTypeFromFileName(info.files) || "quiz";
    const segments = fp ? fp.split("/") : [];
    const uid = buildUid(inferredType, [category, ...segments]);
    nodes.set(fp, {
      uid,
      title: fp ? fp.split("/").pop()!.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : category,
      type: inferredType,
      path: fp ? `${fp}/` : "",
      files: info.files,
      images: info.images,
      items: [],
    });
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
  const manifest = {
    type: parentType || (roots.length > 0 ? roots[0].type : "quiz"),
    items: roots.sort((a, b) => a.title.localeCompare(b.title)),
  };
  await env.CONTENT.put(`content-manifests/${category}/manifest.json`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return manifest;
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
  await env.DB.prepare("INSERT INTO biometric_credentials (id, user_id, credential_id, credential_data_json, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id(), session.user.id, rawId, JSON.stringify({ clientDataJSON, attestationObject, rawId }), typeof body.deviceName === "string" ? body.deviceName.trim().slice(0, 100) : "Unknown device", now()).run();
  return json({ ok: true }, 200, "", log);
}

async function handleBiometricAuthenticate(request: Request, env: Env, _session: Session | null, log: Logger): Promise<Response> {
  let uid: string | null = null;
  if (_session) uid = _session.user.id;
  if (!uid) {
    const body = await readJson(request);
    uid = typeof body.userId === "string" ? body.userId.trim() : null;
    if (!uid) return json({ error: "userId required" }, 400, "", log);
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(uid).first();
    if (!user) return json({ error: "User not found" }, 404, "", log);
  }
  const creds = await env.DB.prepare("SELECT * FROM biometric_credentials WHERE user_id = ?").bind(uid).all<any>();
  if (!creds.results?.length) return json({ error: "No biometric credentials registered" }, 400, "", log);
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

  const allowed = await env.DB.prepare("SELECT id, user_id, credential_id FROM biometric_credentials WHERE user_id = ?").bind(bs.user_id).all<any>();
  if (!allowed.results?.length) return json({ error: "No credentials found" }, 400, "", log);
  const matched = allowed.results.find((c: any) => c.credential_id === rawId);
  if (!matched) return json({ error: "Credential not found" }, 400, "", log);

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
  if (types.includes("content")) {
    const rows = await env.DB.prepare("SELECT id as uid, title, content_type as type, status, updated_at FROM content_objects WHERE title LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 20").bind(like, like).all();
    results.content = rows.results || [];
  }
  if (types.includes("users")) {
    const rows = await env.DB.prepare("SELECT id, username, display_name, role, created_at FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 20").bind(like, like, like).all();
    results.users = rows.results || [];
  }
  if (types.includes("audit")) {
    const rows = await env.DB.prepare("SELECT a.id, a.action, a.target_id, a.created_at, u.username as actor_username FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action LIKE ? ESCAPE '\\' OR a.target_id LIKE ? ESCAPE '\\' ORDER BY a.created_at DESC LIMIT 20").bind(like, like).all();
    results.audit = rows.results || [];
  }
  return json(results, 200, "", log);
}
/* ── Admin handler ── */
async function handleAdmin(request: Request, env: Env, session: Session, url: URL, origin: string, log: Logger): Promise<Response | null> {
  const path = url.pathname;

  /* ── Identity ── */
  if (request.method === "GET" && path === "/v1/admin/me") {
    return json({ user: adminPublicUser(session.user), capabilities: {
      manageUsers: isAdmin(session), manageContent: isAdminOrContent(session),
      approveContent: isAdmin(session), publishDirect: isAdmin(session),
      viewStats: isAdmin(session), viewAudit: isAdmin(session), manageSessions: isAdmin(session),
    }}, 200, origin, log);
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
      const [qbankDoc, flashcardDoc] = await Promise.all([
        getDocument(env, targetId, "qbank"), getDocument(env, targetId, "flashcards"),
      ]);
      return json({ qbank: { recordCount: Object.keys(qbankDoc.records).length, updatedAt: qbankDoc.updatedAt }, flashcards: { recordCount: Object.keys(flashcardDoc.records).length, updatedAt: flashcardDoc.updatedAt } }, 200, origin, log);
    }
    const userIdMatch = path.match(/^\/v1\/admin\/users\/([^/]+)$/);
    const resetPasswordMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/reset-password$/);
    const geminiKeyMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/gemini-key$/);
    if (userIdMatch) {
      const targetId = userIdMatch[1];
      if (request.method === "GET") {
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first<any>();
        if (!user) return json({ error: "User not found" }, 404, origin, log);
        const [sessions, content] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?").bind(targetId, now()).first(),
          env.DB.prepare("SELECT id, title, status, content_type, updated_at FROM content_objects WHERE created_by = ? ORDER BY updated_at DESC LIMIT 25").bind(targetId).all(),
        ]);
        return json({ ...adminPublicUser(user), hasPassword: !!user.has_password, hasGeminiKey: !!user.gemini_api_key, activeSessionCount: (sessions as any)?.n ?? 0, content: (content.results || []).map((c: any) => ({ id: c.id, title: c.title, status: c.status, contentType: c.content_type, updatedAt: c.updated_at })) }, 200, origin, log);
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
  }

  /* ── Content ── */
  if (path.startsWith("/v1/admin/content")) {
    if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
    if (request.method === "POST" && path === "/v1/admin/content/upload-file") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const key = typeof body.key === "string" ? body.key.trim() : "";
      const raw = typeof body.body === "string" ? body.body : "";
      if (!key || !raw) return json({ error: "key and body required" }, 400, origin, log);
      if (key.length > 1024) return json({ error: "key too long" }, 400, origin, log);
      const ext = key.split(".").pop()?.toLowerCase() ?? "";
      let content: any; let ct: string;
      if (raw.startsWith("data:")) {
        const b64 = raw.split(",")[1] ?? "";
        content = Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0));
        ct = raw.slice(5, raw.indexOf(";")) || "application/octet-stream";
      } else { content = raw; ct = ext === "json" ? "application/json" : ext === "md" ? "text/markdown; charset=utf-8" : ext === "html" || ext === "htm" ? "text/html; charset=utf-8" : ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : ext === "pdf" ? "application/pdf" : "application/octet-stream"; }
      await env.CONTENT.put(key, content, { httpMetadata: { contentType: ct } });
      return json({ ok: true, key }, 200, origin, log);
    }
    if (request.method === "GET" && path === "/v1/admin/content/r2-keys") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const category = (url.searchParams.get("prefix") || "").trim();
      const listed = await env.CONTENT.list({ prefix: "content-files/" + category, limit: 1000, cursor: url.searchParams.get("cursor") || undefined });
      return json({ items: (listed.objects || []).map((o: any) => ({ key: o.key, size: o.size, uploaded: o.uploaded?.toISOString?.() ?? null })), cursor: listed.truncated ? listed.cursor : null }, 200, origin, log);
    }
    if (request.method === "DELETE" && path === "/v1/admin/content/r2-key") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const key = (url.searchParams.get("key") || "").trim();
      if (!key) return json({ error: "key required" }, 400, origin, log);
      if (!key.startsWith("content-files/") && !key.startsWith("content-manifests/")) return json({ error: "Only content-files/ and content-manifests/ keys" }, 400, origin, log);
      await env.CONTENT.delete(key);
      await auditLog(env, session.user.id, "delete_r2_key", null, { key }, log);
      return json({ ok: true }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/r2-rename") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const from = typeof body.from === "string" ? body.from.trim() : "";
      const to = typeof body.to === "string" ? body.to.trim() : "";
      if (!from || !to) return json({ error: "from and to required" }, 400, origin, log);
      if (!from.startsWith("content-files/") || !to.startsWith("content-files/")) return json({ error: "Only content-files/ keys" }, 400, origin, log);
      const src = await env.CONTENT.get(from);
      if (!src) return json({ error: "Source key not found" }, 404, origin, log);
      const buf = await src.arrayBuffer();
      const ct2 = from.endsWith(".json") ? "application/json" : from.endsWith(".md") ? "text/markdown" : "application/octet-stream";
      await env.CONTENT.put(to, buf, { httpMetadata: { contentType: ct2 } });
      await env.CONTENT.delete(from);
      await auditLog(env, session.user.id, "rename_r2_key", null, { from, to }, log);
      return json({ ok: true, from, to }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/r2-folder") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const pathArg = typeof body.path === "string" ? body.path.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!pathArg || !pathArg.startsWith("content-files/")) return json({ error: "path must start with content-files/" }, 400, origin, log);
      await env.CONTENT.put(pathArg + "/.keep", "", { httpMetadata: { contentType: "text/plain" } });
      await auditLog(env, session.user.id, "create_r2_folder", null, { path: pathArg }, log);
      return json({ ok: true, key: pathArg + "/.keep" }, 200, origin, log);
    }
    if (request.method === "POST" && path === "/v1/admin/content/regenerate-manifest") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
      const body = await readJson(request);
      const cat = typeof body.category === "string" ? body.category.trim() : "";
      if (!cat) return json({ error: "category required" }, 400, origin, log);
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
      await r2Put(env, r2Draft(r2Base), body.content || JSON.stringify({ title: title || "Untitled" }, null, 2));
      await env.DB.prepare("INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)").bind(objectId, r2Base, body.contentType, title, body.language || "en", session.user.id, now(), now()).run();
      await auditLog(env, session.user.id, "create_content", objectId, { title, contentType: body.contentType }, log);
      return json({ id: objectId, r2KeyBase: r2Base, status: "draft" }, 201, origin, log);
    }
    const cim = path.match(/^\/v1\/admin\/content\/([^/]+)(\/(.+))?$/);
    if (cim) {
      const objectId = cim[1]; const action = cim[3] || null;
      if (["pending","upload-file","r2-keys","r2-key","r2-rename","r2-folder","regenerate-manifest","validate"].includes(objectId)) return json({ error: "Not found" }, 404, origin, log);
      const obj = await env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(objectId).first<any>();
      if (!obj) return json({ error: "Content not found" }, 404, origin, log);
      if (!isAdmin(session) && obj.created_by !== session.user.id && obj.status !== "published") return json({ error: "Forbidden" }, 403, origin, log);

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
        try { const b: any = await request.clone().json(); if (typeof b.targetPath === "string") targetPath = b.targetPath.trim(); if (b.hybrid === false) doHybrid = false; } catch {}
        const hybridKeys = doHybrid ? await hybridPublish(env, obj, draft, targetPath) : [];
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
        try { const b: any = await request.clone().json(); if (typeof b.targetPath === "string") targetPath = b.targetPath.trim(); } catch {}
        const hybridKeys = await hybridPublish(env, obj, pending, targetPath);
        await env.DB.prepare("UPDATE content_objects SET status = 'published', reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?").bind(session.user.id, now(), now(), objectId).run();
        await auditLog(env, session.user.id, "approve", objectId, { title: obj.title, hybridKeys }, log);
        return json({ ok: true, status: "published", hybridKeys }, 200, origin, log);
      }
      if (request.method === "POST" && action === "validate") {
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
        await env.DB.prepare("UPDATE content_objects SET status = 'draft', updated_at = ? WHERE id = ?").bind(now(), objectId).run();
        await auditLog(env, session.user.id, "unpublish", objectId, { title: obj.title }, log);
        return json({ ok: true, status: "draft" }, 200, origin, log);
      }
      if (request.method === "DELETE" && !action) {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
        await Promise.all([r2Delete(env, r2Draft(obj.r2_key_base)), r2Delete(env, r2Pending(obj.r2_key_base)), r2Delete(env, r2Published(obj.r2_key_base))]);
        await env.DB.prepare("DELETE FROM content_objects WHERE id = ?").bind(objectId).run();
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
      try { JSON.parse(body.events); } catch { return json({ error: "events must be a JSON array string" }, 400, origin, log); }
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

  /* ── Config ── */
  if (path === "/v1/admin/config") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin, log);
    if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
    if (request.method === "GET") {
      const obj = await env.CONTENT.get("_osler.config.json");
      if (!obj) return json({ site: { name: "Osler", shortName: "Osler", tagline: "Your medical companion", githubRepo: "", organisation: "", supportEmail: "" }, engines: {}, themes: { default: "light", custom: [] }, defaults: { view: "dashboard", language: { ui: "en", content: "all" }, quiz: { count: 10, secPerQuestion: 90, tutor: false, shuffle: true }, ai: { model: "gemini-2.5-flash", enabled: true, temperature: 0.7 }, sync: { method: "webrtc", room: "" } }, wizard: { completed: false } }, 200, origin, log);
      const text = await obj.text();
      try { JSON.parse(text); } catch { return json({ error: "Corrupt config" }, 500, origin, log); }
      return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...cors(origin), ...SECURITY_HEADERS, "x-request-id": log.requestId } as any });
    }
    if (request.method === "PUT") {
      const body = await readJson(request);
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

      // ── Public content serving (R2-backed, rate-limited: 240 req/min per IP) ──
      if (request.method === "GET" && url.pathname.startsWith("/v1/content/")) {
        if (!rateLimit(ip, "content")) return json({ error: "Too many requests" }, 429, origin, log);
        const contentPath = url.pathname.slice("/v1/content/".length).replace(/\/{2,}/g, "/");
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        const r2Key = `content-files/${contentPath}`;
        const obj = await env.CONTENT.get(r2Key);
        if (!obj) return json({ error: "Not found" }, 404, origin, log);
        const ext = contentPath.split(".").pop()?.toLowerCase() ?? "";
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
        const cacheable = ext !== "json" && ext !== "md";
        return new Response(obj.body, {
          status: 200,
          headers: { "content-type": contentType, "cache-control": cacheable ? "public, max-age=86400, immutable" : "public, max-age=60", ...cors(origin), ...SECURITY_HEADERS } as any,
        });
      }

      // ── Public content manifests (R2-backed) ──
      if (request.method === "GET" && url.pathname.startsWith("/v1/content-manifests/")) {
        const manifestPath = url.pathname.slice("/v1/content-manifests/".length).replace(/\/{2,}/g, "/");
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin, log);
        const r2Key = `content-manifests/${manifestPath}`;
        const obj = await env.CONTENT.get(r2Key);
        if (!obj) return json({ error: "Not found" }, 404, origin, log);
        return new Response(obj.body, {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "public, max-age=60", ...cors(origin), ...SECURITY_HEADERS } as any,
        });
      }

      // ── Google OAuth ──
      if (request.method === "GET" && url.pathname === "/v1/auth/google/start") {
        if (!googleReady(env)) return json({ error: "Google sign-in is not configured" }, 503, origin, log);
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
        const ticket = await createAuthHandoff(env, user.id);
        return Response.redirect(`${authState.return_to.replace(/\/$/, "")}/?cloudAuth=${encodeURIComponent(ticket)}`, 302);
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
        if (!await verifyTurnstile(body.turnstileToken, request, env)) return json({ error: "Verification failed" }, 400, origin, log);
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
        if (!await verifyTurnstile(body.turnstileToken, request, env)) return json({ error: "Verification failed" }, 400, origin, log);
        const user = await env.DB.prepare("SELECT * FROM users WHERE has_password = 1 AND (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE)").bind(identifier, identifier).first<any>();
        if (!user || !await passwordMatches(body.password, user.password_salt, user.password_hash)) return json({ error: "Invalid username or password" }, 401, origin, log);
        return json(await issueSession(user, env), 200, origin, log);
      }

      // ── Logout ──
      if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
        const session = await requireUser(request, env); if (session) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(now(), session.sessionId).run();
        return json({ ok: true }, 200, origin, log);
      }

      // ── Password reset ──
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/request") {
        if (!rateLimit(ip, "auth:reset")) return json({ error: "Too many reset attempts" }, 429, origin, log);
        const body = await readJson(request); const email = String(body.email || "").trim().toLowerCase();
        if (validEmail(email) && await verifyTurnstile(body.turnstileToken, request, env)) {
          const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(email).first<any>();
          if (user && env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_ORIGIN) {
            const token = `${id()}${id()}`; const expiresAt = now() + RESET_TTL_MS;
            await env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(id(), user.id, await sha256(token), expiresAt, now()).run();
            const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/?reset=${encodeURIComponent(token)}`;
            await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [user.email], subject: "Reset your Osler password", html: `<p>Use this link within 30 minutes to reset your password:</p><p><a href="${link}">${link}</a></p><p>If you did not request a password reset, you can safely ignore this email.</p>` }) });
          }
        }
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/confirm") {
        if (!rateLimit(ip, "auth:reset")) return json({ error: "Too many reset attempts" }, 429, origin, log);
        const body = await readJson(request); if (typeof body.token !== "string" || !validPassword(body.password)) return json({ error: "Invalid reset request" }, 400, origin, log);
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
        const email = String(body.email || "").trim().toLowerCase();
        if (!validEmail(email)) return json({ error: "Invalid email" }, 400, origin, log);
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE AND email_verified_at IS NULL").bind(email).first<any>();
        if (user && env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_ORIGIN) {
          const existing = await env.DB.prepare("SELECT id FROM email_verify_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at > ?").bind(user.id, now()).first<any>();
          if (!existing) {
            const token = `${id()}${id()}`; const expiresAt = now() + RESET_TTL_MS;
            await env.DB.prepare("INSERT INTO email_verify_tokens (id, user_id, token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id(), user.id, await sha256(token), email, expiresAt, now()).run();
            const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/?verify=${encodeURIComponent(token)}`;
            await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [user.email], subject: "Verify your Osler email address", html: `<p>Use this link within 30 minutes to verify your email:</p><p><a href="${link}">${link}</a></p><p>If you did not create an Osler account, you can safely ignore this email.</p>` }) });
          }
        }
        return json({ ok: true }, 200, origin, log);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/verify/confirm") {
        const body = await readJson(request);
        if (typeof body.token !== "string" || !body.token) return json({ error: "Invalid verification request" }, 400, origin, log);
        const row = await env.DB.prepare("SELECT * FROM email_verify_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(body.token), now()).first<any>();
        if (!row) return json({ error: "This verification link is invalid or expired" }, 400, origin, log);
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
        if (!rateLimit(ip, "search")) return json({ error: "Too many requests" }, 429, origin, log);
        return handleSearch(request, env, session, log);
      }

      // ── From here on: authenticated routes ──
      const session = await requireUser(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, origin, log);

      // Admin namespace
      if (url.pathname.startsWith("/v1/admin")) {
        if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin, log);
        if (!rateLimit(ip, "admin")) return json({ error: "Too many requests" }, 429, origin, log);
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
        try { await env.DB.prepare("UPDATE users SET display_name = ?, email = ?, updated_at = ? WHERE id = ?").bind(displayName, email, now(), session.user.id).run(); } catch { return json({ error: "That email is already in use" }, 409, origin, log); }
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
      if (request.method === "GET" && url.pathname === "/v1/account/export") return json({ account: await accountPayload(env, session.user), progress: { qbank: await getDocument(env, session.user.id, "qbank"), flashcards: await getDocument(env, session.user.id, "flashcards") }, exportedAt: now() }, 200, origin, log);
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
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim().slice(0, 200) : null;
        const model = typeof body.model === "string" ? body.model.trim().slice(0, 80) : null;
        const maxWait = Number.isFinite(body.maxWait) ? Math.min(120, Math.max(5, body.maxWait)) : null;
        const storedKey = apiKey ? await encryptField(apiKey, env.GEMINI_ENCRYPTION_KEY) : null;
        await env.DB.prepare("UPDATE users SET gemini_api_key = ?, gemini_model = ?, gemini_max_wait = ?, updated_at = ? WHERE id = ?").bind(storedKey, model, maxWait, now(), session.user.id).run();
        return json({ ok: true, hasKey: !!apiKey }, 200, origin, log);
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
        const model = (typeof body.model === "string" && body.model.trim()) || row.gemini_model || "gemini-2.5-flash";
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
        return json({ qbank: await getDocument(env, session.user.id, "qbank"), flashcards: await getDocument(env, session.user.id, "flashcards") }, 200, origin, log);
      }
      if (request.method === "PUT" && url.pathname === "/v1/sync") {
        if (!rateLimit(ip, "sync")) return json({ error: "Too many requests" }, 429, origin, log);
        const body = await readJson(request); const statements: any[] = []; const response: Record<string, any> = {};
        for (const kind of ["qbank", "flashcards"]) {
          if (!body[kind] || typeof body[kind] !== "object") continue;
          const local = body[kind].records;
          if (!local || typeof local !== "object" || Array.isArray(local)) return json({ error: "Invalid progress document" }, 400, origin, log);
          const current = await getDocument(env, session.user.id, kind);
          const ifUnmodifiedSince = request.headers.get("If-Unmodified-Since");
          if (ifUnmodifiedSince) {
            const since = Number(ifUnmodifiedSince);
            if (!isNaN(since) && current.updatedAt > since) return json({ error: "Conflict: data has been modified since last fetch", conflict: true, serverUpdatedAt: current.updatedAt }, 409, origin, log);
          }
          const records = kind === "qbank" ? mergeQbank(current.records, local) : mergeFlashcards(current.records, local);
          const mergedBytes = new TextEncoder().encode(JSON.stringify(records)).length;
          if (mergedBytes > MAX_DOCUMENT_BYTES) return json({ error: "Progress document is too large after merge" }, 400, origin, log);
          const updatedAt = now(); response[kind] = { records, updatedAt };
          statements.push(env.DB.prepare("INSERT INTO progress_documents (user_id, kind, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").bind(session.user.id, kind, JSON.stringify(records), updatedAt));
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
