const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 310_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 900_000;

const json = (body, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...cors(origin) },
});
const cors = (origin) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
  vary: "Origin",
});
const now = () => Date.now();
const id = () => crypto.randomUUID();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const unb64url = (value) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)), (char) => char.charCodeAt(0));

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
function validUsername(value) { return typeof value === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(value); }
function validEmail(value) { return !value || (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254); }
function validPassword(value) { return typeof value === "string" && value.length >= 10 && value.length <= 200; }
function publicUser(user) { return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, email: user.email ?? null }; }

function requestOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!origin || origin === env.ALLOWED_ORIGIN) return origin || env.ALLOWED_ORIGIN;
  return null;
}
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
async function issueSession(user, env) {
  const sessionId = id();
  const expiresAt = now() + SESSION_TTL_MS;
  const payload = b64url(encoder.encode(JSON.stringify({ sub: user.id, sid: sessionId, role: user.role, exp: Math.floor(expiresAt / 1000) })));
  const token = `${payload}.${await hmac(payload, env.JWT_SECRET)}`;
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

export default {
  async fetch(request, env) {
    const origin = requestOrigin(request, env);
    if (origin === null) return json({ error: "Origin is not allowed" }, 403, "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (!env.DB || !env.JWT_SECRET) return json({ error: "Worker is not configured" }, 503, origin);
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") return json({ ok: true }, 200, origin);
      if (request.method === "GET" && url.pathname === "/v1/auth/username-available") {
        const username = url.searchParams.get("username")?.trim() || "";
        if (!validUsername(username)) return json({ available: false }, 200, origin);
        const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
        return json({ available: !existing }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/register") {
        const body = await readJson(request);
        const username = String(body.username || "").trim();
        const email = body.email ? String(body.email).trim().toLowerCase() : null;
        const displayName = String(body.displayName || username).trim().slice(0, 80);
        if (!validUsername(username) || !validEmail(email) || !validPassword(body.password) || !displayName) return json({ error: "Invalid registration details" }, 400, origin);
        if (!await verifyTurnstile(body.turnstileToken, request, env)) return json({ error: "Verification failed" }, 400, origin);
        const userId = id(); const password = await passwordHash(body.password);
        try {
          await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(userId, username, email, displayName, password.hash, password.salt, now(), now()).run();
        } catch { return json({ error: "That username or email is already in use" }, 409, origin); }
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
        return json(await issueSession(user, env), 201, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/login") {
        const body = await readJson(request); const identifier = String(body.identifier || "").trim();
        if (!identifier || !validPassword(body.password)) return json({ error: "Invalid username or password" }, 401, origin);
        if (!await verifyTurnstile(body.turnstileToken, request, env)) return json({ error: "Verification failed" }, 400, origin);
        const user = await env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE").bind(identifier, identifier).first();
        if (!user || !await passwordMatches(body.password, user.password_salt, user.password_hash)) return json({ error: "Invalid username or password" }, 401, origin);
        return json(await issueSession(user, env), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
        const session = await requireUser(request, env); if (session) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(now(), session.sessionId).run();
        return json({ ok: true }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/request") {
        const body = await readJson(request); const email = String(body.email || "").trim().toLowerCase();
        if (validEmail(email) && await verifyTurnstile(body.turnstileToken, request, env)) {
          const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").bind(email).first();
          if (user && env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_ORIGIN) {
            const token = `${id()}${id()}`; const expiresAt = now() + RESET_TTL_MS;
            await env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(id(), user.id, await sha256(token), expiresAt, now()).run();
            const link = `${env.APP_ORIGIN.replace(/\/$/, "")}/?reset=${encodeURIComponent(token)}`;
            await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [user.email], subject: "Reset your Osler password", html: `<p>Use this link within 30 minutes to reset your password:</p><p><a href="${link}">${link}</a></p>` }) });
          }
        }
        return json({ ok: true }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/reset/confirm") {
        const body = await readJson(request); if (typeof body.token !== "string" || !validPassword(body.password)) return json({ error: "Invalid reset request" }, 400, origin);
        const row = await env.DB.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(body.token), now()).first();
        if (!row) return json({ error: "This reset link is invalid or expired" }, 400, origin);
        const password = await passwordHash(body.password);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?").bind(password.hash, password.salt, now(), row.user_id),
          env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").bind(now(), row.id),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), row.user_id),
        ]);
        return json({ ok: true }, 200, origin);
      }
      const session = await requireUser(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, origin);
      if (request.method === "GET" && url.pathname === "/v1/auth/me") return json({ user: publicUser(session.user) }, 200, origin);
      if (request.method === "GET" && url.pathname === "/v1/sync") {
        return json({ qbank: await getDocument(env, session.user.id, "qbank"), flashcards: await getDocument(env, session.user.id, "flashcards") }, 200, origin);
      }
      if (request.method === "PUT" && url.pathname === "/v1/sync") {
        const body = await readJson(request); const statements = []; const response = {};
        for (const kind of ["qbank", "flashcards"]) {
          if (!body[kind] || typeof body[kind] !== "object") continue;
          const local = body[kind].records;
          if (!local || typeof local !== "object" || Array.isArray(local) || JSON.stringify(local).length > MAX_DOCUMENT_BYTES) return json({ error: "Invalid progress document" }, 400, origin);
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
      console.error(error); return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 400, origin);
    }
  },
};
