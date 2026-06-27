# Deploy to Cloudflare Pages

Cloudflare Pages is a static host with unlimited bandwidth on free tier
(subject to fair use). Best choice for high-traffic sites or sites with
large bundles. Requires a Cloudflare account + API token + account ID.

## Prerequisites

- A Cloudflare account — sign up at [cloudflare.com](https://www.cloudflare.com/)
  (free)
- A Cloudflare API token with the "Cloudflare Pages" template — generate at
  [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
  → Create Token → "Cloudflare Pages" template
- Your Cloudflare Account ID — found at the top right of any Cloudflare
  dashboard page
- The token + account ID configured in the admin (see
  [Settings → Deploy Providers](../admin-dashboard/settings.md#cloudflare-pages))

## One-click deploy from the wizard

After [generating a bundle](../site-generation/wizard.md), pick **Cloudflare
Pages** in Step 5 and click **Deploy now**. The admin:

1. **Calls the Cloudflare API** (`POST /accounts/{account_id}/pages/projects`)
   to create a new project with a random name (e.g.
   `osler-site-abc123`).
2. **Creates a deployment** (`POST /accounts/{account_id}/pages/projects/{project_name}/deployments`)
   with the bundle files uploaded as form data.
3. **Waits for the deployment** to be ready (polls
   `GET /accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}`
   until `latest_stage.status == "success"`).
4. **Returns the URL** — `https://{project-name}.pages.dev`

The deploy takes ~15-30 seconds depending on bundle size.

## Manual deploy via Wrangler CLI

If you prefer to deploy via Cloudflare's Wrangler CLI:

1. Install Wrangler: `npm install -g wrangler`
2. Authenticate: `wrangler login`
3. In the wizard, click **Save zip** and unzip locally.
4. `cd` into the unzipped bundle.
5. Run `wrangler pages deploy . --project-name=osler-site`
6. On first run, Wrangler prompts to create the project. Accept.
7. Wrangler returns the production URL.

This is useful for CI/CD or if the admin's Cloudflare integration isn't
working.

## Site configuration

The wizard writes a `_headers` file and a `_redirects` file into the bundle
(Cloudflare Pages uses these instead of `netlify.toml` / `vercel.json`):

### `_headers`

```
/sw.js
  Cache-Control: no-cache

/update-manifest.json
  Cache-Control: no-cache

/engines/*
  Cache-Control: public, max-age=31536000, immutable

/content/*
  Cache-Control: public, max-age=31536000, immutable
```

### `_redirects`

```
/*    /index.html    200
```

These mirror the Netlify / Vercel configs:

- `no-cache` on `sw.js` and `update-manifest.json` for SW update flow.
- 1-year immutable caching on `engines/` and `content/`.
- SPA routing (all paths serve `index.html`).

## URL patterns

| Tier | URL pattern | Cost |
|------|-------------|------|
| Default subdomain | `https://{project-name}.pages.dev` | Free |
| Custom domain | `https://{your-domain}` | Free (you own the domain) |

To rename the subdomain: Cloudflare UI → Pages → Project → Custom domains →
Set a custom pages.dev subdomain. Note: project names are immutable after
creation — to rename, delete the project and create a new one.

To add a custom domain: Cloudflare UI → Pages → Project → Custom domains →
Set up a custom domain. Cloudflare automatically configures DNS if the
domain is on Cloudflare; otherwise you point CNAME to
`{project-name}.pages.dev`.

V2 anti-goal: the admin dashboard does NOT manage custom domains. Use the
Cloudflare UI.

## Update behavior

When you redeploy via the admin, Cloudflare creates a new deployment. The
previous deployments remain accessible via their unique URLs (Cloudflare
gives each deployment a permanent alias like
`https://{hash}.{project-name}.pages.dev`). The production URL always points
to the latest "production" deployment.

Users get the update on next visit via the service worker update flow.

## Rollback

Cloudflare supports instant rollback:

1. Go to Cloudflare UI → Pages → Project → Deployments.
2. Find the deploy to roll back to.
3. Click the `...` menu → **Rollback to this deployment**.
4. Cloudflare atomically swaps the production URL to that deployment.

Or use the admin's **Deploy → History → Roll back** button (calls the
Cloudflare API under the hood). The admin keeps the last 5 deploys in history
per Cloudflare project.

Note: Cloudflare only allows rollback to deployments that were originally
deployed as "production" (not preview). The admin always deploys as
production.

See [Rollback](rollback.md) for the cross-provider rollback flow.

## Limitations

- **Free tier:** unlimited bandwidth (fair use: 100k requests/day on
  average), 500 builds / month, 1 concurrent build.
- **Build time:** not applicable for Osler (admin does the build locally).
- **File size limit:** 25 MB per file.
- **Total file count:** 20,000 files per deployment.
- **Headers file size:** 100 KB for `_headers`.
- **Redirects file size:** 100 KB for `_redirects`.

## Why Cloudflare over Netlify / Vercel?

| Factor | Cloudflare | Netlify | Vercel |
|--------|-----------|---------|--------|
| Bandwidth (free) | Unlimited (fair use) | 100 GB | 100 GB |
| File size limit | 25 MB | 25 MB | 100 MB |
| Builds/month | 500 | 300 (free) | 100 GB-hours |
| Custom domain | Free, auto-SSL | Free, auto-SSL | Free, auto-SSL |
| Edge cache | Yes (Cloudflare CDN) | Yes (Netlify CDN) | Yes (Vercel CDN) |
| CLI | Wrangler | Netlify CLI | Vercel CLI |
| API maturity | Good | Excellent | Excellent |

Pick Cloudflare if: you expect high traffic, you already use Cloudflare for
DNS, or you need unlimited bandwidth.

Pick Netlify if: you want the most mature API, or you need form handling.

Pick Vercel if: you already use Vercel for other projects, or you want the
best developer experience.

## Troubleshooting

### "Cloudflare API: 401 Unauthorized"

The API token is invalid or lacks the Pages scope. Regenerate at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
using the "Cloudflare Pages" template.

### "Cloudflare API: 403 Forbidden — account ID mismatch"

The account ID in Settings doesn't match the token's account. Verify both
in the Cloudflare dashboard (top right corner shows the account ID).

### "Deployment failed: file count exceeds 20000"

The bundle has > 20,000 files. Reduce the number of content packs or use
larger packs (combine multiple small items into one). The wizard shows file
count in the post-generate dialog.

### "Site loads but custom domain shows SSL error"

Cloudflare auto-provisions SSL but it can take up to 15 minutes for the
certificate to be ready. Wait, then reload. If it persists, check the
Cloudflare dashboard → SSL/TLS → Edge Certificates.

### "Firebase auth not working"

Add your Cloudflare Pages URL (`https://{project-name}.pages.dev`) to the
Firebase project's authorized domains.

## What's next

- [Rollback](rollback.md) — how to roll back.
- [Cloudflare Pages API docs](https://developers.cloudflare.com/pages/api/)
  — for custom automation.
- [Operations → Monitoring](../operations/monitoring.md) — Cloudflare
  analytics.
