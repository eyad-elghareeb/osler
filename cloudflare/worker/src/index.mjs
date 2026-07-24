// Osler Cloud Worker
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
//   * CORS is restricted to a single ALLOWED_ORIGIN. Empty Origin (server-to-
//     server / curl) is treated as the allowed origin so the worker can be
//     tested locally; browsers always send Origin.
//   * Auth endpoints are rate-limited per IP using an in-memory LRU. The
//     scheduled cron job prunes stale sessions, OAuth states, handoffs, reset
//     tokens, and old audit-log entries.
//   * Sensitive responses always include `Cache-Control: no-store`.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 310_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 900_000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;

// Rate-limiting (per-isolate, in-memory LRU). Cloudflare Workers recycle
// isolates so this is best-effort — for hard limits, front the Worker with
// Cloudflare's Rate Limiting Rules in the dashboard. These in-memory buckets
// stop the cheap brute-force scripts from hammering a single isolate.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_BUCKETS = new Map(); // key -> { count, expiresAt }
const RATE_LIMIT_MAX = {
  "auth:login": 12,
  "auth:register": 6,
  "auth:reset": 6,
  "auth:google:consume": 12,
  "ip:global": 240, // hard cap per IP across all rate-limited routes
};

// Cap concurrent sessions per user. Older sessions are revoked when the cap
// is exceeded so users stay signed in on their newest devices.
const MAX_SESSIONS_PER_USER = 12;

// Retain audit log entries for one year, then prune via the cron handler.
const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

let googleKeys = { expiresAt: 0, keys: [] };

// ─── Response helpers ──────────────────────────────────────────────────────

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
};

function securityHeaders(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra };
}

function json(body, status = 200, origin = "", options = {}) {
  const headers = securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": options.cacheControl ?? "no-store",
    ...cors(origin),
  });
  if (options.csp) headers["content-security-policy"] = options.csp;
  return new Response(JSON.stringify(body), { status, headers });
}

function cors(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

const now = () => Date.now();
const id = () => crypto.randomUUID();

const b64url = (bytes) => {
  const arr = new Uint8Array(bytes);
  let str = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    str += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const unb64url = (value) => {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
};

async function sha256(value) { return b64url(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function passwordHash(password, salt = b64url(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64url(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
  return { salt, hash: b64url(bits) };
}

async function passwordMatches(password, salt, expected) {
  const actual = (await passwordHash(password, salt)).hash;
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 1_000_000) throw new Error("Request is too large");
  try { return await request.json(); } catch { throw new Error("Invalid JSON body"); }
}

// ─── Validation ────────────────────────────────────────────────────────────

function validUsername(value) { return typeof value === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(value); }
function validEmail(value) { return !value || (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254); }
function validPassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) return false;
  // Require at least 2 character classes (lowercase, uppercase, digit, symbol).
  // This blocks the most common weak passwords ("password123", "abcabcabc1")
  // while staying forgiving for users with non-Latin keyboards.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  return classes >= 2;
}
function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, email: user.email ?? null };
}

// Escape user-supplied search terms so LIKE wildcards (`%` and `_`) are
// matched literally instead of as glob characters.
function escapeLike(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

// ─── Request origin & rate limiting ────────────────────────────────────────

function requestOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!origin || origin === env.ALLOWED_ORIGIN) return origin || env.ALLOWED_ORIGIN || "";
  return null;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Real-IP")
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "0.0.0.0";
}

