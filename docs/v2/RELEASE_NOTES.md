# Osler V2 — Release Notes (v2.0.0)

> **Release date:** Phase 16 ship
> **Status:** General availability
> **Migration:** Additive — V1 instances continue to work; V2 features unlock when the user opts in.

## Highlights

Osler V2 turns the V1 single-tenant app into a **modular quiz-site platform**.
A Tauri desktop app (the *generator*) lets an educator or self-hoster pick
engines, content, theme, auth mode, and deploy target — and produces a
self-contained PWA bundle that runs on GitHub Pages, Netlify, Vercel, or
Cloudflare Pages.

## New features

### Phase 9 — Firebase backend consolidation

- **Firebase Cloud Storage** added to the V1 backend (optional — only
  enabled if `storageBucket` is configured).
- **`firestore.rules`** extended to cover the new `userContent/{uid}/items/{itemId}`
  collection (owner-only read/write).
- **`storage.rules`** added for cloud-based content pack sharing
  (owner-only write with 50 MB size limit + JSON content-type check;
  optional public read for files marked `sharePublic = 'true'`).
- **`sync-user-content.js`** extends V1 sync to cover user content,
  reusing the V1 `fieldMergeByUpdatedAt` merge strategy.
- **Self-hoster config** — generated sites can now load Firebase config
  from `/config.json` (written by the V2 wizard), enabling "bring your own
  Firebase project" self-hosting.

### Phase 10 — User custom content + file-based sharing

- **`user-content.js`** — CRUD API for user-authored content. Validates
  against schemas before write. Triggers background sync to Firestore.
- **`content-pack.js`** — file-based export/import. A pack is a single
  JSON file with format `osler-content-pack` v1.0. Validates every item
  before write. UID collision handling: overwrite / skip / rename.
- **Cloud sharing** (optional) — users can upload packs to Firebase
  Storage and share via URL. Public read is opt-in per file (via custom
  metadata `sharePublic = 'true'`).
- **Hub UI** — "Create", "Export", "Import" buttons in the hub toolbar.
  Content authoring modal with JSON editor + live validation. User content
  is badged with a "Mine" indicator in the hub grid.

### Phase 11 — i18n (EN/AR + RTL)

- **`i18n.js`** — i18next wrapper with EN + AR bundles. Language detection
  (localStorage → browser → fallback to EN). RTL toggle via `dir="rtl"` on
  `<html>`. AR webfont (Noto Naskh Arabic) lazy-loaded.
- **`en.json` + `ar.json`** — full UI string bundles covering every
  engine + admin + common.
- **`i18n.css`** — RTL layout overrides for third-party libs (CodeMirror,
  Prism.js) + directional icon auto-flip + logical-property enforcement.
- **`language-switcher.js`** — globe icon + dropdown, mounted in the hub
  topbar.
- **Anti-goals preserved** — no auto-translation, no TTS, no languages
  beyond EN + AR.

### Phase 12 — Lightweight AI tutor

- **`tutor.js`** — `askTutor(question, itemContext, itemUid)` calls Gemini
  with a fixed system prompt + the current item as context. No RAG, no
  embeddings, no vector DB. Conversation history in IndexedDB (local-only,
  capped at 100 messages per item).
- **`tutor-ui.js`** — slide-out chat modal. Pre-fills item context
  (collapsible card). Streaming responses. "Report this response" button
  for quality monitoring.
- **`tutor.css`** — modal styles with logical properties throughout for RTL.
- **Cost caps** reused from V1 (`DAILY_CAP = $20`, `MONTHLY_CAP = $200`).
  Shared between content generation + tutor.
- **Anti-hallucination measures** — system prompt instructs the model to
  say "I'm not sure" when uncertain. Modal shows disclaimer: "AI responses
  may be inaccurate. Verify important medical information with trusted
  sources."

### Phase 13 — Modular site generator wizard

- **`generator.js`** — 5-step wizard: Engines → Content → Theme → Auth →
  Deploy. State persists to localStorage (7-day TTL). Bundle spec builder
  generates `config.json` + provider config files (`netlify.toml`,
  `vercel.json`, `_headers`, `_redirects`).
- **Bundle validation** — every selected content item validates against
  its schema before inclusion. Firebase config validation catches missing
  required fields.
- **Bundle size estimation** — running estimate as the user makes
  selections.

### Phase 14 — New user guides

- **`tour.js`** — shepherd.js wrapper. Two tours: PWA (5 steps) and admin
  (5 steps). Loaded lazily (CDN with npm fallback). First-run detection
  via localStorage flag (versioned — re-shows when tour content changes).
- **First-run wizard** — 3-step onboarding modal (language → optional
  content import → start studying). Triggers the PWA tour on completion.

### Phase 15 — Provider integrations

- **`providers/mod.rs`** — shared `ProviderDeploy` trait + `Credentials`
  enum + `ProviderError` types + retry helper (exponential backoff on
  rate limits).
- **`providers/github_pages.rs`** — creates orphan `gh-pages` branch,
  pushes bundle as branch root, enables Pages on repo settings. Rollback
  via force-update of `gh-pages` to a previous commit SHA.
- **`providers/netlify.rs`** — creates a new site, uploads the bundle
  zip, polls until "ready". Rollback via `/restore` endpoint.
