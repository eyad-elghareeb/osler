// Osler Gmail relay worker — sends transactional email through Gmail's SMTP
// servers from a standalone Cloudflare Worker, using only a Gmail account +
// App Password. No custom domain, no SPF/DKIM/DMARC records, no Resend.
//
// The main Osler Worker calls this worker server-to-server:
//   POST /send   { to, subject, text, html }   Authorization: Bearer EMAIL_TOKEN
//
// EMAIL_TOKEN is REQUIRED. Without it, anyone who discovers the URL could
// relay mail through your Gmail account (a one-way ticket to a suspended
// account). It is a shared secret set on BOTH workers:
//   this worker  → wrangler secret put EMAIL_TOKEN
//   main worker  → wrangler secret put EMAIL_WORKER_TOKEN
//
// Why the SMTP conversation is more careful than a textbook example:
//   * SMTP replies can be split across TCP packets and multiline (EHLO
//     returns "250-…" continuation lines) — replies are read until a line
//     matching /^\d{3} / terminates.
//   * socket.startTls() returns a NEW socket: readers/writers must be
//     re-bound to the TLS socket afterwards.
//   * Message parts are base64-encoded (RFC 2045/2047): Arabic subjects and
//     bodies survive intact, and base64 lines can never start with a bare
//     ".", which sidesteps SMTP dot-stuffing entirely.

import { connect } from "cloudflare:sockets";

export interface Env {
  /** Gmail address to send from (e.g. you@gmail.com). */
  GMAIL_USER: string;
  /** Gmail App Password (16 chars, spaces optional). NOT the account password. */
  GMAIL_APP_PASSWORD: string;
  /** Shared secret the main Osler Worker must present as Bearer token. */
  EMAIL_TOKEN: string;
  /** Optional display name on outgoing mail (default "Osler"). */
  FROM_NAME?: string;
}

/** The TCP socket returned by connect()/startTls(). */
type SmtpSocket = ReturnType<typeof connect>;

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const MAX_BODY_BYTES = 1_000_000;

