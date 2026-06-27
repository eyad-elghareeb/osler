# Glossary

Key terms used throughout the Osler V2 documentation. Organized
alphabetically.

## A

**Admin dashboard**
The Tauri v2 desktop application (Rust + HTML/JS frontend) that serves as
the single entry point for content authoring, site generation, and
deployment. V1 shipped the admin as a CMS; V2 extends it into a full site
generator wizard.

**Admin-managed content**
JSON content files in `/content/` in the project repository, authored via
the Tauri admin's CMS workflow. All users of a generated site see the same
admin-managed content. Contrasted with **user custom content**.

**AI tutor**
The V2 lightweight chat modal (Phase 12) scoped to the current study item.
Calls Gemini with the item as context. No RAG, no embeddings, no vector DB.
Conversation history is local-only (IndexedDB, not synced).

**Analytics taxonomy (V20)**
The fixed set of allowed values for `contentType` (quiz/bank/flashcard/
written/osce) and `outcome` (correct/wrong/skipped/rating_1-4/null) in
analytics events. Enforced by `src/lib/analytics.js`.

**Anki CSV**
A plain-text export format used by Anki (the popular flashcard app). Osler
supports importing and exporting this format via `src/lib/anki.js`.

**Anti-goals**
Hard constraints listed in the v2 plan §5. Sessions that violate an
anti-goal must stop and ask. Examples: no React, no Supabase, no TTS, no
RAG.

**Append-only**
A sync merge strategy used for the `events` collection. Events are
appended on both sides without modification. See
[Firebase → Sync Strategies](../firebase/sync-strategies.md).

## B

**Bank engine**
The untimed, low-pressure study mode. Presents questions one at a time
with a "Show answer" reveal. No scoring, no time pressure. See
[Engines → Bank](../engines/bank.md).

**Blaze plan**
Firebase's pay-as-you-go pricing tier. Required for automatic Firestore
backups, Cloud Functions, and unlimited bandwidth. Free tier (Spark) is
sufficient for ~10K users.

**Bundle**
A self-contained zip of a generated Osler site, produced by the V2
generator wizard. Includes engines, content, theme, config, and provider
config files. See [Site Generation → Wizard](../site-generation/wizard.md).

**Bundle update (Tier 2)**
The mechanism for pushing engine and content updates to already-deployed
instances without regenerating the entire site bundle. Computes a SHA-256
hash, signs the bundle, pushes to the instance repo. See
[Admin Dashboard → Bundle Updates](../admin-dashboard/bundle-update.md).

## C

**CI**
Continuous integration. Osler uses GitHub Actions. See
[Operations → CI/CD](../operations/ci-cd.md).

**CMS**
Content management system. In Osler, the GitHub CMS workflow — content
lives as JSON files in a GitHub repo, edited via the admin dashboard. See
[Admin Dashboard → Content CMS](../admin-dashboard/content-cms.md).

**Content pack**
A single JSON file containing one or more content items, exportable from
the PWA and importable into another instance. File-based sharing — no
public registry. See [Site Generation → Content Packs](../site-generation/content-packs.md).

**Content repo**
The GitHub repository where admin-managed content lives as JSON files.
Created and managed by the admin dashboard.

**Content type**
One of `quiz`, `bank`, `flashcard`, `written`, `osce`, or `hub`. Each has
a JSON Schema in `src/schemas/`. See
[Content Authoring → Content Types](../content-authoring/content-types.md).

