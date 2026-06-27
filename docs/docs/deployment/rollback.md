# Rollback

Every deploy target supported by Osler V2 keeps a history of previous
deploys. This page describes how to roll back when a deploy is broken, and
how to verify the rollback worked.

## When to roll back

Roll back when:

- A newly deployed bundle has a runtime bug (broken engine, broken UI).
- A newly pushed Tier 2 update corrupts a deployed instance.
- A content pack with bad data was bundled by mistake.
- An i18n / RTL regression breaks Arabic layout.

Do NOT roll back when:

- The bug is in a single content item (just fix the content and redeploy —
  rollback is overkill).
- The bug is in the admin dashboard (rollback is for deployed instances,
  not the admin).
- You want to "test" rollback (do that on a test instance, not production).

## Cross-provider rollback flow

The admin's **Deploy → History** tab shows the last 5 deploys per provider
per site. Each row has:

- Deploy timestamp
- Bundle version (from `update-manifest.json`)
- Bundle hash (SHA-256, first 12 chars)
- Deploy URL (provider-specific)
- Status (success / failed / rolled back)
- Actions: **Roll back to this deploy**

Clicking **Roll back to this deploy** triggers the provider-specific
rollback:

| Provider | Mechanism |
|----------|-----------|
| GitHub Pages | Force-pushes the previous `gh-pages` commit to the top |
| Netlify | Calls `POST /api/v1/sites/{site_id}/deploys/{deploy_id}/restore` |
| Vercel | Calls `POST /v13/deployments/{deployment_id}/promote` |
| Cloudflare Pages | Calls `POST /accounts/{account_id}/pages/projects/{project}/deployments/{deployment_id}/rollback` |

The admin handles each provider's quirks:

- GitHub Pages: rollback is destructive (force-push). The current `gh-pages`
  state is preserved as a branch `gh-pages-rollback-{timestamp}` for 24
  hours before automatic cleanup.
- Netlify: rollback is instant and non-destructive.
- Vercel: rollback promotes a previous deployment to "production" — the
  previous production deploy becomes a "preview" deploy.
- Cloudflare Pages: rollback only works for deployments that were originally
  production.

After rollback, the admin:

1. Updates its internal deploy history (marks the rolled-back deploy as
   "rolled back", marks the rolled-to deploy as "active").
2. Verifies the rollback by fetching the site's `update-manifest.json` and
   comparing the hash.
3. Shows a success toast with the rollback URL.

## Verifying a rollback

After the admin reports rollback success:

1. Open the site URL in a browser.
2. Hard-reload (Ctrl+Shift+R / Cmd+Shift+R) to bypass browser cache.
3. Open DevTools → Application → Service Workers → click "Unregister" (to
   force the SW to re-fetch).
4. Reload again.
5. The site should now serve the rolled-back bundle.

If the site still shows the broken version:

- The provider's CDN may be caching. Wait 1-5 minutes.
- The service worker may have cached the broken bundle. Clear site data
  (DevTools → Application → Storage → Clear site data).
- The rollback may have failed silently. Check the admin's deploy history
  for the actual state.

## Tier 2 update rollback

Tier 2 bundle updates (engine pushes, see
[Bundle Updates](../admin-dashboard/bundle-update.md)) have a separate
rollback flow:

1. Go to **Updates → History**.
2. Pick the instance.
3. Find the update to roll back.
4. Click **Roll back**.

The admin:

1. Reads the `update-v{previous}-previous` tag from the instance repo.
2. Resets the instance repo to that tag (force-push).
3. Updates `update-manifest.json` with the previous version + hash.

Users see the rollback on next visit — the SW detects the hash change in
`update-manifest.json` and re-fetches the previous files.

Tier 2 rollback preserves the last 5 updates per instance. Older updates
are pruned (their rollback tags are deleted).

## GitHub Pages-specific rollback

GitHub Pages is unique because the deploy IS the branch — there's no
separate "deployment" object. Rollback is a force-push of a previous commit
to `gh-pages`:

```bash
# In the instance repo
git checkout gh-pages
git reset --hard {previous-commit-sha}
git push --force origin gh-pages
```

The admin does this via the GitHub API. Force-push requires the `repo` scope
(already granted). The previous state is saved as a branch
`gh-pages-rollback-{timestamp}` for 24 hours — if the rollback itself is
bad, you can restore from that branch:

```bash
git checkout -b gh-pages-restored gh-pages-rollback-{timestamp}
git push --force origin gh-pages-restored:gh-pages
```

## Rollback vs. redeploy

Rollback is fast (instant for Netlify / Vercel / Cloudflare, ~30 seconds
for GitHub Pages) but reverts to a known-good state. Redeploy (regenerate +
push) is slow (minutes) but lets you fix the bug.

Recommended flow when a deploy is broken:

1. **Roll back** to the last known-good deploy (instant, restores service).
2. **Investigate** what broke (check the diff between the two deploys).
3. **Fix the bug** locally (edit content / engine code).
4. **Test locally** (use the wizard's preview feature).
5. **Redeploy** with the fix.

Do not skip step 1 — leaving a broken deploy live while you debug alienates
users.

## Rollback limitations

- **Cannot roll back the very first deploy** — there's nothing to roll back
  to. If your first deploy is broken, fix and redeploy.
- **Cannot roll back across provider migrations** — if you deployed to
  Netlify and then moved to Vercel, the Netlify deploy history is gone (in
  the admin's view; Netlify itself keeps the history).
- **Cannot roll back Tier 2 updates that changed the schema version** — if
  a Tier 2 update bumped `meta.schemaVersion`, the previous content files
  may not validate against the new schema. Redeploy instead.
- **Rollback history is per-admin** — if two admins share a site, each sees
  only their own deploys in the admin's history. The provider's own history
  (Netlify UI, Vercel UI, etc.) shows all deploys.

## What's next

- [Bundle Updates](../admin-dashboard/bundle-update.md) — Tier 2 update
  mechanism.
- [Operations → Incident Response](../operations/incident-response.md) —
  what to do when a deploy is broken.
- [GitHub Pages](github-pages.md), [Netlify](netlify.md),
  [Vercel](vercel.md), [Cloudflare Pages](cloudflare-pages.md) — per-provider
  deploy guides.