function rateLimit(ip, bucket) {
  const ipKey = `ip:global`;
  const bucketKey = `${bucket}:${ip}`;
  const t = now();
  // Global per-IP cap.
  let ipEntry = RATE_LIMIT_BUCKETS.get(ipKey);
  if (!ipEntry || ipEntry.expiresAt < t) ipEntry = { count: 0, expiresAt: t + RATE_LIMIT_WINDOW_MS };
  ipEntry.count += 1;
  RATE_LIMIT_BUCKETS.set(ipKey, ipEntry);
  if (ipEntry.count > RATE_LIMIT_MAX["ip:global"]) return false;
  // Bucket-specific cap.
  let entry = RATE_LIMIT_BUCKETS.get(bucketKey);
  if (!entry || entry.expiresAt < t) entry = { count: 0, expiresAt: t + RATE_LIMIT_WINDOW_MS };
  entry.count += 1;
  RATE_LIMIT_BUCKETS.set(bucketKey, entry);
  // LRU-evict: drop ~100 oldest entries when the map grows past 2000.
  if (RATE_LIMIT_BUCKETS.size > 2000) {
    const keys = [...RATE_LIMIT_BUCKETS.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (let i = 0; i < 100 && i < keys.length; i += 1) RATE_LIMIT_BUCKETS.delete(keys[i][0]);
  }
  return entry.count <= (RATE_LIMIT_MAX[bucket] ?? 60);
}

// ─── Turnstile ─────────────────────────────────────────────────────────────

async function verifyTurnstile(token, request, env) {
  if (env.TURNSTILE_ENABLED !== "true") return true;
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  return result.ok && (await result.json()).success === true;
}

// ─── Session management ────────────────────────────────────────────────────

async function issueSession(user, env) {
  const sessionId = id();
  const expiresAt = now() + SESSION_TTL_MS;
  const payload = b64url(encoder.encode(JSON.stringify({ sub: user.id, sid: sessionId, role: user.role, exp: Math.floor(expiresAt / 1000) })));
  const token = `${payload}.${await hmac(payload, env.JWT_SECRET)}`;
  // Enforce per-user session cap: revoke the oldest active sessions above the cap.
  const activeSessions = await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at ASC").bind(user.id, now()).all();
  const rows = activeSessions.results || [];
  if (rows.length >= MAX_SESSIONS_PER_USER) {
    const toRevoke = rows.slice(0, rows.length - MAX_SESSIONS_PER_USER + 1).map((r) => r.id);
    if (toRevoke.length) {
      await env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE id IN (${toRevoke.map(() => "?").join(",")})`).bind(now(), ...toRevoke).run();
    }
  }
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(sessionId, user.id, await sha256(token), expiresAt, now()).run();
  return { token, expiresAt, user: publicUser(user) };
}

async function requireUser(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !env.JWT_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await hmac(payload, env.JWT_SECRET)) return null;
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(unb64url(payload))); } catch { return null; }
  if (!claims?.sub || !claims?.sid || Number(claims.exp) * 1000 <= now()) return null;
  const session = await env.DB.prepare("SELECT s.id, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?")
    .bind(claims.sid, await sha256(token), now()).first();
  return session ? { sessionId: claims.sid, user: session } : null;
}

// ─── Sync merging ──────────────────────────────────────────────────────────

function mergeQbank(remote, local) {
  const out = { ...remote };
  for (const [key, value] of Object.entries(local || {})) {
    if (!value || typeof value !== "object") continue;
    if (!out[key] || Number(value.timestamp || 0) >= Number(out[key].timestamp || 0)) out[key] = value;
  }
  return out;
}
function mergeFlashcards(remote, local) {
  const out = { ...remote };
  for (const [key, value] of Object.entries(local || {})) {
    if (!value || typeof value !== "object") continue;
    if (!out[key] || Number(value.lastReviewed || 0) >= Number(out[key].lastReviewed || 0)) out[key] = value;
  }
  return out;
}
async function getDocument(env, userId, kind) {
  const row = await env.DB.prepare("SELECT payload, updated_at FROM progress_documents WHERE user_id = ? AND kind = ?").bind(userId, kind).first();
  if (!row) return { records: {}, updatedAt: 0 };
  try { return { records: JSON.parse(row.payload), updatedAt: row.updated_at }; } catch { return { records: {}, updatedAt: 0 }; }
}

// ─── Google OAuth ──────────────────────────────────────────────────────────

function googleReady(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.WORKER_URL);
}

function workerCallback(env) {
  return `${env.WORKER_URL.replace(/\/$/, "")}/v1/auth/google/callback`;
}

async function googleSigningKey(kid) {
  if (googleKeys.expiresAt < now()) {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!response.ok) throw new Error("Could not load Google signing keys");
    const maxAge = response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1];
    googleKeys = { keys: (await response.json()).keys ?? [], expiresAt: now() + Number(maxAge ?? 3600) * 1000 };
  }
  return googleKeys.keys.find((key) => key.kid === kid);
}

async function verifyGoogleIdToken(token, env, nonce) {
  const [encodedHeader, encodedPayload, encodedSignature] = String(token ?? "").split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Invalid Google identity token");
  const header = JSON.parse(new TextDecoder().decode(unb64url(encodedHeader)));
  const claims = JSON.parse(new TextDecoder().decode(unb64url(encodedPayload)));
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

async function availableGoogleUsername(env, email) {
  const seed = (email.split("@")[0].toLowerCase().replace(/[^a-z0-9_.-]/g, "-").replace(/^-+|-+$/g, "") || "google-user").slice(0, 26);
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix ? `${seed.slice(0, 32 - String(suffix).length - 1)}-${suffix}` : seed;
    const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(candidate).first();
    if (!existing) return candidate;
  }
  return `google-${id().slice(0, 8)}`;
}

async function googleUser(env, claims) {
  const existingIdentity = await env.DB.prepare("SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = 'google' AND i.provider_subject = ?").bind(claims.sub).first();
  if (existingIdentity) return existingIdentity;
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(claims.email.toLowerCase()).first();
  if (!user) {
    const generatedPassword = await passwordHash(`${id()}${id()}`);
    const userId = id();
    await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
      .bind(userId, await availableGoogleUsername(env, claims.email), claims.email.toLowerCase(), String(claims.name || claims.email.split("@")[0]).slice(0, 80), generatedPassword.hash, generatedPassword.salt, now(), now()).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  }
  await env.DB.prepare("INSERT INTO auth_identities (provider, provider_subject, user_id, provider_email, created_at) VALUES ('google', ?, ?, ?, ?)")
    .bind(claims.sub, user.id, claims.email.toLowerCase(), now()).run();
  return user;
}

async function createAuthHandoff(env, userId) {
  const ticket = `${id()}${id()}`;
  await env.DB.prepare("INSERT INTO auth_handoffs (id, ticket_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id(), await sha256(ticket), userId, now() + HANDOFF_TTL_MS, now()).run();
  return ticket;
}

async function accountPayload(env, user) {
  const identities = await env.DB.prepare("SELECT provider FROM auth_identities WHERE user_id = ? ORDER BY provider").bind(user.id).all();
  return { user: { ...publicUser(user), hasPassword: Number(user.has_password ?? 1) === 1 }, providers: identities.results.map((identity) => identity.provider) };
}

// ─── Maintenance cron ──────────────────────────────────────────────────────

async function cleanupStale(env) {
  try {
    const cutoff = now() - AUDIT_RETENTION_MS;
    await env.DB.batch([
      env.DB.prepare("PRAGMA foreign_keys = ON;"),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM auth_handoffs WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE expires_at < ?").bind(now()),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").bind(now()),
      env.DB.prepare("DELETE FROM admin_audit WHERE created_at < ?").bind(cutoff),
    ]);
  } catch (error) {
    console.error("cleanupStale failed:", error);
  }
}

/* ─── Admin helpers ─────────────────────────────────────────────────────── */

const ADMIN_ROLES = new Set(["admin", "content_admin"]);

function isAdmin(session) { return session?.user?.role === "admin"; }
function isAdminOrContent(session) { return ADMIN_ROLES.has(session?.user?.role); }

function adminPublicUser(user) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, email: user.email ?? null, createdAt: user.created_at };
}

async function auditLog(env, actorId, action, targetId, detail) {
  // Audit log writes are best-effort but we now log failures instead of
  // silently swallowing them so operators can spot integrity regressions.
  try {
    await env.DB.prepare("INSERT INTO admin_audit (id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id(), actorId, action, targetId ?? null, detail ? JSON.stringify(detail) : null, now()).run();
  } catch (error) {
    console.error("auditLog write failed:", error, { actorId, action, targetId });
  }
}

/* R2 key helpers */
function r2Draft(base)     { return `${base}/draft.json`; }
function r2Pending(base)   { return `${base}/pending.json`; }
function r2Published(base) { return `${base}/published.json`; }

async function r2Get(env, key) {
  if (!env.CONTENT) return null;
  const obj = await env.CONTENT.get(key);
  if (!obj) return null;
  return obj.text();
}
async function r2Put(env, key, text, contentType = "application/json") {
  if (!env.CONTENT) throw new Error("Content storage not configured");
  await env.CONTENT.put(key, text, { httpMetadata: { contentType } });
}
async function r2Delete(env, key) {
  if (!env.CONTENT) return;
  await env.CONTENT.delete(key);
}

/* Hybrid publish: when an admin publishes a content_object, also push the body
 * into the student-facing keyspace (`content-files/<category>/<path>/<file>`)
 * and regenerate the affected category manifest so students immediately see
 * the edit. `targetPath` is the desired relative path inside the category
 * folder, e.g. "cardiology/acute-coronary/questions.json" for a quiz. If
 * `targetPath` is omitted we fall back to "<r2_key_base-tail>.json".
 *
 * Returns the list of R2 keys that were touched (for the audit log). */
const CONTENT_TYPE_TO_CATEGORY = {
  quiz: "qbank", bank: "qbank", written: "qbank",
  flashcard: "flashcard", osce: "osce",
  library: "library", video: "videos",
};

async function hybridPublish(env, obj, body, targetPath) {
  if (!env.CONTENT) return [];
  const category = CONTENT_TYPE_TO_CATEGORY[obj.content_type] ?? obj.content_type;
  const safePath = (targetPath || "").replace(/^\/+|\/+$/g, "");
  // If targetPath looks like a file (has an extension), use it directly;
  // otherwise default to a `.json` (or `.md` for library) file at the tail.
  let fileSegment;
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

  // Regenerate the manifest for this category by listing R2 keys under
  // content-files/<category>/ and rebuilding the tree. This is best-effort —
  // if regeneration fails we still return the published key.
  try {
    await regenerateManifestForCategory(env, category);
  } catch (e) {
    console.error("manifest regen failed:", e);
  }
  return [r2Key];
}

/* Rebuild the manifest for one category by walking the content-files/ keyspace.
 * Writes the result to `content-manifests/<category>/manifest.json`.
 * Produces nodes with `uid` and `type` fields matching the local
 * generate-content-manifests.js output. */
const ASSET_FOLDERS = new Set(["images", "assets"]);
const CATEGORY_TYPE_MAP = { qbank: null, flashcard: "flashcard", osce: "osce", library: "library", videos: "video" };
const FILE_TYPE_KEYS = { questions: "quiz", passages: "bank", prompts: "written", cards: "flashcard", videos: "video", stations: "osce" };

function inferTypeFromFileName(files) {
  for (const f of files) {
    const base = f.replace(/\.[^.]+$/, "");
    if (FILE_TYPE_KEYS[base]) return FILE_TYPE_KEYS[base];
  }
  return null;
}
function sanitizeSeg(s) { return s.replace(/[\s]+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || s; }
function buildUid(type, segments) { return [type, ...segments.map(sanitizeSeg)].filter(Boolean).join("-"); }

async function regenerateManifestForCategory(env, category) {
  if (!env.CONTENT) return null;
  const prefix = `content-files/${category}/`;
  const listed = await env.CONTENT.list({ prefix, limit: 1000 });
  if (!listed || !listed.objects) return null;
  const keys = listed.objects.map((o) => o.key);

  // Group keys into folders by their parent path.
  const folders = new Map(); // folderPath → { files: [], images: [] }
  for (const fullKey of keys) {
    const rel = fullKey.slice(prefix.length);
    if (!rel) continue;
    const parts = rel.split("/");
    const file = parts.pop();
    const folderPath = parts.join("/");
    if (!folders.has(folderPath)) folders.set(folderPath, { files: [], images: [] });
    const f = folders.get(folderPath);
    if (file) {
      if (file.toLowerCase().endsWith(".json") || file.toLowerCase().endsWith(".md") || file.toLowerCase().endsWith(".html") || file.toLowerCase().endsWith(".pdf")) {
        f.files.push(file);
      } else if (file.match(/\.(png|jpe?g|gif|svg|webp|avif|bmp|mp3|m4a|mp4)$/i)) {
        f.images.push(file);
      }
    }
  }

  // Remove asset subfolder entries (images/, assets/) — they are not content nodes
  for (const path of [...folders.keys()]) {
    const seg = path.split("/").pop();
    if (ASSET_FOLDERS.has(seg)) folders.delete(path);
  }

  const parentType = CATEGORY_TYPE_MAP[category] || null;

  // Build the tree from the flat folder map.
  const nodes = new Map();
  for (const [fp, info] of folders.entries()) {
    const inferredType = parentType || inferTypeFromFileName(info.files) || "quiz";
    const segments = fp ? fp.split("/") : [];
    const uid = buildUid(inferredType, [category, ...segments]);
    nodes.set(fp, {
      uid,
      title: fp ? fp.split("/").pop().replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : category,
      type: inferredType,
      path: fp ? `${fp}/` : "",
      files: info.files,
      images: info.images,
      items: [],
    });
  }
  // Attach children to parents.
  const roots = [];
  for (const [fp, node] of nodes.entries()) {
    if (!fp) { roots.push(node); continue; }
    const parent = fp.includes("/") ? fp.slice(0, fp.lastIndexOf("/")) : "";
    if (nodes.has(parent)) {
      nodes.get(parent).items.push(node);
    } else {
      roots.push(node);
    }
  }
  const manifest = {
    type: parentType || (roots.length > 0 ? roots[0].type : "quiz"),
    items: roots.sort((a, b) => a.title.localeCompare(b.title)),
  };
  const manifestKey = `content-manifests/${category}/manifest.json`;
  await env.CONTENT.put(manifestKey, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return manifest;
}

/* Content validators — TS port of tauri-admin/src/validate.rs */
function validateContent(contentType, parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") {
    return ["Content must be a JSON object"];
  }
  const vid = (v) => typeof v === "string" && v.trim().length > 0;

  if (contentType === "quiz") {
    const qs = parsed.questions;
    if (!Array.isArray(qs)) return ["quiz: `questions` array required"];
    qs.forEach((q, i) => {
      const p = `questions[${i}]`;
      if (!vid(q.id)) errors.push(`${p}: id required`);
      if (typeof q.question !== "string" || !q.question.trim()) errors.push(`${p}: question text required`);
      if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${p}: at least 2 options required`);
      if (typeof q.correct !== "number" || q.correct < 0 || q.correct >= (q.options?.length ?? 0)) errors.push(`${p}: correct index out of bounds`);
    });
  } else if (contentType === "bank") {
    const ps = parsed.passages;
    if (!Array.isArray(ps)) return ["bank: `passages` array required"];
    ps.forEach((p, i) => {
      const prefix = `passages[${i}]`;
      if (!vid(p.id)) errors.push(`${prefix}: id required`);
      if (typeof p.content !== "string" || !p.content.trim()) errors.push(`${prefix}: content required`);
      if (!Array.isArray(p.questions)) errors.push(`${prefix}: questions array required`);
    });
  } else if (contentType === "written") {
    const ps = parsed.prompts;
    if (!Array.isArray(ps)) return ["written: `prompts` array required"];
    ps.forEach((p, i) => {
      const prefix = `prompts[${i}]`;
      if (!vid(p.id)) errors.push(`${prefix}: id required`);
      if (typeof p.prompt !== "string" || !p.prompt.trim()) errors.push(`${prefix}: prompt required`);
      if (!Array.isArray(p.rubric)) errors.push(`${prefix}: rubric array required`);
    });
  } else if (contentType === "flashcard") {
    const cs = parsed.cards;
    if (!Array.isArray(cs)) return ["flashcard: `cards` array required"];
    cs.forEach((c, i) => {
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
    ss.forEach((s, i) => {
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
    vs.forEach((v, i) => {
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
  } else if (contentType === "library") {
    // Library content is markdown — anything non-empty is fine.
  }
  return errors;
}

// ─── Admin route handler ────────────────────────────────────────────────────

async function handleAdmin(request, env, session, url, origin) {
  const path = url.pathname; // starts with /v1/admin

  /* ── Identity ── */
  if (request.method === "GET" && path === "/v1/admin/me") {
    return json({ user: adminPublicUser(session.user), capabilities: {
      manageUsers: isAdmin(session),
      manageContent: isAdminOrContent(session),
      approveContent: isAdmin(session),
      publishDirect: isAdmin(session),
      viewStats: isAdmin(session),
      viewAudit: isAdmin(session),
      manageSessions: isAdmin(session),
    }}, 200, origin);
  }

  /* ── Stats (admin only) ── */
  if (request.method === "GET" && path === "/v1/admin/stats") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
    const [userCount, sessionCount, contentCount, pendingCount, publishedCount, draftCount] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as n FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?").bind(now()).first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects WHERE status = 'pending'").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects WHERE status = 'published'").first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM content_objects WHERE status = 'draft'").first(),
    ]);
    return json({
      userCount: userCount?.n ?? 0,
      sessionCount: sessionCount?.n ?? 0,
      contentCount: contentCount?.n ?? 0,
      pendingCount: pendingCount?.n ?? 0,
      publishedCount: publishedCount?.n ?? 0,
      draftCount: draftCount?.n ?? 0,
    }, 200, origin);
  }

  /* ── Audit log (admin only) ── */
  if (request.method === "GET" && path === "/v1/admin/audit") {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const action = (url.searchParams.get("action") || "").trim();
    const limit = 50;
    const offset = (page - 1) * limit;
    let rows, total;
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
    return json({
      items: (rows.results || []).map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorUsername: row.actor_username ?? null,
        actorDisplayName: row.actor_display_name ?? null,
        action: row.action,
        targetId: row.target_id ?? null,
        detail: row.detail ? JSON.parse(row.detail) : null,
        createdAt: row.created_at,
      })),
      total: total?.n ?? 0,
      page,
      limit,
    }, 200, origin);
  }

  /* ── Users (admin only) ── */
  if (path.startsWith("/v1/admin/users")) {
    if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);

    // List
    if (request.method === "GET" && path === "/v1/admin/users") {
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const q = (url.searchParams.get("q") || "").trim();
      const limit = 25; const offset = (page - 1) * limit;
      let rows, total;
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
      return json({ users: (rows.results || []).map(adminPublicUser), total: total?.n ?? 0, page, limit }, 200, origin);
    }

    // List active sessions for a user (admin only)
    const sessionsMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/sessions$/);
    if (sessionsMatch && request.method === "GET") {
      const targetId = sessionsMatch[1];
      const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(targetId).first();
      if (!user) return json({ error: "User not found" }, 404, origin);
      const rows = await env.DB.prepare("SELECT id, expires_at, created_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(targetId).all();
      return json({ sessions: rows.results || [] }, 200, origin);
    }
    if (sessionsMatch && request.method === "DELETE") {
      const targetId = sessionsMatch[1];
      const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
      if (!user) return json({ error: "User not found" }, 404, origin);
      await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), targetId).run();
      await auditLog(env, session.user.id, "revoke_sessions", targetId, { username: user.username });
      return json({ ok: true }, 200, origin);
    }

    // Single user (base path only — no sub-routes like /reset-password)
    const userIdMatch = path.match(/^\/v1\/admin\/users\/([^/]+)$/);
    const resetPasswordMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/reset-password$/);
    if (userIdMatch) {
      const targetId = userIdMatch[1];
      if (request.method === "GET") {
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
        if (!user) return json({ error: "User not found" }, 404, origin);
        const [sessions, content] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?").bind(targetId, now()).first(),
          env.DB.prepare("SELECT id, title, status, content_type, updated_at FROM content_objects WHERE created_by = ? ORDER BY updated_at DESC LIMIT 25").bind(targetId).all(),
        ]);
        return json({
          ...adminPublicUser(user),
          activeSessionCount: sessions?.n ?? 0,
          content: (content.results || []).map((c) => ({
            id: c.id, title: c.title, status: c.status, contentType: c.content_type, updatedAt: c.updated_at,
          })),
        }, 200, origin);
      }
      if (request.method === "PATCH") {
        const body = await readJson(request);
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
        if (!user) return json({ error: "User not found" }, 404, origin);
        const validRoles = new Set(["student", "admin", "content_admin"]);
        // Prevent admin from demoting themselves — avoids accidental lockout.
        if (targetId === session.user.id && body.role && body.role !== "admin") {
          return json({ error: "You cannot demote yourself. Ask another admin to demote you." }, 400, origin);
        }
        const newRole = body.role && validRoles.has(body.role) ? body.role : user.role;
        const newName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) || user.display_name : user.display_name;
        await env.DB.prepare("UPDATE users SET role = ?, display_name = ?, updated_at = ? WHERE id = ?").bind(newRole, newName, now(), targetId).run();
        await auditLog(env, session.user.id, "change_role", targetId, { from: user.role, to: newRole, displayName: newName });
        const updated = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
        return json(adminPublicUser(updated), 200, origin);
      }
      if (request.method === "DELETE") {
        if (targetId === session.user.id) return json({ error: "Cannot delete your own account" }, 400, origin);
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
        if (!user) return json({ error: "User not found" }, 404, origin);

        // Reassign content_objects instead of cascade-deleting them. We move
        // ownership to the acting admin so published content stays live. Drafts
        // and pending items the deleted user owned are also reassigned (the
        // admin can then decide whether to delete them).
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
        await auditLog(env, session.user.id, "delete_user", targetId, { username: user.username, contentReassignedTo: session.user.id });
        return json({ ok: true }, 200, origin);
      }
    }
    if (resetPasswordMatch) {
      const targetId = resetPasswordMatch[1];
      if (request.method === "POST") {
        const body = await readJson(request);
        const password = typeof body.password === "string" && validPassword(body.password) ? body.password : null;
        if (!password) return json({ error: "Password must be at least 8 characters with 2 character classes" }, 400, origin);
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
        if (!user) return json({ error: "User not found" }, 404, origin);
        const hashed = await passwordHash(password);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(hashed.hash, hashed.salt, now(), targetId),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), targetId),
        ]);
        await auditLog(env, session.user.id, "reset_password", targetId, { username: user.username });
        return json({ ok: true }, 200, origin);
      }
    }
  }

  /* ── Content (admin + content_admin) ── */
  if (path.startsWith("/v1/admin/content")) {
    if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin);

    // Bulk upload: store raw files in R2 for the user-facing content API.
    // POST /v1/admin/content/upload-file { key: "content-files/...", body: "..." }
    // or { key: "content-manifests/...", body: "..." }
    // For binary files (images), body can be a data URI: "data:...;base64,..."
    if (request.method === "POST" && path === "/v1/admin/content/upload-file") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
      const body = await readJson(request);
      const key = typeof body.key === "string" ? body.key.trim() : "";
      const raw = typeof body.body === "string" ? body.body : "";
      if (!key || !raw) return json({ error: "key and body required" }, 400, origin);
      if (key.length > 1024) return json({ error: "key too long" }, 400, origin);
      const ext = key.split(".").pop()?.toLowerCase() ?? "";
      let content;
      let ct;
      if (raw.startsWith("data:")) {
        // data URI — decode base64
        const b64 = raw.split(",")[1] ?? "";
        content = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        ct = raw.slice(5, raw.indexOf(";")) || "application/octet-stream";
      } else {
        content = raw;
        ct =
          ext === "json" ? "application/json"
          : ext === "md" ? "text/markdown; charset=utf-8"
          : ext === "html" || ext === "htm" ? "text/html; charset=utf-8"
          : ext === "svg" ? "image/svg+xml"
          : ext === "png" ? "image/png"
          : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "gif" ? "image/gif"
          : ext === "webp" ? "image/webp"
          : ext === "avif" ? "image/avif"
          : ext === "pdf" ? "application/pdf"
          : "application/octet-stream";
      }
      await env.CONTENT.put(key, content, { httpMetadata: { contentType: ct } });
      return json({ ok: true, key }, 200, origin);
    }

    // GET /v1/admin/content/r2-keys?prefix=<category>
    // List raw R2 keys under content-files/<category>/ (or content-manifests/).
    // Used by the admin content browser's "R2" tab to show all student-facing
    // files (so admins can delete stray images, rename folders, etc.).
    if (request.method === "GET" && path === "/v1/admin/content/r2-keys") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
      const category = (url.searchParams.get("prefix") || "").trim();
      const prefix = `content-files/${category}`;
      const listed = await env.CONTENT.list({ prefix, limit: 1000, cursor: url.searchParams.get("cursor") || undefined });
      const items = (listed.objects || []).map((o) => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded?.toISOString?.() ?? null,
      }));
      return json({ items, cursor: listed.truncated ? listed.cursor : null }, 200, origin);
    }

    // DELETE /v1/admin/content/r2-key?key=<key>
    // Delete a single R2 key (admin only). Refuses to delete anything outside
    // the content-files/ or content-manifests/ prefixes so admins can't nuke
    // the content/<type>/<uuid>/ objects behind the content_object workflow.
    if (request.method === "DELETE" && path === "/v1/admin/content/r2-key") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
      const key = (url.searchParams.get("key") || "").trim();
      if (!key) return json({ error: "key required" }, 400, origin);
      if (!key.startsWith("content-files/") && !key.startsWith("content-manifests/")) {
        return json({ error: "Only content-files/ and content-manifests/ keys can be deleted via this endpoint" }, 400, origin);
      }
      await env.CONTENT.delete(key);
      await auditLog(env, session.user.id, "delete_r2_key", null, { key });
      return json({ ok: true }, 200, origin);
    }

    // POST /v1/admin/content/r2-rename { from, to }
    // Move/rename a single R2 key inside content-files/. Copies then deletes
    // the source. Used by the right-click "Rename" action in the tree.
    if (request.method === "POST" && path === "/v1/admin/content/r2-rename") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
      const body = await readJson(request);
      const from = typeof body.from === "string" ? body.from.trim() : "";
      const to = typeof body.to === "string" ? body.to.trim() : "";
      if (!from || !to) return json({ error: "from and to required" }, 400, origin);
      if (!from.startsWith("content-files/") || !to.startsWith("content-files/")) {
        return json({ error: "Only content-files/ keys can be renamed" }, 400, origin);
      }
      const src = await env.CONTENT.get(from);
      if (!src) return json({ error: "Source key not found" }, 404, origin);
      const buf = await src.arrayBuffer();
      const ct = from.endsWith(".json") ? "application/json" : from.endsWith(".md") ? "text/markdown" : "application/octet-stream";
      await env.CONTENT.put(to, buf, { httpMetadata: { contentType: ct } });
      await env.CONTENT.delete(from);
      await auditLog(env, session.user.id, "rename_r2_key", null, { from, to });
      return json({ ok: true, from, to }, 200, origin);
    }

    // POST /v1/admin/content/r2-folder { path }
    // Create an empty folder by writing a `.keep` placeholder file inside it.
    // (R2 has no real folders; this just establishes the path prefix.)
    if (request.method === "POST" && path === "/v1/admin/content/r2-folder") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
      const body = await readJson(request);
      const pathArg = typeof body.path === "string" ? body.path.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!pathArg) return json({ error: "path required" }, 400, origin);
      if (!pathArg.startsWith("content-files/")) {
        return json({ error: "path must start with content-files/" }, 400, origin);
      }
      const key = `${pathArg}/.keep`;
      await env.CONTENT.put(key, "", { httpMetadata: { contentType: "text/plain" } });
      await auditLog(env, session.user.id, "create_r2_folder", null, { path: pathArg });
      return json({ ok: true, key }, 200, origin);
    }

    // POST /v1/admin/content/regenerate-manifest { category }
    // Rebuild the manifest.json for one category from the live content-files/.
    // Pass `category: "all"` to regenerate every category.
    if (request.method === "POST" && path === "/v1/admin/content/regenerate-manifest") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
      const body = await readJson(request);
      const cat = typeof body.category === "string" ? body.category.trim() : "";
      if (!cat) return json({ error: "category required" }, 400, origin);
      const categories = cat === "all"
        ? ["qbank", "flashcard", "osce", "library", "videos"]
        : [cat];
      const results = {};
      for (const c of categories) {
        try { results[c] = await regenerateManifestForCategory(env, c) ? "ok" : "empty"; }
        catch (e) { results[c] = `error: ${e.message}`; }
      }
      await auditLog(env, session.user.id, "regenerate_manifest", null, { category: cat });
      return json({ ok: true, results }, 200, origin);
    }

    // POST /v1/admin/content/validate { contentType, body }
    // Standalone validation endpoint (not tied to an existing content_object).
    if (request.method === "POST" && path === "/v1/admin/content/validate") {
      if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin);
      const body = await readJson(request);
      const ct = typeof body.contentType === "string" ? body.contentType : "";
      const validTypes = new Set(["quiz","bank","flashcard","written","osce","library","video"]);
      if (!validTypes.has(ct)) return json({ error: "Invalid content type" }, 400, origin);
      let parsed;
      try { parsed = JSON.parse(typeof body.body === "string" ? body.body : "{}"); }
      catch (e) { return json({ errors: [`Invalid JSON: ${e.message}`] }, 200, origin); }
      const errors = validateContent(ct, parsed);
      return json({ errors }, 200, origin);
    }

    // Pending review queue
    if (request.method === "GET" && path === "/v1/admin/content/pending") {
      if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
      const rows = await env.DB.prepare(
        "SELECT co.*, u.username as creator_username, u.display_name as creator_display_name FROM content_objects co JOIN users u ON u.id = co.created_by WHERE co.status = 'pending' ORDER BY co.submitted_at ASC"
      ).all();
      return json({ items: rows.results || [] }, 200, origin);
    }

    // List content objects (with optional ?q= title search)
    if (request.method === "GET" && path === "/v1/admin/content") {
      const status = url.searchParams.get("status") || "published";
      const q = (url.searchParams.get("q") || "").trim();
      const validStatuses = new Set(["draft", "pending", "published", "rejected", "all"]);
      const safeStatus = validStatuses.has(status) ? status : "published";
      const like = q ? `%${escapeLike(q)}%` : null;
      // Build the WHERE clause and params once; reuse for both rows and count queries.
      const where = [];
      const params = [];
      if (isAdmin(session)) {
        if (safeStatus !== "all") {
          where.push("co.status = ?");
          params.push(safeStatus);
        }
      } else {
        // content_admin sees only their own drafts/pending/rejected + all published.
        if (safeStatus === "published") {
          where.push("co.status = 'published'");
        } else {
          where.push("co.created_by = ?");
          where.push("co.status = ?");
          params.push(session.user.id, safeStatus);
        }
      }
      if (like) {
        where.push("co.title LIKE ? ESCAPE '\\'");
        params.push(like);
      }
      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
      const [rows, total] = await Promise.all([
        env.DB.prepare(`SELECT co.*, u.username as creator_username FROM content_objects co JOIN users u ON u.id = co.created_by${whereSql} ORDER BY co.updated_at DESC LIMIT 100`).bind(...params).all(),
        env.DB.prepare(`SELECT COUNT(*) as n FROM content_objects co JOIN users u ON u.id = co.created_by${whereSql}`).bind(...params).first(),
      ]);
      return json({ items: rows.results || [], total: total?.n ?? 0 }, 200, origin);
    }

    // Create new content object
    if (request.method === "POST" && path === "/v1/admin/content") {
      if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
      const body = await readJson(request);
      const validTypes = new Set(["quiz","bank","flashcard","written","osce","library","video"]);
      if (!body.contentType || !validTypes.has(body.contentType)) return json({ error: "Invalid content type" }, 400, origin);
      const objectId = id();
      const r2Base = `content/${body.contentType}/${objectId}`;
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : null;
      const initialContent = body.content || JSON.stringify({ title: title || "Untitled" }, null, 2);
      await r2Put(env, r2Draft(r2Base), initialContent);
      await env.DB.prepare(
        "INSERT INTO content_objects (id, r2_key_base, content_type, title, language, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)"
      ).bind(objectId, r2Base, body.contentType, title, body.language || "en", session.user.id, now(), now()).run();
      await auditLog(env, session.user.id, "create_content", objectId, { title, contentType: body.contentType });
      return json({ id: objectId, r2KeyBase: r2Base, status: "draft" }, 201, origin);
    }

    const contentIdMatch = path.match(/^\/v1\/admin\/content\/([^/]+)(\/(.+))?$/);
    if (contentIdMatch) {
      const objectId = contentIdMatch[1];
      const action = contentIdMatch[3] || null;

      // Skip if this is actually the /pending list route (handled above)
      if (objectId === "pending") return json({ error: "Not found" }, 404, origin);

      const obj = await env.DB.prepare("SELECT * FROM content_objects WHERE id = ?").bind(objectId).first();
      if (!obj) return json({ error: "Content not found" }, 404, origin);

      // content_admin can only access their own non-published objects + all published
      if (!isAdmin(session) && obj.created_by !== session.user.id && obj.status !== "published") {
        return json({ error: "Forbidden" }, 403, origin);
      }

      // GET object metadata + body
      if (request.method === "GET" && !action) {
        const bodyKey = obj.status === "published" ? r2Published(obj.r2_key_base) : r2Draft(obj.r2_key_base);
        const body = await r2Get(env, bodyKey);
        return json({ ...obj, body: body ?? null }, 200, origin);
      }

      // GET diff (pending vs published) — admin only
      if (request.method === "GET" && action === "diff") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
        const [pending, published] = await Promise.all([
          r2Get(env, r2Pending(obj.r2_key_base)),
          r2Get(env, r2Published(obj.r2_key_base)),
        ]);
        return json({ pending: pending ?? null, published: published ?? null }, 200, origin);
      }

      // PUT draft — save draft body
      if (request.method === "PUT" && action === "draft") {
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
        if (!isAdmin(session) && obj.created_by !== session.user.id) return json({ error: "Forbidden" }, 403, origin);
        const body = await request.text();
        if (!body || body.length > 1_000_000) return json({ error: "Invalid body" }, 400, origin);
        await r2Put(env, r2Draft(obj.r2_key_base), body);
        const newTitle = (() => { try { const j = JSON.parse(body); return typeof j.title === "string" ? j.title.trim().slice(0, 200) : null; } catch { return null; } })();
        await env.DB.prepare("UPDATE content_objects SET title = COALESCE(?, title), updated_at = ? WHERE id = ?").bind(newTitle, now(), objectId).run();
        return json({ ok: true }, 200, origin);
      }

      // POST submit — snapshot draft to pending, set status=pending
      if (request.method === "POST" && action === "submit") {
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
        if (!isAdmin(session) && obj.created_by !== session.user.id) return json({ error: "Forbidden" }, 403, origin);
        const draft = await r2Get(env, r2Draft(obj.r2_key_base));
        if (!draft) return json({ error: "Draft is empty" }, 400, origin);
        await r2Put(env, r2Pending(obj.r2_key_base), draft);
        await env.DB.prepare("UPDATE content_objects SET status = 'pending', submitted_at = ?, reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL, updated_at = ? WHERE id = ?").bind(now(), now(), objectId).run();
        await auditLog(env, session.user.id, "submit_content", objectId, { title: obj.title });
        return json({ ok: true, status: "pending" }, 200, origin);
      }

      // POST reject — set status=rejected with reason (admin only)
      if (request.method === "POST" && action === "reject") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
        const body = await readJson(request);
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
        await env.DB.prepare("UPDATE content_objects SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ?").bind(session.user.id, now(), reason || null, now(), objectId).run();
        await auditLog(env, session.user.id, "reject", objectId, { title: obj.title, reason });
        return json({ ok: true, status: "rejected" }, 200, origin);
      }

      // POST publish — direct publish skipping review (admin only)
      // Body (optional JSON): { targetPath?: string, hybrid?: boolean (default true) }
      // When hybrid is true (the default), the body is ALSO written to
      // content-files/<category>/<targetPath> so students immediately see
      // the edit through the public /v1/content/* endpoints.
      if (request.method === "POST" && action === "publish") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
        const draft = await r2Get(env, r2Draft(obj.r2_key_base));
        if (!draft) return json({ error: "Draft is empty" }, 400, origin);
        await r2Put(env, r2Published(obj.r2_key_base), draft);
        let targetPath = null;
        let doHybrid = true;
        try {
          const body = await request.clone().json();
          if (typeof body.targetPath === "string") targetPath = body.targetPath.trim();
          if (body.hybrid === false) doHybrid = false;
        } catch {}
        let hybridKeys = [];
        if (doHybrid) hybridKeys = await hybridPublish(env, obj, draft, targetPath);
        await env.DB.prepare("UPDATE content_objects SET status = 'published', reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?").bind(session.user.id, now(), now(), objectId).run();
        await auditLog(env, session.user.id, "publish_direct", objectId, { title: obj.title, hybridKeys });
        return json({ ok: true, status: "published", hybridKeys }, 200, origin);
      }

      // POST approve — promote pending to published (admin only)
      // Same hybrid-publish treatment as `publish` so student-facing content
      // stays in sync when an editor's pending snapshot is approved.
      if (request.method === "POST" && action === "approve") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
        const pending = await r2Get(env, r2Pending(obj.r2_key_base));
        if (!pending) return json({ error: "No pending snapshot found" }, 400, origin);
        await r2Put(env, r2Published(obj.r2_key_base), pending);
        let targetPath = null;
        try {
          const body = await request.clone().json();
          if (typeof body.targetPath === "string") targetPath = body.targetPath.trim();
        } catch {}
        const hybridKeys = await hybridPublish(env, obj, pending, targetPath);
        await env.DB.prepare("UPDATE content_objects SET status = 'published', reviewed_by = ?, reviewed_at = ?, rejection_reason = NULL, updated_at = ? WHERE id = ?").bind(session.user.id, now(), now(), objectId).run();
        await auditLog(env, session.user.id, "approve", objectId, { title: obj.title, hybridKeys });
        return json({ ok: true, status: "published", hybridKeys }, 200, origin);
      }

      // POST validate — runs schema validation on the current draft (or a
      // provided body) and returns the list of errors. Empty array = valid.
      // Body (optional): { body?: string }
      if (request.method === "POST" && action === "validate") {
        let body = null;
        try {
          const parsed = await request.clone().json();
          if (typeof parsed.body === "string") body = parsed.body;
        } catch {}
        if (body == null) body = await r2Get(env, r2Draft(obj.r2_key_base));
        if (body == null) return json({ errors: ["Draft is empty"] }, 200, origin);
        let parsed;
        try { parsed = JSON.parse(body); }
        catch (e) { return json({ errors: [`Invalid JSON: ${e.message}`] }, 200, origin); }
        const errors = validateContent(obj.content_type, parsed);
        return json({ errors }, 200, origin);
      }

      // POST unpublish — revert published → draft (admin only). Keeps the
      // published R2 object around so the action is reversible by re-publishing.
      if (request.method === "POST" && action === "unpublish") {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
        await env.DB.prepare("UPDATE content_objects SET status = 'draft', updated_at = ? WHERE id = ?").bind(now(), objectId).run();
        await auditLog(env, session.user.id, "unpublish", objectId, { title: obj.title });
        return json({ ok: true, status: "draft" }, 200, origin);
      }

      // DELETE content object (admin only)
      if (request.method === "DELETE" && !action) {
        if (!isAdmin(session)) return json({ error: "Forbidden" }, 403, origin);
        await Promise.all([
          r2Delete(env, r2Draft(obj.r2_key_base)),
          r2Delete(env, r2Pending(obj.r2_key_base)),
          r2Delete(env, r2Published(obj.r2_key_base)),
        ]);
        await env.DB.prepare("DELETE FROM content_objects WHERE id = ?").bind(objectId).run();
        await auditLog(env, session.user.id, "delete_content", objectId, { title: obj.title });
        return json({ ok: true }, 200, origin);
      }
    }

    return json({ error: "Not found" }, 404, origin);
  }

  return null; // not an admin route
}