interface SmtpConn {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  socket: SmtpSocket;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeConn(socket: SmtpSocket): SmtpConn {
  return {
    socket,
    reader: socket.readable.getReader(),
    writer: socket.writable.getWriter(),
  };
}

/** Read one complete SMTP reply. Keeps a text buffer across chunks and only
 *  returns once the last complete line is a terminator (`250 OK`), not a
 *  continuation (`250-PIPELINING`). */
function makeReplyReader(conn: SmtpConn) {
  let buf = "";
  return async function readReply(): Promise<string> {
    for (;;) {
      const lastCrlf = buf.lastIndexOf("\r\n");
      if (lastCrlf !== -1) {
        const complete = buf.slice(0, lastCrlf);
        const done = complete.split("\r\n").pop() ?? "";
        if (/^\d{3} /.test(done)) {
          buf = buf.slice(lastCrlf + 2);
          return complete;
        }
      }
      const { value, done } = await conn.reader.read();
      if (done) throw new Error(`SMTP connection closed mid-reply (got: ${buf.slice(0, 200)})`);
      buf += decoder.decode(value, { stream: true });
    }
  };
}

async function writeCmd(conn: SmtpConn, cmd: string): Promise<void> {
  await conn.writer.write(encoder.encode(cmd + "\r\n"));
}

/** Send a command and assert the reply starts with one of the accepted codes. */
async function command(conn: SmtpConn, readReply: () => Promise<string>, cmd: string, okCodes: [number, ...number[]], label: string): Promise<string> {
  await writeCmd(conn, cmd);
  const reply = await readReply();
  const code = Number(reply.slice(0, 3));
  if (!okCodes.includes(code)) {
    throw new Error(`${label} failed (${reply.slice(0, 200) || "no reply"})`);
  }
  return reply;
}

/** Constant-time-enough equality for the shared bearer token. */
function tokenMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** RFC 2047: encode a header value as =?UTF-8?B?…?= so Arabic subjects
 *  survive every relay. */
function encodeHeaderValue(value: string): string {
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

/** RFC 2045 base64 with 76-char lines (btoa output is a single long line). */
function base64Wrapped(input: string): string {
  const raw = btoa(unescape(encodeURIComponent(input)));
  return (raw.match(/.{1,76}/g) ?? []).join("\r\n");
}

function buildMessage(env: Env, to: string, subject: string, text: string, html?: string): string {
  const boundary = `osler-${crypto.randomUUID().replace(/-/g, "")}`;
  const from = env.FROM_NAME ? `${encodeHeaderValue(env.FROM_NAME)} <${env.GMAIL_USER}>` : env.GMAIL_USER;
  const headers = [
    `From: ${from}`,
    `To: <${to}>`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${env.GMAIL_USER.split("@")[1] ?? "gmail"}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join("\r\n");

  const textPart = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Wrapped(text),
  ].join("\r\n");

  const htmlPart = html
    ? [
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64Wrapped(html),
      ].join("\r\n")
    : null;

  const body = htmlPart ? `${textPart}\r\n${htmlPart}` : textPart;
  return `${headers}\r\n\r\n${body}\r\n--${boundary}--`;
}

/** Basic header-injection guard: RCPT/headers must be a single clean address. */
function cleanAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const to = raw.trim();
  if (!/^[^\s@<>,;:"']+@[^\s@<>,;:"']+\.[^\s@<>,;:"']+$/.test(to)) return null;
  return to;
}

async function handleSend(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.EMAIL_TOKEN}`;
  if (!tokenMatches(auth, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = cleanAddress(payload.to);
  const subject = typeof payload.subject === "string" ? payload.subject.slice(0, 500) : "";
  const text = typeof payload.text === "string" ? payload.text.slice(0, MAX_BODY_BYTES) : "";
  const html = typeof payload.html === "string" ? payload.html.slice(0, MAX_BODY_BYTES) : undefined;
  if (!to || !subject || (!text && !html)) {
    return Response.json({ error: "Missing or invalid fields: to, subject, text/html" }, { status: 400 });
  }

  const message = buildMessage(env, to, subject, text || html!.replace(/<[^>]+>/g, " "), html);
  const messageBytes = encoder.encode(message);
  if (messageBytes.length > 25_000_000) {
    return Response.json({ error: "Message too large" }, { status: 413 });
  }

  let conn: SmtpConn | null = null;
  try {
    conn = makeConn(
      connect({ hostname: SMTP_HOST, port: SMTP_PORT }, { secureTransport: "starttls", allowHalfOpen: false }),
    );
    let readReply = makeReplyReader(conn);

    await readReply(); // 220 greeting
    await command(conn, readReply, "EHLO osler", [250], "EHLO");
    await command(conn, readReply, "STARTTLS", [220], "STARTTLS");

    // startTls() returns a NEW socket — every reader/writer must re-bind to it.
    conn = makeConn(conn.socket.startTls());
    readReply = makeReplyReader(conn);

    await command(conn, readReply, "EHLO osler", [250], "EHLO (TLS)");

    const authBlob = btoa(`\x00${env.GMAIL_USER}\x00${env.GMAIL_APP_PASSWORD}`);
    await command(conn, readReply, `AUTH PLAIN ${authBlob}`, [235], "AUTH");

    await command(conn, readReply, `MAIL FROM:<${env.GMAIL_USER}> BODY=8BITMIME`, [250], "MAIL FROM");
    await command(conn, readReply, `RCPT TO:<${to}>`, [250, 251], "RCPT TO");
    await command(conn, readReply, "DATA", [354], "DATA");

    // Dot-stuffing at the string level (RFC 5321 §4.5.2): a data line starting
    // with "." becomes ".." so the terminating "\r\n.\r\n" can't appear early.
    // Header and base64 lines never start with "." — this guard is purely
    // defensive.
    const stuffedMessage = message.replace(/\r\n\./g, "\r\n..");
    const dataBytes = encoder.encode(stuffedMessage + "\r\n.\r\n");
    await conn.writer.write(dataBytes);
    const sentReply = await readReply();
    if (!sentReply.startsWith("250")) {
      throw new Error(`Message rejected (${sentReply.slice(0, 200)})`);
    }

    await writeCmd(conn, "QUIT").catch(() => {});
    try {
      await conn.reader.cancel();
      conn.socket.close();
    } catch {
      /* socket already closing */
    }
    conn = null;

    return Response.json({ sent: true });
  } catch (error) {
    try {
      conn?.socket.close();
    } catch {
      /* already closed */
    }
    return Response.json({ error: String(error).slice(0, 300) }, { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, from: env.GMAIL_USER ?? null });
    }
    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
