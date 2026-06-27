# Bring Your Own Firebase

V2 self-hosting means "bring your own Firebase project". This page walks a
self-hoster through creating a Firebase project, enabling the required
services, configuring security rules, and pasting the config into the
generator wizard.

If you're deploying a site in **None** auth mode (no Firebase), you can skip
this page entirely. Firebase is only required for **Firebase** mode (multi-user
sync + AI tutor).

## Why "bring your own"?

Osler V2 explicitly avoids running a central Firebase project for all
self-hosters (see v2 plan K2). Reasons:

- **Data control** — your users' study progress lives in YOUR Firebase
  project, not Osler's. You can export, audit, or delete it any time.
- **Cost control** — Firebase free tier covers ~10K users. If you exceed
  that, you pay Firebase directly (not Osler).
- **Trust** — users who don't trust the official Osler deployment can
  self-host with their own Firebase project and verify the rules
  themselves.
- **Compliance** — for medical education use cases with regional data
  residency requirements, you can pick a Firebase project in the right
  region.

The trade-off: you're responsible for the project. If you forget to pay the
Firebase bill, your users lose sync. Back up your Firebase project
configuration.

## What you get

With Firebase configured, your generated site gains:

- **Multi-user auth** — users sign in via guest → Google → GitHub. Account
  linking preserves guest data on OAuth upgrade.
- **Cross-device sync** — study progress (quiz/bank/flashcard/written/osce
  trackers, streaks) syncs across all devices signed in as the same user.
- **User custom content sync** — content users author in the PWA syncs to
  their Firestore, available on all their devices.
- **AI tutor** (Phase 12) — chat modal scoped to the current item, calling
  Gemini with cost caps.

## What you DON'T get

V2 explicitly does NOT add (see v2 plan §5 anti-goals):

- Orgs / teams / multi-user tenancy beyond personal accounts
- A public content registry
- Real-time collaboration on content authoring
- RAG-based AI tutor with embeddings
- Cloud Functions for server-side logic (V1's rate limiting is client-side)
- Air-gapped self-hosting (use V1 static mode for that)

## Creating a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com/).
2. Click **Add project**.
3. Enter a project name (e.g. `osler-my-school`).
4. Google Analytics: enable (recommended — gives you the Analytics tab in
   the admin dashboard). Accept the terms.
5. Wait for project creation (~30 seconds).
6. Note the **project ID** — you'll need it later.

## Enabling services

### Authentication

1. In the Firebase console, go to **Build → Authentication → Get started**.
2. Enable Email/Password (used for guest upgrades), Google, and GitHub.
3. For Google: enter a support email and save.
4. For GitHub: you'll need a GitHub OAuth App (see below).
5. Go to **Settings → Authorized domains** and add:
   - `localhost` (for local preview)
   - `127.0.0.1` (for local preview)
   - Your deployed site's domain (e.g. `https://your-site.netlify.app` —
     without the `https://` prefix)

#### Creating a GitHub OAuth App

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
   → OAuth Apps → New OAuth App.
2. Application name: `Osler — {your site name}`
3. Homepage URL: `https://your-site.netlify.app`
4. Authorization callback URL:
   `https://{your-project-id}.firebaseapp.com/__/auth/handler`
5. Click **Register application**.
6. Note the Client ID and Client Secret.
7. Back in the Firebase console → Authentication → Sign-in method → GitHub:
   paste the Client ID and Client Secret.
8. Enable GitHub sign-in.

### Firestore Database

1. Go to **Build → Firestore Database → Create database**.
2. Start in **production mode** (security rules in next step).
3. Pick a location close to your users (e.g. `us-central1` for North America,
   `europe-west1` for EU, `asia-northeast1` for Japan).
4. Wait for provisioning (~1 minute).

The database will be empty — the security rules (next) control access.

### Storage

1. Go to **Build → Storage → Get started**.
2. Pick the same location as Firestore.
3. Wait for provisioning (~1 minute).

Storage is used for exported content pack files (V2 — optional, only if you
want users to be able to upload packs to the cloud for sharing via URL).

### Analytics (already enabled if you opted in during project creation)

1. Go to **Analytics → Dashboard**.
2. Wait ~24 hours for the first data to appear.

