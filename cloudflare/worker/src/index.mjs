// Implementation plan: secure Google OAuth, account controls, and durable sync.
// This temporary note is removed before commit.
const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 310_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 900_000;
const OAUTH_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
let googleKeys = { expiresAt: 0, keys: [] };

const json = (body, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...cors(origin) },
});
const cors = (origin) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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

export default {
  async fetch(request, env) {
    const origin = requestOrigin(request, env);
    if (origin === null) return json({ error: "Origin is not allowed" }, 403, "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (!env.DB || !env.JWT_SECRET) return json({ error: "Worker is not configured" }, 503, origin);
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") return json({ ok: true, googleEnabled: googleReady(env) }, 200, origin);
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
        const body = await readJson(request);
        const ticket = typeof body.ticket === "string" ? body.ticket : "";
        const handoff = ticket && await env.DB.prepare("SELECT * FROM auth_handoffs WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(ticket), now()).first();
        if (!handoff) return json({ error: "This sign-in link is invalid or expired" }, 400, origin);
        await env.DB.prepare("UPDATE auth_handoffs SET used_at = ? WHERE id = ?").bind(now(), handoff.id).run();
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(handoff.user_id).first();
        return json(await issueSession(user, env), 200, origin);
      }
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
          await env.DB.prepare("INSERT INTO users (id, username, email, display_name, password_hash, password_salt, has_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
            .bind(userId, username, email, displayName, password.hash, password.salt, now(), now()).run();
        } catch { return json({ error: "That username or email is already in use" }, 409, origin); }
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
        return json(await issueSession(user, env), 201, origin);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/login") {
        const body = await readJson(request); const identifier = String(body.identifier || "").trim();
        if (!identifier || !validPassword(body.password)) return json({ error: "Invalid username or password" }, 401, origin);
        if (!await verifyTurnstile(body.turnstileToken, request, env)) return json({ error: "Verification failed" }, 400, origin);
        const user = await env.DB.prepare("SELECT * FROM users WHERE has_password = 1 AND (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE)").bind(identifier, identifier).first();
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
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(password.hash, password.salt, now(), row.user_id),
          env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").bind(now(), row.id),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), row.user_id),
        ]);
        return json({ ok: true }, 200, origin);
      }
      const session = await requireUser(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, origin);
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
        if (!validPassword(body.password)) return json({ error: "Password must be at least 10 characters" }, 400, origin);
        if (Number(session.user.has_password ?? 1) === 1 && !await passwordMatches(String(body.currentPassword || ""), session.user.password_salt, session.user.password_hash)) return json({ error: "Current password is incorrect" }, 401, origin);
        const password = await passwordHash(body.password);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, has_password = 1, updated_at = ? WHERE id = ?").bind(password.hash, password.salt, now(), session.user.id),
          env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now(), session.user.id),
        ]);
        return json(await issueSession(await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(session.user.id).first(), env), 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/v1/account/export") return json({ account: await accountPayload(env, session.user), progress: { qbank: await getDocument(env, session.user.id, "qbank"), flashcards: await getDocument(env, session.user.id, "flashcards") }, exportedAt: now() }, 200, origin);
      if (request.method === "DELETE" && url.pathname === "/v1/account") {
        const body = await readJson(request);
        if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm account deletion" }, 400, origin);
        if (Number(session.user.has_password ?? 1) === 1 && !await passwordMatches(String(body.password || ""), session.user.password_salt, session.user.password_hash)) return json({ error: "Current password is incorrect" }, 401, origin);
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(session.user.id).run();
        return json({ ok: true }, 200, origin);
      }
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
