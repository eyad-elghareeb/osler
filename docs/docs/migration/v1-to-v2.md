# V1 to V2 Migration

Osler V2 is additive — nothing in V1 breaks. V2 features unlock when the
user opts in. This page describes the migration path for an existing V1
instance.

## What stays the same

These V1 features are preserved unchanged in V2:

- **Firebase auth** — guest → Google → GitHub. Same wiring, same account
  linking behavior.
- **Firestore sync** — `users/{uid}/trackers/*` and `users/{uid}/streaks/*`
  sync as before. Same 5 merge strategies.
- **Existing content** — all `content/*.json` files continue to work
  (admin-managed content tier).
- **Admin dashboard** — V1 Tauri admin continues to work. V2 adds new tabs
  (Sites, Deploy) but doesn't change existing tabs.
- **Generated sites (V1)** — V1 generated sites continue to work. V2
  generator is a new flow in the same admin.
- **Firebase config** — already configured in V1. V2 extends the config
  to include Storage (for content pack files) — optional, only needed if
  the user wants cloud-based sharing.

The migration is **additive** — you can stay on V1 indefinitely if you
don't want V2 features. But once V2 ships, all new development happens
there; V1 enters maintenance-only mode.

## What's new in V2

| Feature | V1 | V2 | Migration action |
|---------|----|----|------------------|
| User custom content | ❌ | ✅ (IndexedDB + Firestore sync) | None — unlocks automatically |
| Content pack export/import | ❌ | ✅ (file-based sharing) | None — unlocks automatically |
| i18n (EN + AR + RTL) | ❌ | ✅ | None — UI strings ship with V2 |
| AI tutor (chat modal) | ❌ | ✅ (Phase 12) | Configure Gemini API key in Settings |
| Site generator wizard | Partial (admin CMS) | ✅ Full wizard (Phase 13) | Use new Sites tab |
| Deploy to GH Pages / Netlify / Vercel / CF | ❌ | ✅ (Phase 15) | Use new Deploy tab |
| Tier 2 bundle updates | ✅ (V1) | ✅ (preserved) | None — continues to work |
| Tier 1 admin self-update | ✅ (V1) | ✅ (preserved) | None — continues to work |

## Migration steps

### Step 1 — Update the admin dashboard

1. Open the V1 admin dashboard.
2. Wait for the self-update notification (Tier 1 checks every 6 hours).
3. Click **Update now**.
4. The admin downloads the V2 binary, verifies the SHA-256 hash, and
   restarts.
5. Verify the version: Settings → About → "5.x.x" (V1) becomes "6.0.0"
   (V2).

Alternatively, download the V2 binary manually from the GitHub Release
and replace the V1 binary.

### Step 2 — Update deployed instances (Tier 2)

For each deployed V1 instance:

1. Open the V2 admin dashboard.
2. Go to **Updates** (the Tier 2 push UI).
3. Pick the instance from the dropdown.
4. The admin shows which files changed since V1 → V2 (likely all engine
   files + `sw.js` + `update-manifest.json`).
5. Click **Push update** with version `2.0.0`.
6. The admin pushes the new files to the instance repo + updates the
   manifest.
7. Users see the update on next visit (service worker detects the hash
   change and re-fetches).

### Step 3 — Enable Firebase Storage (optional)

If you want cloud-based content pack sharing (users can upload packs to
your Firebase Storage bucket and share via URL):

1. Go to Firebase console → Storage → Get started.
2. Pick the same location as Firestore.
3. Wait for provisioning.
4. Paste the Storage rules from [Firebase → Storage Rules](../firebase/storage-rules.md).
5. Publish.

The V2 PWA automatically detects Storage availability and shows the
"Share via URL" button in the export flow.

If you skip this step, users can still share packs via direct file
transfer (the default V2 behavior).

### Step 4 — Configure the Gemini API key (for AI tutor)

If you want the AI tutor (Phase 12) available to users:

