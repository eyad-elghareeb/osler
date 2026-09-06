// Designed, email-client-safe HTML templates for Osler's transactional emails.
// Rendered as table-based layouts with inline CSS only (Outlook/Gmail safe),
// delivered through one of two interchangeable providers. No images, no
// tracking pixels — text + brand colors only, so every template renders
// offline and unblocks nothing.
//
// Provider precedence (sendEmail):
//   1. EMAIL_WORKER_URL + EMAIL_WORKER_TOKEN — the Gmail SMTP relay worker
//      (cloudflare/email-worker): mail goes out from a plain Gmail account
//      via SMTP, no custom domain or DNS records needed.
//   2. RESEND_API_KEY + EMAIL_FROM — the Resend API (branded domain sending).

export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Gmail relay worker (cloudflare/email-worker) base URL. */
  EMAIL_WORKER_URL?: string;
  /** Shared bearer token the relay worker validates (its EMAIL_TOKEN). */
  EMAIL_WORKER_TOKEN?: string;
  /** Optional service binding to the relay worker (same-account deploys).
   *  Requests travel over Cloudflare's private network — never the public
   *  internet — and the binding cannot be created by another account. */
  EMAIL?: Fetcher;
}

/** True when at least one delivery provider is fully configured. The auth
 *  endpoints gate their email branches on this instead of poking at
 *  individual provider vars. */