// ─── Main fetch handler ─────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    if (env.DB) ctx.waitUntil(cleanupStale(env));
  },
  async fetch(request, env, ctx) {
    const origin = requestOrigin(request, env);
    if (origin === null) return json({ error: "Origin is not allowed" }, 403, "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (!env.DB || !env.JWT_SECRET) return json({ error: "Worker is not configured" }, 503, origin);

    // Cron cleanup is best handled by the scheduled handler; we no longer
    // invoke cleanupStale on every request (it was wasteful on hot paths).
    // The scheduled cron runs every hour — see wrangler.toml [triggers].
    const url = new URL(request.url);
    const ip = clientIp(request);

    try {
      // ── Public health check ──
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return json({ ok: true, googleEnabled: googleReady(env), turnstileEnabled: env.TURNSTILE_ENABLED === "true" }, 200, origin, { cacheControl: "public, max-age=60" });
      }

      // ── Public content serving (R2-backed) ──
      // Serves content packs from R2 in the same structure the frontend expects:
      //   GET /v1/content/:category/manifest.json
      //   GET /v1/content/:category/:path.../:file
      if (request.method === "GET" && url.pathname.startsWith("/v1/content/")) {
        const contentPath = url.pathname.slice("/v1/content/".length).replace(/\/{2,}/g, "/");
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
        // url.pathname is already URL-decoded by URL parser — do NOT call
        // decodeURIComponent again (it would double-decode %2520 → %20 → space).
        const r2Key = `content-files/${contentPath}`;
        const obj = await env.CONTENT.get(r2Key);
        if (!obj) return json({ error: "Not found" }, 404, origin);
        const ext = contentPath.split(".").pop()?.toLowerCase() ?? "";
        const contentType =
          ext === "json" ? "application/json"
          : ext === "md" ? "text/markdown; charset=utf-8"
          : ext === "html" || ext === "htm" ? "text/html; charset=utf-8"
          : ext === "pdf" ? "application/pdf"
          : ext === "svg" ? "image/svg+xml"
          : ext === "png" ? "image/png"
          : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "gif" ? "image/gif"
          : ext === "webp" ? "image/webp"
          : ext === "avif" ? "image/avif"
          : ext === "bmp" ? "image/bmp"
          : ext === "ico" ? "image/x-icon"
          : ext === "mp3" || ext === "m4a" ? "audio/mpeg"
          : ext === "mp4" ? "video/mp4"
          : ext === "webm" ? "video/webm"
          : ext === "m3u8" ? "application/vnd.apple.mpegurl"
          : ext === "css" ? "text/css"
          : ext === "js" ? "application/javascript"
          : "application/octet-stream";
        const cacheable = ext !== "json" && ext !== "md";
        return new Response(obj.body, {
          status: 200,
          headers: securityHeaders({
            "content-type": contentType,
            "cache-control": cacheable ? "public, max-age=86400, immutable" : "public, max-age=60",
            ...cors(origin),
          }),
        });
      }

      // ── Public content manifests (R2-backed) ──
      // Serves category manifests from R2:
      //   GET /v1/content-manifests/:category/manifest.json
      if (request.method === "GET" && url.pathname.startsWith("/v1/content-manifests/")) {
        const manifestPath = url.pathname.slice("/v1/content-manifests/".length).replace(/\/{2,}/g, "/");
        if (!env.CONTENT) return json({ error: "Content storage not configured" }, 503, origin);
        const r2Key = `content-manifests/${manifestPath}`;
        const obj = await env.CONTENT.get(r2Key);
        if (!obj) return json({ error: "Not found" }, 404, origin);
        return new Response(obj.body, {
          status: 200,
          headers: securityHeaders({
            "content-type": "application/json",
            "cache-control": "public, max-age=60",
            ...cors(origin),
          }),
        });
      }

      // ── Google OAuth ──
      if (request.method === "GET" && url.pathname === "/v1/auth/google/start") {
        if (!googleReady(env)) return json({ error: "Google sign-in is not configured" }, 503, origin);
        const returnTo = url.searchParams.get("returnTo") || "";
        let validatedReturnTo;
        try { validatedReturnTo = new URL(returnTo); } catch { return json({ error: "Invalid return URL" }, 400, origin); }
        if (validatedReturnTo.origin !== env.ALLOWED_ORIGIN) return json({ error: "Invalid return URL" }, 400, origin);
        const state = `${id()}${id()}`;
        const nonce = `${id()}${id()}`;
        await env.DB.prepare("INSERT INTO oauth_states (state, nonce, return_to, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(state, nonce, returnTo, now() + OAUTH_TTL_MS, now()).run();
        const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authorize.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: workerCallback(env), response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account" }).toString();
        return Response.redirect(authorize.toString(), 302);
      }
      if (request.method === "GET" && url.pathname === "/v1/auth/google/callback") {
        const stateValue = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code");
        const state = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?").bind(stateValue, now()).first();
        if (state) await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(stateValue).run();
        if (!state || !code || !googleReady(env)) return Response.redirect(`${env.ALLOWED_ORIGIN}/?cloudAuthError=google`, 302);
        const form = new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: workerCallback(env), grant_type: "authorization_code" });
        const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
        if (!response.ok) return Response.redirect(`${state.return_to}/?cloudAuthError=google`, 302);
        const claims = await verifyGoogleIdToken((await response.json()).id_token, env, state.nonce);
        const user = await googleUser(env, claims);
        const ticket = await createAuthHandoff(env, user.id);
        return Response.redirect(`${state.return_to.replace(/\/$/, "")}/?cloudAuth=${encodeURIComponent(ticket)}`, 302);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/google/consume") {
        if (!rateLimit(ip, "auth:google:consume")) return json({ error: "Too many attempts. Please try again in a minute." }, 429, origin);
        const body = await readJson(request);
        const ticket = typeof body.ticket === "string" ? body.ticket : "";
        const handoff = ticket && await env.DB.prepare("SELECT * FROM auth_handoffs WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(ticket), now()).first();
        if (!handoff) return json({ error: "This sign-in link is invalid or expired" }, 400, origin);
        await env.DB.prepare("UPDATE auth_handoffs SET used_at = ? WHERE id = ?").bind(now(), handoff.id).run();
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(handoff.user_id).first();
        return json(await issueSession(user, env), 200, origin);
      }

      // ── Username availability (light rate limit) ──
      if (request.method === "GET" && url.pathname === "/v1/auth/username-available") {
        if (!rateLimit(ip, "auth:register")) return json({ error: "Too many attempts" }, 429, origin);
        const username = url.searchParams.get("username")?.trim() || "";
        if (!validUsername(username)) return json({ available: false }, 200, origin);
        const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
        return json({ available: !existing }, 200, origin, { cacheControl: "no-store" });
      }

      // ── Registration ──
      if (request.method === "POST" && url.pathname === "/v1/auth/register") {
        if (!rateLimit(ip, "auth:register")) return json({ error: "Too many registration attempts. Please try again in a minute." }, 429, origin);
        const body = await readJson(request);
        const username = String(body.username || "").trim();
        const email = body.email ? String(body.email).trim().toLowerCase() : null;
        const displayName = String(body.displayName || username).trim().slice(0, 80);
        if (!validUsername(username) || !validEmail(email) || !validPassword(body.password) || !displayName) return json({ error: "Invalid registration details" }, 400, origin);
        if (!await verifyTurnstile(body.turnstileToken, request, env)) return json({ error: "Verification failed" }, 400, origin);
        const userId = id(); const password = await passwordHash(body.password);
        try {
          await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
            .bind(userId, username, email, displayName, password.hash, password.salt, now(), now()).run();
        } catch { return json({ error: "That username or email is already in use" }, 409, origin); }
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
        return json(await issueSession(user, env), 201, origin);
      }

      // ── Login ──
      if (request.method === "POST" && url.pathname === "/v1/auth/login") {
        if (!rateLimit(ip, "auth:login")) return json({ error: "Too many login attempts. Please try again in a minute." }, 429, origin);
        const body = await readJson(request); const identifier = String(body.identifier || "").trim();
        if (!identifier || !validPassword(body.password)) return json({ error: "Invalid username or password" }, 401, origin);
        if (!await verifyTurnstile(body.turnstileToken, request, env)) return json({ error: "Verification failed" }, 400, origin);
        const user = await env.DB.prepare("SELECT * FROM users WHERE has_password = 1 AND (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE)").bind(identifier, identifier).first();
        if (!user || !await passwordMatches(body.password, user.password_salt, user.password_hash)) return json({ error: "Invalid username or password" }, 401, origin);
        return json(await issueSession(user, env), 200, origin);
      }

      // ── Logout ──
      if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
        const session = await requireUser(request, env); if (session) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(now(), session.sessionId).run();
        return json({ ok: true }, 200, origin);
      }

      // ── Password reset ──
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/request") {
        if (!rateLimit(ip, "auth:reset")) return json({ error: "Too many reset attempts. Please try again in a minute." }, 429, origin);
        const body = await readJson(request); const email = String(body.email || "").trim().toLowerCase();
        // Always return ok to avoid email enumeration. The Resend call only
        // fires when the email exists, but the response is identical.
        if (validEmail(email) && await verifyTurnstile(body.turnstileToken, request, env)) {
          const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(email).first();
          if (user && env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_ORIGIN) {
            const token = `${id()}${id()}`; const expiresAt = now() + RESET_TTL_MS;
            await env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(id(), user.id, await sha256(token), expiresAt, now()).run();
            const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/?reset=${encodeURIComponent(token)}`;
            await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [user.email], subject: "Reset your Osler password", html: `<p>Use this link within 30 minutes to reset your password:</p><p><a href="${link}">${link}</a></p><p>If you did not request a password reset, you can safely ignore this email.</p>` }) });
          }
        }
        return json({ ok: true }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/confirm") {
        if (!rateLimit(ip, "auth:reset")) return json({ error: "Too many reset attempts. Please try again in a minute." }, 429, origin);
        const body = await readJson(request); if (typeof body.token !== "string" || !validPassword(body.password)) return json({ error: "Invalid reset request" }, 400, origin);
        const row = await env.DB.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(body.token), now()).first();
        if (!row) return json({ error: "This reset link is invalid or expired" }, 400, origin);
        const password = await passwordHash(body.password);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(password.hash, password.salt, now(), row.user_id),
          env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").bind(now(), row.id),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), row.user_id),
        ]);
        return json({ ok: true }, 200, origin);
      }

      // ── From here on: authenticated routes ──
      const session = await requireUser(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, origin);

      // Admin namespace — delegate to handleAdmin()
      if (url.pathname.startsWith("/v1/admin")) {
        if (!isAdminOrContent(session)) return json({ error: "Forbidden" }, 403, origin);
        const adminResponse = await handleAdmin(request, env, session, url, origin);
        if (adminResponse) return adminResponse;
        return json({ error: "Not found" }, 404, origin);
      }

      // ── Account routes ──
      if (request.method === "GET" && url.pathname === "/v1/auth/me") return json(await accountPayload(env, session.user), 200, origin);
      if (request.method === "PATCH" && url.pathname === "/v1/account") {
        const body = await readJson(request);
        const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : session.user.display_name;
        const email = body.email === null || body.email === "" ? null : typeof body.email === "string" ? body.email.trim().toLowerCase() : session.user.email;
        if (!displayName || !validEmail(email)) return json({ error: "Invalid account details" }, 400, origin);
        try { await env.DB.prepare("UPDATE users SET display_name = ?, email = ?, updated_at = ? WHERE id = ?").bind(displayName, email, now(), session.user.id).run(); } catch { return json({ error: "That email is already in use" }, 409, origin); }
        return json(await accountPayload(env, await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user.id).first()), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/account/password") {
        const body = await readJson(request);
        if (!validPassword(body.password)) return json({ error: "Password must be at least 8 characters with 2 character classes" }, 400, origin);
        if (Number(session.user.has_password ?? 1) === 1 && !await passwordMatches(String(body.currentPassword || ""), session.user.password_salt, session.user.password_hash)) return json({ error: "Current password is incorrect" }, 401, origin);
        const password = await passwordHash(body.password);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(password.hash, password.salt, now(), session.user.id),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?").bind(now(), session.user.id, session.sessionId),
        ]);
        return json(await issueSession(await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user.id).first(), env), 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/v1/account/export") return json({ account: await accountPayload(env, session.user), progress: { qbank: await getDocument(env, session.user.id, "qbank"), flashcards: await getDocument(env, session.user.id, "flashcards") }, exportedAt: now() }, 200, origin);
      if (request.method === "DELETE" && url.pathname === "/v1/account") {
        const body = await readJson(request);
        if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm account deletion" }, 400, origin);
        if (Number(session.user.has_password ?? 1) === 1 && !await passwordMatches(String(body.password || ""), session.user.password_salt, session.user.password_hash)) return json({ error: "Current password is incorrect" }, 401, origin);
        await env.DB.batch([
          env.DB.prepare("PRAGMA foreign_keys = ON;"),
          env.DB.prepare("DELETE FROM progress_documents WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM auth_identities WHERE user_id = ?").bind(session.user.id),
          env.DB.prepare("DELETE FROM auth_handoffs WHERE user_id = ?").bind(session.user.id),
          // Self-service account delete cascade-deletes the user's content.
          // Admin-driven deletes go through /v1/admin/users/:id which reassigns.
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(session.user.id),
        ]);
        return json({ ok: true }, 200, origin);
      }

      // ── Gemini API key management ──
      //
      // Stored per-user in D1 (`users.gemini_api_key`) so the user only has to
      // enter it once. Browsers fetch the key via GET and the worker proxies
      // actual Gemini calls through POST /v1/account/gemini/proxy so the key
      // never leaves the worker.
      if (request.method === "GET" && url.pathname === "/v1/account/gemini-key") {
        const row = await env.DB.prepare("SELECT gemini_api_key, gemini_model, gemini_max_wait FROM users WHERE id = ?").bind(session.user.id).first();
        return json({
          apiKey: row?.gemini_api_key ?? null,
          model: row?.gemini_model ?? null,
          maxWait: row?.gemini_max_wait ?? null,
          hasKey: !!row?.gemini_api_key,
        }, 200, origin);
      }
      if (request.method === "PUT" && url.pathname === "/v1/account/gemini-key") {
        const body = await readJson(request);
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim().slice(0, 200) : null;
        const model = typeof body.model === "string" ? body.model.trim().slice(0, 80) : null;
        const maxWait = Number.isFinite(body.maxWait) ? Math.min(120, Math.max(5, body.maxWait)) : null;
        // Allow clearing by passing null/empty.
        const finalKey = apiKey || null;
        const finalModel = model || null;
        await env.DB.prepare("UPDATE users SET gemini_api_key = ?, gemini_model = ?, gemini_max_wait = ?, updated_at = ? WHERE id = ?")
          .bind(finalKey, finalModel, maxWait, now(), session.user.id).run();
        return json({ ok: true, hasKey: !!finalKey }, 200, origin);
      }
      if (request.method === "DELETE" && url.pathname === "/v1/account/gemini-key") {
        await env.DB.prepare("UPDATE users SET gemini_api_key = NULL, gemini_model = NULL, gemini_max_wait = NULL, updated_at = ? WHERE id = ?")
          .bind(now(), session.user.id).run();
        return json({ ok: true }, 200, origin);
      }
      // POST /v1/account/gemini/proxy { model?, endpoint, body }
      // Server-side proxy for Gemini API calls. Uses the user's stored key.
      // `endpoint` is one of "generateContent" | "streamGenerateContent" | "models"
      // (for "models" the URL is just /v1beta/models — body is ignored).
      if (request.method === "POST" && url.pathname === "/v1/account/gemini/proxy") {
        const row = await env.DB.prepare("SELECT gemini_api_key, gemini_model FROM users WHERE id = ?").bind(session.user.id).first();
        if (!row?.gemini_api_key) return json({ error: "No Gemini API key saved. Add one in Settings." }, 400, origin);
        const body = await readJson(request);
        const endpoint = typeof body.endpoint === "string" ? body.endpoint : "generateContent";
        const model = (typeof body.model === "string" && body.model.trim()) || row.gemini_model || "gemini-2.5-flash";
        if (!/^[a-zA-Z0-9._-]+$/.test(model)) return json({ error: "Invalid model name" }, 400, origin);
        if (!/^(generateContent|streamGenerateContent|countTokens)$/.test(endpoint)) {
          // Treat unknown endpoints as a "models" listing.
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(row.gemini_api_key)}`, {
            method: "GET",
            headers: { "content-type": "application/json" },
          });
          const text = await r.text();
          return new Response(text, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", ...cors(origin) } });
        }
        const url2 = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${encodeURIComponent(row.gemini_api_key)}`;
        const r = await fetch(url2, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body.body ?? {}),
        });
        const text = await r.text();
        return new Response(text, {
          status: r.status,
          headers: {
            "content-type": r.headers.get("content-type") || "application/json",
            "cache-control": "no-store",
            ...cors(origin),
            ...SECURITY_HEADERS,
          },
        });
      }

      // ── Sync ──
      if (request.method === "GET" && url.pathname === "/v1/sync") {
        return json({ qbank: await getDocument(env, session.user.id, "qbank"), flashcards: await getDocument(env, session.user.id, "flashcards") }, 200, origin);
      }
      if (request.method === "PUT" && url.pathname === "/v1/sync") {
        const body = await readJson(request); const statements = []; const response = {};
        for (const kind of ["qbank", "flashcards"]) {
          if (!body[kind] || typeof body[kind] !== "object") continue;
          const local = body[kind].records;
          if (!local || typeof local !== "object" || Array.isArray(local)) return json({ error: "Invalid progress document" }, 400, origin);
          // Use byte length, not string length, so UTF-8 multi-byte characters
          // don't sneak past the limit and bloat the D1 row past the 1 MiB cap.
          const bytes = new TextEncoder().encode(JSON.stringify(local)).length;
          if (bytes > MAX_DOCUMENT_BYTES) return json({ error: "Progress document is too large" }, 400, origin);
          const current = await getDocument(env, session.user.id, kind);
          const records = kind === "qbank" ? mergeQbank(current.records, local) : mergeFlashcards(current.records, local);
          const updatedAt = now(); response[kind] = { records, updatedAt };
          statements.push(env.DB.prepare("INSERT INTO progress_documents (user_id, kind, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").bind(session.user.id, kind, JSON.stringify(records), updatedAt));
        }
        if (statements.length) await env.DB.batch(statements);
        return json(response, 200, origin);
      }
      return json({ error: "Not found" }, 404, origin);
    } catch (error) {
      console.error(error);
      const isUserError = error instanceof Error && (error.message.includes("Invalid") || error.message.includes("too large") || error.message.includes("required") || error.message.includes("already in use"));
      return json({ error: isUserError ? error.message : "Internal server error" }, isUserError ? 400 : 500, origin);
    }
  },
};
