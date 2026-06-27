# Deploy to Netlify

Netlify is a static host with a generous free tier (100 GB bandwidth, 300
minutes build time per month). It supports atomic deploys, instant rollbacks,
and automatic HTTPS. A good choice for sites that need more flexibility than
GitHub Pages.

## Prerequisites

- A Netlify account — sign up at [netlify.com](https://www.netlify.com/)
  (free, GitHub login supported)
- A Netlify personal access token — generate at
  [app.netlify.com/user/applications](https://app.netlify.com/user/applications)
  → Personal access tokens → New access token
- The token configured in the admin (see
  [Settings → Deploy Providers](../admin-dashboard/settings.md#netlify))

## One-click deploy from the wizard

After [generating a bundle](../site-generation/wizard.md), pick **Netlify**
in Step 5 and click **Deploy now**. The admin:

1. **Calls the Netlify API** (`POST /api/v1/sites`) to create a new site
   with no name (Netlify generates a random subdomain like
   `https://sparkling-unicorn-123abc.netlify.app`).
2. **Uploads the bundle** as a zip (`POST /api/v1/sites/{site_id}/deploys`)
   with the bundle contents.
3. **Waits for deploy** to complete (Netlify returns a deploy ID; the admin
   polls `GET /api/v1/deploys/{deploy_id}` until status is `ready`).
4. **Returns the URL** — `https://{random-subdomain}.netlify.app`

The deploy takes ~10-30 seconds depending on bundle size.

## Manual deploy

If you prefer to deploy manually via Netlify's UI:

1. In the wizard, click **Save zip** instead of **Deploy now**.
2. Go to [app.netlify.com/drop](https://app.netlify.com/drop) — Netlify's
   drag-and-drop deploy page.
3. Drag the zip file (or the unzipped folder) onto the page.
4. Netlify creates a site and deploys immediately.
5. The URL appears in the UI. You can rename the site later in Site settings.

This skips the API token setup but doesn't integrate with the admin's
deploy/rollback UI. For ongoing deploys, use the one-click flow.

## Site configuration

The wizard writes a `netlify.toml` file into the bundle:

```toml
[build]
  publish = "."

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/update-manifest.json"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/engines/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/content/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

This:

- Tells Netlify to serve the bundle root as the publish directory.
- Sets `Cache-Control: no-cache` on `sw.js` and `update-manifest.json` so
  the service worker always fetches the latest version.
- Sets 1-year immutable caching on `engines/` and `content/` (the file
  names are content-hashed for cache busting — see
  [Architecture → Data Flow](../architecture/data-flow.md)).
- Configures SPA routing (all paths serve `index.html`).

You can edit `netlify.toml` after deploy in the Netlify UI (Site settings →
Continuous deployment → Build settings).

## URL patterns

| Tier | URL pattern | Cost |
|------|-------------|------|
| Default subdomain | `https://{random}.netlify.app` | Free |
| Renamed subdomain | `https://{your-name}.netlify.app` | Free (if available) |
| Custom domain | `https://{your-domain}` | Free (you own the domain) |

To rename the subdomain: Netlify UI → Site settings → Domain management →
Domains → Change site name.

To add a custom domain: Netlify UI → Site settings → Domain management →
Domains → Add custom domain. Netlify handles HTTPS automatically via
Let's Encrypt.

V2 anti-goal: the admin dashboard does NOT manage custom domains. Use the
Netlify UI.

## Update behavior

When you redeploy via the admin, Netlify creates a new deploy atomically.
The previous deploys remain accessible (Netlify keeps a history). Users get
the update on next visit via the service worker update flow.

## Rollback

Netlify supports instant rollback to any previous deploy:

1. Go to Netlify UI → Deploys.
2. Find the deploy to roll back to.
3. Click **Publish deploy** (the button on the right side).
4. Netlify atomically swaps the live site to that deploy.

Or use the admin's **Deploy → History → Roll back** button (calls the Netlify
API under the hood). The admin keeps the last 5 deploys in history per
Netlify site.

See [Rollback](rollback.md) for the cross-provider rollback flow.

## Limitations

- **Free tier:** 100 GB bandwidth / month, 300 build minutes / month, 500
  sites per account.
- **Build time:** not applicable for Osler (the wizard does the build
  locally; Netlify just serves the files).
- **File size limit:** 25 MB per file. Large content bundles with images
  > 25 MB per file will fail.
- **Form submissions:** 100/month on free tier (Osler doesn't use this).
- **Functions:** 125k invocations/month on free tier (Osler doesn't use
  this — V2 explicitly avoids Cloud Functions).

## Troubleshooting

### "Netlify API: 401 Unauthorized"

The Netlify token is invalid or expired. Regenerate at
[app.netlify.com/user/applications](https://app.netlify.com/user/applications)
and re-enter in admin Settings → Deploy Providers → Netlify.

### "Deploy stuck in 'uploading' state"

Netlify has a 5-minute upload timeout. Large bundles (>100 MB) may exceed
this. Split the bundle or use Cloudflare Pages (no upload size limit).

### "Site loads but CSS / JS 404"

Verify the `netlify.toml` was deployed with the bundle (open the Netlify UI →
Site settings → Continuous deployment → Build settings to inspect). If
missing, the wizard didn't write it — regenerate.

### "Firebase auth not working"

Add your Netlify URL (`https://{random}.netlify.app`) to the Firebase
project's authorized domains.

## What's next

- [Vercel](vercel.md) — alternative deploy target.
- [Rollback](rollback.md) — how to roll back.
- [Netlify API docs](https://docs.netlify.com/api/get-started/) — for custom
  automation.