**CSP**
Content Security Policy. A browser security feature that restricts which
resources can be loaded. The admin dashboard uses a strict CSP. See
[Architecture → Security Model](../architecture/security-model.md#csp-content-security-policy).

## D

**Device Flow**
GitHub's OAuth flow for desktop apps. The user is shown a code, enters it
at github.com/login/device, and authorizes. No redirect URI needed. Used
by the Tauri admin.

**Device ID**
A random UUID generated per browser (stored in `localStorage.osler_device_id`).
Used for analytics attribution. Anonymous — not a user identifier. Single
source of truth: `src/lib/sync-utils.js`.

## E

**Ease factor (EF)**
In SM-2, the multiplier applied to the interval on each successful review.
Starts at 2.5, clamped to [1.3, 3.0]. Higher EF = longer intervals between
reviews.

**Engine**
A self-contained JS module that renders a content type. Examples:
`quiz-engine.js`, `bank-engine.js`. Each is bundled by esbuild into
`dist/{name}.js`.

**Engine-shared bridge**
`engines/engine-shared.js`. Dynamically imports `src/lib/*.js` and exposes
them on `window.OslerTracker`, `window.OslerAnalytics`, etc. Engines use
this bridge instead of importing lib directly.

**esbuild**
The JS bundler used by Osler. Fast (Go-based), zero-config, no framework
required. V2 explicitly avoids webpack/rollup/vite.

## F

**Firebase**
The single backend provider for Osler V2 (anti-goal: no Supabase, no
Postgres). Provides Auth, Firestore, Storage, and Analytics. V1 wiring
preserved in V2.

**Field merge by updatedAt**
A sync merge strategy. Each field in a document is merged independently;
the version with the most recent `updatedAt` wins per field. Used for
trackers and user custom content.

**Firestore**
Firebase's NoSQL document database. Used for sync of tracker data and
user custom content. Free tier: 50K reads/day, 20K writes/day, 1 GB
storage.

**Firestore rules**
Security rules that control access to Firestore documents. Owner-only
for user data. See [Firebase → Firestore Rules](../firebase/firestore-rules.md).

**Flashcard engine**
The SM-2 spaced repetition engine. Schedules cards based on review
history. See [Engines → Flashcard](../engines/flashcard.md).

## G

**Gemini**
Google's LLM API. Used by Osler for the 3-stage content generation
pipeline (V1) and the AI tutor (V2). Same API key reused for both. Cost
caps enforced.

**Generator**
The V2 site generator wizard (Phase 13). Picks engines, content, theme,
auth, deploy target → produces a deployable site bundle. Subsumes the V1
admin CMS.

**GitHub Pages**
A free static site hosting service from GitHub. One of the four V2 deploy
targets. See [Deployment → GitHub Pages](../deployment/github-pages.md).

**Guest mode**
The default Firebase Auth state. Anonymous user, no OAuth. Tracker data
is local-only. Upgraded to a real account on OAuth sign-in (preserves
data via Firebase `link()` API).

## I

**i18n**
Internationalization. V2 ships EN + AR UI strings + RTL layout. No
auto-translation, no TTS. See [i18n → Overview](../i18n/overview.md).

**IndexedDB**
Browser-based NoSQL database. Used by Osler for all client-side storage
(trackers, userContent, tutorHistory). Per-type stores via
`src/lib/storage.js`.

**Instance repo**
A GitHub repository containing a deployed Osler site. The Tier 2 update
mechanism pushes new engine/content files to instance repos.

## K

**keyring (crate)**
A Rust crate for OS keychain access (macOS Keychain, Windows Credential
Manager, Linux Secret Service). Used by the Tauri admin to store GitHub
tokens and deploy provider credentials. Never stores secrets in
`tauri-plugin-store` (plain JSON).

## L

**Lighthouse**
Google's web audit tool. Scores performance, accessibility, best
practices, SEO, and PWA readiness. V2 targets: perf 95+, a11y 90+, BP
95+, SEO 90+, PWA pass.

**Local storage**
Browser-based key-value storage. Limited to ~5 MB. Banned in Osler except
for the allow-list (theme, lang, device ID, migration flags). All user
data goes through IndexedDB.

**Logical CSS properties**
CSS properties that flip automatically in RTL (e.g. `margin-inline-start`
instead of `margin-left`). Mandatory in Osler V2 — see
[Coding Conventions](../development/coding-conventions.md#14-logical-css-properties-for-rtl).

**LWW (last-write-wins)**
A sync merge strategy. The version with the latest timestamp wins. Used
for fields where recency matters more than completeness.

## M

**Manifest**
The `manifest.json` file in the content repo. Lists every content item by
UID, type, title, and path. Maintained automatically by the admin CMS
workflow.

**Meta fields**
The `meta` object on every content item. Holds UID, title, schemaVersion,
createdAt, updatedAt, lang, tags, etc. See
[Content Authoring → Meta Fields](../content-authoring/meta-fields.md).

**mkdocs-material**
The documentation site generator used by these docs. Markdown source,
static HTML output, search built-in. See the `mkdocs.yml` file.

**SM-2**
The spaced repetition algorithm used by the flashcard engine. Schedule
based on ease factor, interval, and review rating (Again/Hard/Good/Easy).
Implemented in `src/lib/sm2.js`. V2 explicitly does NOT add an ML
optimizer.

## N

**None auth mode**
A generated site configuration with no Firebase backend. Static site,
guest-only, no sync, no AI tutor. Works on any static host with zero
configuration.

## O

**OSCE**
Objective Structured Clinical Examination. A clinical skills assessment
format. Osler's OSCE engine simulates clinical encounters with 5 stages:
history, examination, investigations, diagnosis, management. See
[Engines → OSCE](../engines/osce.md).

## P

**PWA**
Progressive Web App. A web app that uses service workers + manifest to
provide offline access, installability, and push notifications. Every
Osler generated site is a PWA.

**Phase**
A unit of work in the Osler plan. V1 = Phases 0-8 (shipped). V2 = Phases
9-16 (in progress). Each phase has a defined scope, deliverables, and
success criteria.

**Provider**
A deploy target. V2 supports: GitHub Pages, Netlify, Vercel, Cloudflare
Pages, Docker export. AWS/GCP/Azure explicitly not supported (anti-goal).

## R

**RAG**
Retrieval-Augmented Generation. An AI technique that retrieves relevant
context from a vector database before generating a response. V2 explicitly
does NOT use RAG (anti-goal §5.9). The AI tutor is a lightweight chat
modal with the current item as context only.

**Rollback**
Reverting a deploy or Tier 2 update to a previous version. Each provider
supports instant rollback via the admin's Deploy → History UI. See
[Deployment → Rollback](../deployment/rollback.md).

**RTL**
Right-to-left layout. Used when the UI language is Arabic. Implemented
via the `dir="rtl"` HTML attribute + logical CSS properties. See
[i18n → RTL Guide](../i18n/rtl-guide.md).

## S

**Schema version**
The `meta.schemaVersion` field on every content item. Must match a known
version in `src/schemas/_meta.json`. V19 policy enforced by
`src/lib/validate.js`.

**Self-hoster**
A user who deploys a generated Osler site + their own Firebase project.
Controls their data while leveraging Google's managed infra. V2
self-hosting = "bring your own Firebase project".

**Service worker**
A browser feature that intercepts network requests and can serve cached
responses. Osler uses `sw.js` for offline-first behavior and the Tier 2
update flow.

**Sign-only bundle**
A bundle signed with the release key, enabling Tier 2 updates. Without a
configured pubkey in `tauri.conf.json`, deployed instances refuse Tier 2
updates.

**SM-2**
See "SM-2" under M.

**Spark plan**
Firebase's free pricing tier. Covers ~10K users. Limits: 50K Firestore
reads/day, 1 GB storage, 10 GB bandwidth/month.

**Storage (Firebase)**
Firebase's object storage service. Used by Osler V2 for optional
cloud-based content pack sharing. See
[Firebase → Storage Rules](../firebase/storage-rules.md).

**Streak**
A counter of consecutive days a user has studied. Per content type.
Stored in `users/{uid}/streaks/*` in Firestore. Sync strategy: `maxStreak`.

**Sync**
The bidirectional flow of data between IndexedDB (client) and Firestore
(server). Implemented in `src/lib/sync.js`. Uses 5 merge strategies.

## T

**Tauri**
A framework for building desktop apps with web frontends. Osler's admin
dashboard is Tauri v2 (Rust shell + HTML/JS frontend). Native binaries
for Linux, macOS, Windows.

**Tier 1 update**
Admin dashboard self-update. Checks GitHub releases for new versions,
downloads, verifies SHA-256, swaps. See
[Admin Dashboard → Settings → Updates](../admin-dashboard/settings.md#updates).

**Tier 2 update**
Engine and content update push to deployed instances. See "Bundle update
(Tier 2)".

**Tracker**
Per-type IndexedDB store holding study state. One entry per item studied.
Stores: `quizTracker`, `bankTracker`, `flashcardTracker`,
`writtenTracker`, `osceTracker`.

**TTS**
Text-to-speech. Audio generation from text. V2 explicitly does NOT
include TTS (anti-goal §5.8).

## U

**UID**
Globally unique identifier for a content item. Format:
`{topic}-{type}-{sequence}` (e.g. `cardio-arrhythmias-quiz-001`).
Lowercase, hyphens only. Immutable after creation.

**User custom content**
Content authored by users in the PWA. Stored in IndexedDB (always) +
Firestore (when backend configured). Private to each user. Exportable as
JSON files. See [Site Generation → Content Packs](../site-generation/content-packs.md).

## V

**V1**
Osler V1 — the single-tenant offline-first PWA + Tauri admin CMS. Shipped
in Phase 8 (v1.0.0).

**V2**
Osler V2 — the modular quiz-site platform. Generator app produces
self-hostable quiz sites with optional Firebase backend. In progress
(Phases 9-16).

**V20 taxonomy**
See "Analytics taxonomy (V20)".

**V19 policy**
The validation policy that `meta.schemaVersion` must match a known version
in `_meta.json`. Enforced by `src/lib/validate.js`. See
[Content Authoring → Validation](../content-authoring/validation.md#the-v19-policy).

## W

**Written engine**
The free-text assessment engine. User writes a response, then self-rates
against a model answer. No automated grading. See
[Engines → Written](../engines/written.md).