1. Get a Gemini API key from
   [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Open the V2 admin → Settings → AI Generation → Gemini API key.
3. Paste the key. Click **Test**.
4. The key is stored in the OS keychain.

Existing V1 users with the key already configured (for content generation)
don't need to do anything — the same key is reused for the tutor.

### Step 5 — Regenerate sites with the wizard (optional)

V1 deployed sites continue to work as-is. To take advantage of V2 features
(user custom content, AI tutor, deploy providers), regenerate them:

1. Open the V2 admin → **Sites** → **New site**.
2. Pick the same engines + content as the V1 site.
3. Pick a theme (can match V1 or refresh).
4. Pick auth mode (None or Firebase).
5. Pick a deploy target (or save zip for manual deploy).
6. Click **Generate**.
7. Preview locally to verify.
8. Deploy (replaces the existing V1 site) or save zip.

The V2 site replaces the V1 site at the same URL. Users get the update on
next visit via the service worker.

### Step 6 — Verify analytics

1. Open the V2 admin → Analytics tab.
2. Verify events are flowing (V20 taxonomy).
3. New V2 events: `content_pack_import`, `content_pack_export`,
   `tutor_response_reported`, `ai_spend` (with `feature: 'tutor'`).
4. Existing V1 events continue: `session_start`, `quiz_answer`,
   `flashcard_review`, etc.

## What breaks (rare)

A few edge cases may break:

### Custom V1 themes

If you hand-edited the V1 site's CSS (outside the admin dashboard's theme
picker), regenerating with the V2 wizard will overwrite those edits. Back
up your custom CSS before regenerating, and re-apply via the wizard's
"Custom CSS" textarea.

### Modified engine JS

If you hand-edited engine JS files in a deployed V1 instance (rare —
not recommended), Tier 2 push will overwrite them. Back up before
pushing the V2 update.

### V0 content files

If you have very old content files from V0 (pre-V1 schema), they may not
validate against V2 schemas. Run `npm run validate` on your content repo
before pushing V2 updates. Migrate invalid files (see
`scripts/standardize_quiz_files.js` for the V0→V1 migration script).

## Rollback

If V2 doesn't work for you, you can roll back to V1:

### Admin dashboard rollback

1. Find the previous binary (the V2 admin keeps the V1 binary as
   `{osler-admin}.previous` in the install dir for 7 days).
2. Rename it back to `osler-admin` (or `Osler Admin.exe` on Windows).
3. Launch.
4. Disable auto-update in Settings until you're ready to try V2 again.

### Deployed instance rollback

Use the Tier 2 rollback flow:

1. Open the V1 admin (after rolling back per above).
2. Go to Updates → History.
3. Pick the V1 version (before the V2 push).
4. Click Roll back.
5. Users see the rollback on next visit.

### Firebase rollback

Firebase data is forward-compatible — V2 adds the `userContent` collection
but doesn't modify existing collections. No rollback needed.

If you enabled Storage (Step 3 above), you can leave it enabled (V1
doesn't use it) or disable it (Firebase console → Storage → Disable).

## FAQ

### Do I have to migrate?

No. V1 continues to work indefinitely. But V1 enters maintenance-only
mode after V2 ships — no new features, only critical bug fixes.

### Will my users' data be lost?

No. The migration is additive. Existing tracker data, streaks, and content
all persist. Users get V2 features automatically on next visit (after the
Tier 2 update push).

### Can I run V1 and V2 in parallel?

Yes — deploy V2 to a new URL and keep V1 at the old URL. Users can
choose. This is useful for testing V2 before full cutover.

### How long does the migration take?

For a single instance with ~50 content items and ~100 users:

- Step 1 (admin update): 5 minutes.
- Step 2 (Tier 2 push per instance): 2 minutes per instance.
- Step 3 (Firebase Storage): 5 minutes (optional).
- Step 4 (Gemini key): 2 minutes (optional).
- Step 5 (regenerate sites): 10 minutes per site (optional).
- Step 6 (verify analytics): 5 minutes.

Total: ~30 minutes for a single instance with all optional steps. Less if
you skip the optional ones.

### Where do I get help?

- Open a GitHub Issue with the `migration` label.
- Read the [troubleshooting guide](../troubleshooting/common-issues.md).
- Check [GitHub Discussions](https://github.com/osler-app/osler/discussions)
  for community support.

## What's next

- [Architecture → Overview](../architecture/overview.md) — V2 architecture.
- [Admin Dashboard → Overview](../admin-dashboard/overview.md) — the V2
  admin.
- [Site Generation → Wizard](../site-generation/wizard.md) — the V2
  generator wizard.