export function emailProviderReady(env: EmailEnv): boolean {
  if (env.EMAIL) return true;
  if (env.EMAIL_WORKER_URL && env.EMAIL_WORKER_TOKEN) return true;
  return !!(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function emailProviderName(env: EmailEnv): "binding" | "relay" | "resend" {
  if (env.EMAIL) return "binding";
  if (env.EMAIL_WORKER_URL && env.EMAIL_WORKER_TOKEN) return "relay";
  return "resend";
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const BRAND_NAVY = "#1E2A52";
const BODY_BG = "#F2F4F8";
const TEXT = "#1F2937";
const MUTED = "#4B5563";
const FAINT = "#6B7280";
const CODE = "#9CA3AF";
const DIVIDER = "#E5E7EB";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

interface ShellOptions {
  preheader: string;
  heading: string;
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  noteHtml: string;
}

function renderShell({ preheader, heading, bodyHtml, buttonLabel, buttonUrl, noteHtml }: ShellOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:${BODY_BG};font-family:${FONT};">
  <span style="display:none!important;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BODY_BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="background:${BRAND_NAVY};border-radius:16px 16px 0 0;padding:28px 32px 24px;">
              <span style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">Osler</span>
              <span style="font-size:11px;color:${CODE};margin-left:10px;letter-spacing:1.5px;text-transform:uppercase;">Medical study companion</span>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;padding:32px 32px 8px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${TEXT};font-weight:700;">${heading}</h1>
              ${bodyHtml}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:8px;background:${BRAND_NAVY};">
                    <a href="${buttonUrl}" style="display:inline-block;padding:13px 32px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${buttonLabel}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:${FAINT};">If the button does not work, copy and paste this link into your browser:<br/><a href="${buttonUrl}" style="color:${BRAND_NAVY};word-break:break-all;">${buttonUrl}</a></p>
              <hr style="border:none;border-top:1px solid ${DIVIDER};margin:0 0 20px;"/>
              ${noteHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:0 0 16px 16px;padding:4px 32px 28px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${CODE};">Osler &middot; Study smarter, not harder</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function passwordResetEmail(link: string, expiresInLabel = "30 minutes"): RenderedEmail {
  const html = renderShell({
    preheader: "Reset your Osler password — the link expires in 30 minutes.",
    heading: "Reset your password",
    bodyHtml: `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">We received a request to reset the password for your Osler account. Use the button below to choose a new password.</p>`,
    buttonLabel: "Reset password",
    buttonUrl: link,
    noteHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:${FAINT};">This link expires in <strong style="color:${TEXT};">${expiresInLabel}</strong> and can only be used once. If you did not request a password reset, you can safely ignore this email — your password will not be changed.</p>`,
  });
  const text = [
    "Reset your Osler password",
    "",
    "We received a request to reset the password for your Osler account. Use the link below within 30 minutes to choose a new password:",
    "",
    link,
    "",
    "This link can only be used once. If you did not request a password reset, you can safely ignore this email — your password will not be changed.",
    "",
    "- Osler",
  ].join("\n");
  return { html, text };
}

export function verifyEmail(link: string, expiresInLabel = "30 minutes"): RenderedEmail {
  const html = renderShell({
    preheader: "Confirm your email address for your Osler account.",
    heading: "Confirm your email address",
    bodyHtml: `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">You created an Osler account with this email address. Confirm it below so you can receive exam results and account notifications.</p>`,
    buttonLabel: "Confirm email",
    buttonUrl: link,
    noteHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:${FAINT};">This link expires in <strong style="color:${TEXT};">${expiresInLabel}</strong> and can only be used once. If you did not create an Osler account, you can safely ignore this email.</p>`,
  });
  const text = [
    "Confirm your email address",
    "",
    "You created an Osler account with this email address. Use the link below within 30 minutes to confirm it:",
    "",
    link,
    "",
    "This link can only be used once. If you did not create an Osler account, you can safely ignore this email.",
    "",
    "- Osler",
  ].join("\n");
  return { html, text };
}

/** Branded test email for the admin Email page ("Send test email"). */
export function testEmail(): RenderedEmail {
  const html = renderShell({
    preheader: "This is a test email from your Osler instance.",
    heading: "Email is working",
    bodyHtml: `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${MUTED};">This is a test email sent from your Osler instance's admin panel. If you are reading this in your inbox, transactional email (password resets, address verification) is delivered correctly.</p>`,
    buttonLabel: "Open Osler",
    buttonUrl: "https://osler",
    noteHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:${FAINT};">You received this because an administrator used the "Send test email" action.</p>`,
  });
  const text = [
    "Osler test email",
    "",
    "This is a test email sent from your Osler instance's admin panel. Transactional email is delivered correctly.",
    "",
    "- Osler",
  ].join("\n");
  return { html, text };
}

export async function sendEmail(
  env: EmailEnv,
  db: D1Database | null,
  opts: { to: string; subject: string; text: string; html: string },
): Promise<Response> {
  try {
    const res = await deliver(env, opts);
    await logDelivery(db, env, opts, res.ok ? "sent" : "failed", res.ok ? null : `HTTP ${res.status}`);
    return res;
  } catch (error) {
    await logDelivery(db, env, opts, "failed", String(error).slice(0, 300));
    throw error;
  }
}

async function deliver(env: EmailEnv, opts: { to: string; subject: string; text: string; html: string }): Promise<Response> {
  const body = JSON.stringify({ to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
  const headers = { "content-type": "application/json" };

  // 1. Service binding (preferred): traffic rides Cloudflare's private
  //    network and can only originate from a Worker on the SAME account —
  //    no public internet hop, and the relay's URL never needs to exist.
  if (env.EMAIL) {
    return env.EMAIL.fetch("https://osler-email/send", {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${env.EMAIL_WORKER_TOKEN ?? ""}` },
      body,
    });
  }

  // 2. Relay worker over the public internet (cross-account / URL mode).
  if (env.EMAIL_WORKER_URL && env.EMAIL_WORKER_TOKEN) {
    const base = env.EMAIL_WORKER_URL.replace(/\/$/, "");
    return fetch(`${base}/send`, {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${env.EMAIL_WORKER_TOKEN}` },
      body,
    });
  }

  // 3. Resend (branded domain sending).
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, ...headers },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [opts.to], subject: opts.subject, text: opts.text, html: opts.html }),
  });
}

/** Best-effort delivery log for the admin Email page. Never throws — a
 *  logging failure must not break (or duplicate-fail) the send itself.
 *  Bodies and links are deliberately NOT stored: reset links are
 *  bearer-equivalent secrets, and the log only needs accountability. */
async function logDelivery(
  db: D1Database | null,
  env: EmailEnv,
  opts: { to: string; subject: string },
  status: "sent" | "failed",
  error: string | null,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare("INSERT INTO email_log (id, to_address, subject, provider, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), opts.to, opts.subject, emailProviderName(env), status, error, Date.now())
      .run();
  } catch {
    /* ignore */
  }
}