- **`providers/vercel.rs`** — creates a project + deployment with files
  inline (base64-encoded). Polls until `READY`. Rollback via `/promote`
  endpoint.
- **`providers/cloudflare.rs`** — creates a project + deployment using
  the manifest upload pattern (SHA-256 file hashes). Polls until
  `success`. Rollback via `/rollback` endpoint.

### Phase 16 — v2.0 ship

- **E2E tests** — `tests/e2e/v2-flows.spec.js` covers user content
  authoring, export/import, i18n + RTL, AI tutor (mocked), generator
  wizard state, security smoke tests.
- **Unit tests** — `tests/unit/lib/v2-*.test.js` covers sync-user-content,
  content-pack, i18n, and generator modules.
- **Security review** — `SECURITY.md` updated with V2 threat model + 4 new
  checklist items (deploy credentials in keychain, content pack validation,
  Firestore rules for userContent, Storage rules for cloud packs).
- **Migration guide** — `docs/migration/v1-to-v2.md` documents the
  additive migration path (no V1 features break).

## Bug fixes

- (V1-era bugs are documented in `PATCH_NOTES.md`. V2 has no V1 regressions —
  the migration is additive.)

## Anti-goals reaffirmed

V2 explicitly does NOT add (see `v2-osler-plan-enhanced.md` §5):

- React/Vue/Svelte (vanilla JS + esbuild stays)
- Supabase or second backend (Firebase stays)
- Orgs/teams (personal-only tenancy)
- Public content registry (file-based sharing)
- Paid marketplace (no Stripe)
- Native mobile apps (PWA only)
- Auto-translation (authors write content in their language)
- TTS audio
- RAG / embeddings / vector DB (tutor is lightweight chat)
- SR optimizer / ML model (SM-2 stays)
- Custom domain management in the generator (use provider dashboards)
- AWS/GCP/Azure deploy (GH Pages + Netlify + Vercel + CF only)
- DRM on content packs (JSON, freely copyable)
- Real-time collaboration (single-author model)
- Air-gapped self-hosting (self-hosting = bring your own Firebase)

## Upgrade guide

### For PWA users

No action required — V2 features unlock automatically when your admin
pushes the V2 bundle update via Tier 2.

### For admins

1. Update the admin dashboard via Settings → Updates → Check now (or
   download the V2 binary from the GitHub Release).
2. For each deployed V1 instance, push the V2 update via the Updates tab
   (Tier 2).
3. (Optional) Enable Firebase Storage for cloud-based content pack sharing.
4. (Optional) Configure the Gemini API key in Settings → AI Generation
   to enable the AI tutor.
5. (Optional) Regenerate sites with the V2 wizard to take advantage of
   the new deploy providers.

See `docs/migration/v1-to-v2.md` for the full migration walkthrough.

### For self-hosters

1. Create a Firebase project (if you don't have one).
2. Configure Auth + Firestore + Storage.
3. Deploy the `firestore.rules` and `storage.rules` files.
4. Generate a site bundle with the wizard (Step 4: pick Firebase, paste
   your config).
5. Deploy to your chosen provider.

See `docs/firebase/bring-your-own.md` for the full walkthrough.

## Known limitations

- **AI tutor quality** — Gemini can hallucinate. The tutor has anti-hallucination
  measures (system prompt, item-scoped context, "I'm not sure" instruction),
  but users should verify medical facts with trusted sources.
- **RTL coverage** — third-party libraries (CodeMirror, Prism.js) have
  incomplete RTL support. Workarounds are documented in
  `docs/i18n/rtl-guide.md`.
- **Cross-device sync of deletions** — V2 does not sync deletions. A user
  can delete content locally, but the remote copy stays until explicitly
  deleted via the cloud UI. This is a design decision (prevent accidental
  mass-deletion).
- **Bundle size** — sites with all 5 engines + 100 content packs + EN/AR
  bundles can be 3+ MB. The wizard shows a running estimate so users can
  trim if needed.

## Contributors

Thanks to everyone who contributed to V2:

- The Osler core team
- Community contributors (see git history for full list)
- Gemini for content generation + tutor (with cost caps enforced)

## What's next

V2 enters maintenance mode. V3 planning will begin once the V2 success
metrics (see `v2-osler-plan-enhanced.md` §9) are met:

- 50+ generated sites within 3 months of v2.0
- Lighthouse scores: perf 95+, a11y 90+, BP 95+, SEO 90+, PWA pass (EN + AR)
- AI tutor rated "helpful" by >70% of users in a 2-week pilot
- Solo learner onboards in <10 minutes (timed user test)
- Educator authors + deploys + student studies in <15 minutes (timed user test)

V3 candidates (from the v2 plan §10):

- Organizations / teams
- Paid content marketplace (Stripe)
- Public content registry
- Native mobile apps
- Real-time collaborative content authoring
- Custom domain management in the generator
- AWS / GCP / Azure deploy
- Auto-translation (EN ↔ AR)
- TTS audio
- RAG-based AI tutor with embeddings
- SR optimizer / ML spaced-repetition model
- DRM on content packs
- Drag-and-drop site builder
- Air-gapped self-hosting (no Firebase)
- Languages beyond EN + AR

None of these are committed for V3. They will be re-evaluated based on V2
user feedback and usage data.
