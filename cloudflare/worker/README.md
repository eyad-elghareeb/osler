# Osler Cloud Worker

This Worker provides optional email/password accounts, role-ready authorization, password reset, and local-first QBank/flashcard sync. It needs only Workers + D1 on Cloudflare's free tier.

1. Create the D1 database: `npx wrangler d1 create osler-cloud`, then place its id in `wrangler.toml`.
2. Copy `.dev.vars.example` to `.dev.vars`, set `JWT_SECRET`, then deploy the secret with `npx wrangler secret put JWT_SECRET`.
3. Apply the schema with `npm run db:migrate` and deploy with `npm run deploy`.
4. Set `ALLOWED_ORIGIN` to the exact Osler app origin and paste the deployed URL into `public/osler.config.json` → `cloud.apiUrl`.

Turnstile is optional but recommended for public registration. Set `TURNSTILE_ENABLED=true`, configure the two Turnstile keys, and put the public site key in the frontend config. Password-reset email is enabled only if a Resend free-tier API key, sender, and `APP_ORIGIN` are supplied; accounts without an email cannot reset their password.

The Worker batches sync into two documents and merges each record by its local timestamp. This minimizes D1 writes and lets local IndexedDB remain usable offline.
