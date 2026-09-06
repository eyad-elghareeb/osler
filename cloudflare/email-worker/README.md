# Osler Gmail Email Worker

A standalone Cloudflare Worker that sends Osler's transactional email (password resets, address verification) through **Gmail's SMTP servers** using only a Gmail account and an App Password.

No custom domain needed at all. The Gmail SMTP approach works with just a Gmail account — no DNS records, no domain registration, nothing.

| What you need | What you DON'T need |
|---|---|
| A Gmail account | A custom domain |
| 2FA turned on in Google | SPF/DKIM/DMARC records |
| A Gmail App Password | Any DNS configuration |
| A Cloudflare Worker | To pay for an email service |

The trade-off: emails will be sent from `yourname@gmail.com`. Recipients will see it came from Gmail. You cannot make it look like it came from `@yourbrand.com` without owning that domain — that is what the Resend path is for.

---

## 1. Create the Gmail App Password

1. Enable **2-Step Verification** on the Google account: <https://myaccount.google.com/security>
2. Create an **App password**: <https://myaccount.google.com/apppasswords> → name it `osler` → copy the 16-character password.

Keep both values:

| Value | Example |
|---|---|
| Gmail address | `you@gmail.com` |
| App password | `abcd efgh ijkl mnop` (spaces are fine to keep) |

---

## 2. Deploy this worker

```bash
cd cloudflare/email-worker
npm install

npx wrangler secret put GMAIL_USER            # you@gmail.com
npx wrangler secret put GMAIL_APP_PASSWORD    # the 16-char app password
npx wrangler secret put EMAIL_TOKEN           # generate: openssl rand -base64 32
npx wrangler deploy
```

`EMAIL_TOKEN` is a **shared secret you invent** — the main Osler Worker must present it as a Bearer token, otherwise anyone who finds this worker's URL could relay mail through your Gmail account. Do not skip it.

**Verify:**

```bash
curl https://osler-email.<account>.workers.dev/health
# → {"ok":true,"from":"you@gmail.com"}
```

---

## 3. Wire the main Osler Worker to it

On the **main** `osler-cloud` Worker, set the two matching values (the URL of this worker and the same `EMAIL_TOKEN`):

```bash
cd cloudflare/worker
npx wrangler secret put EMAIL_WORKER_URL     # https://osler-email.<account>.workers.dev
npx wrangler secret put EMAIL_WORKER_TOKEN   # same value as EMAIL_TOKEN above
npx wrangler deploy
```

Precedence in the main Worker: `EMAIL_WORKER_URL` + `EMAIL_WORKER_TOKEN` (Gmail relay) → `RESEND_API_KEY` + `EMAIL_FROM` (Resend) → email disabled. Set one or the other, not both. Osler's own `EMAIL_FROM` is not used on the Gmail path — mail is sent from the Gmail address (optionally with a display name via this worker's `FROM_NAME` secret).

Optional — give the mail a friendly sender name:

```bash
npx wrangler secret put FROM_NAME            # e.g. "Osler — Your School"
```

---

## 4. Test it end to end

```bash
curl -X POST https://osler-email.<account>.workers.dev/send \
  -H "Authorization: Bearer <EMAIL_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"to":"you@gmail.com","subject":"Osler test","text":"It works."}'
# → {"sent":true}
```

Then in the app: request a password reset for an existing account — the branded Osler email should arrive from your Gmail address.

---

## Endpoint reference

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness + sender address (no secrets) |
| `POST /send` | `Bearer EMAIL_TOKEN` | `{ to, subject, text, html? }` → `{ sent: true }` |

Implementation notes (`src/index.ts`): SMTP over `cloudflare:sockets` with STARTTLS to `smtp.gmail.com:587`; replies are read until a complete terminator line (handles multiline `250-…` EHLO responses and packet fragmentation); the reader/writer pair is re-bound to the socket returned by `startTls()`; message parts are base64-encoded per RFC 2045/2047 so Arabic subjects and bodies survive every relay (and base64 lines can never start with a bare `.`, which sidesteps SMTP dot-stuffing); `AUTH PLAIN` uses `\x00user\x00app-password`; every reply code is asserted and failures close the socket and surface as a `502`.

Gmail's own sending limits apply (≈ 500 recipients/day on a free account) — this worker only sends Osler's low-volume transactional mail.