The admin dashboard's Analytics tab uses this data (via a service account —
see [Settings → Firebase](../admin-dashboard/settings.md#firebase)).

## Configuring security rules

### Firestore rules

Replace the default rules with Osler's V2 rules. Copy from
[Firebase → Firestore Rules](firestore-rules.md) and paste into the Firebase
console → Firestore → Rules → Publish.

The rules enforce:

- `users/{uid}/trackers/*` — owner-only read/write
- `users/{uid}/streaks/*` — owner-only read/write
- `userContent/{uid}/items/{itemId}` — owner-only read/write
- `events/{eventId}` — authenticated create-only

### Storage rules

Replace the default rules with Osler's V2 rules. Copy from
[Firebase → Storage Rules](storage-rules.md) and paste into the Firebase
console → Storage → Rules → Publish.

The rules enforce:

- `userContent/{uid}/{filename}` — owner-only read/write
- All other paths: deny

## Getting the config

1. In the Firebase console, click the gear icon next to **Project Overview**
   → **Project settings**.
2. Scroll to **Your apps** → click the `</>` (Web) icon to add a web app.
3. Enter an app nickname (e.g. `osler-pwa`).
4. Click **Register app**.
5. Firebase shows the config:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "osler-my-school.firebaseapp.com",
  projectId: "osler-my-school",
  storageBucket: "osler-my-school.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456",
  measurementId: "G-XXXXXXXXXX"
};
```

6. Copy this config (as JSON).

## Pasting the config into the wizard

1. Open the admin dashboard.
2. Go to **Sites** → **New site** (the wizard).
3. Step 4 (Auth) → pick **Firebase**.
4. The wizard shows a textarea labeled **Firebase config JSON**.
5. Paste the config from the previous step.
6. Click **Validate** — the wizard calls Firebase Auth (anonymous guest
   sign-in) to verify the config works.
7. If validation passes, continue to Step 5 (Deploy).

The wizard writes the config into the generated site's `config.json`. The
PWA reads `config.json` at startup and initializes Firebase.

Alternatively, configure the Firebase project in
[Settings → Firebase](../admin-dashboard/settings.md#firebase-project-config)
once and reuse it for all generated sites.

## Generating a service account (for the admin's Analytics tab)

Optional — only needed if you want to see aggregated analytics in the admin
dashboard (beyond what the Firebase console shows).

1. Firebase console → Project settings → Service accounts.
2. Click **Generate new private key**.
3. Save the JSON file somewhere permanent (e.g.
   `~/.osler/firebase-service-account.json`).
4. In the admin dashboard → Settings → Firebase → Service account JSON →
   pick the file.

The admin stores the file PATH in the OS keychain (not the JSON contents).
The JSON file itself is read on demand. Never commit it.

## Cost estimation

Firebase free tier (Spark plan):

| Resource | Free quota | Osler usage per user |
|----------|------------|---------------------|
| Firestore reads | 50K / day | ~100 / day (study + sync) |
| Firestore writes | 20K / day | ~50 / day |
| Firestore storage | 1 GB total | <1 KB per user |
| Cloud Storage | 5 GB total | 0 (unless using cloud packs) |
| Authentication | Unlimited | 1 per user |
| Hosting | 10 GB transfer | N/A (we use a third-party host) |

For ~10K users, free tier is comfortable. Beyond that, upgrade to the
Blaze plan (pay-as-you-go) — typical cost is $0.01-0.05 per active user per
month.

Gemini API (for the AI tutor) is billed separately via the Google AI Studio
API key. The admin's cost caps (`DAILY_CAP = $20`, `MONTHLY_CAP = $200`)
limit runaway spend.

## Multiple sites, one project

You can deploy multiple Osler sites that share the same Firebase project
(e.g. a school with separate sites for anatomy, physiology, pharmacology).
Each site's users authenticate against the same Firebase Auth, but their
data is isolated by UID in Firestore.

The trade-off: if one site's user floods Firestore with writes, all sites'
users are affected by the daily quota. For isolation, use separate Firebase
projects per site.

## Backup

Firebase projects support automatic backups (Blaze plan only). For the free
tier, manually export periodically:

```bash
# Install the gcloud CLI
gcloud auth login
gcloud config set project osler-my-school

# Export Firestore to a Cloud Storage bucket
gcloud firestore export gs://osler-my-school-backup/$(date +%Y-%m-%d)
```

Schedule this as a daily cron. See [Operations → Backups](../operations/backups.md).

## What's next

- [Firestore Rules](firestore-rules.md) — the full rules.
- [Storage Rules](storage-rules.md) — the full rules.
- [Sync Strategies](sync-strategies.md) — how the 5 merge strategies work.
- [Settings → Firebase](../admin-dashboard/settings.md#firebase) — admin
  configuration.
