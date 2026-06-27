# Deploy to Vercel

Vercel is a static host optimized for frontend frameworks, but it works
equally well for vanilla JS PWAs. Free tier: 100 GB bandwidth, 100 GB-hours
build time per month. Good choice if you already use Vercel for other
projects.

## Prerequisites

- A Vercel account — sign up at [vercel.com](https://vercel.com/) (free,
  GitHub login supported)
- A Vercel access token — generate at
  [vercel.com/account/tokens](https://vercel.com/account/tokens)
- The token configured in the admin (see
  [Settings → Deploy Providers](../admin-dashboard/settings.md#vercel))

## One-click deploy from the wizard

After [generating a bundle](../site-generation/wizard.md), pick **Vercel**
in Step 5 and click **Deploy now**. The admin:

1. **Calls the Vercel API** (`POST /v10/projects`) to create a new project
   with no Git repository (the admin uploads the bundle directly, not via
   Git).
2. **Calls the Vercel API** (`POST /v13/deployments`) to create a new
   deployment with the bundle files inline.
3. **Waits for the deployment** to be ready (polls
   `GET /v13/deployments/{deployment_id}` until status is `READY`).
4. **Returns the URL** — `https://{random}.vercel.app`

The deploy takes ~10-20 seconds depending on bundle size.

## Manual deploy via Vercel CLI

If you prefer to deploy via Vercel's CLI:

1. Install the Vercel CLI: `npm install -g vercel`
2. Authenticate: `vercel login`
3. In the wizard, click **Save zip** and unzip locally.
4. `cd` into the unzipped bundle.
5. Run `vercel --prod` (the `--prod` flag skips the preview deploy).
6. Vercel prompts for project name and settings (accept defaults).
7. Vercel returns the production URL.

This is useful if the admin's Vercel integration isn't working or you want
to use Vercel's Git-based deploy model (push to a Git repo, Vercel auto-builds
on each push).

## Site configuration

The wizard writes a `vercel.json` file into the bundle:

```json
{
  "version": 2,
  "public": true,
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache" }
      ]
    },
    {
      "source": "/update-manifest.json",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache" }
      ]
    },
    {
      "source": "/engines/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/content/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    }
  ],
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

This mirrors the Netlify config:

- `no-cache` on `sw.js` and `update-manifest.json` for SW update flow.
- 1-year immutable caching on `engines/` and `content/` (hashed file names).
- SPA routing (all paths serve `index.html`).

## URL patterns

| Tier | URL pattern | Cost |
|------|-------------|------|
| Default subdomain | `https://{random}.vercel.app` | Free |
| Custom domain | `https://{your-domain}` | Free (you own the domain) |

To rename the subdomain: Vercel UI → Project → Settings → Domains → Edit.
To add a custom domain: Vercel UI → Project → Settings → Domains → Add.

V2 anti-goal: the admin dashboard does NOT manage custom domains. Use the
Vercel UI.

## Update behavior

When you redeploy via the admin, Vercel creates a new deployment. The
previous deployments remain accessible via their unique URLs (Vercel gives
each deployment a permanent URL like
`https://{project}-{hash}.vercel.app`). The "production" URL always points
to the latest deploy marked as production.

Users get the update on next visit via the service worker update flow.

## Rollback

Vercel supports instant rollback:

1. Go to Vercel UI → Project → Deployments.
2. Find the deploy to roll back to.
3. Click the `...` menu → **Promote to Production**.
4. Vercel atomically swaps the production URL to that deployment.

Or use the admin's **Deploy → History → Roll back** button (calls the Vercel
API under the hood). The admin keeps the last 5 deploys in history per
Vercel project.

See [Rollback](rollback.md) for the cross-provider rollback flow.

## Limitations

- **Free tier:** 100 GB bandwidth / month, 100 GB-hours build / month,
  unlimited static sites.
- **Build time:** not applicable for Osler (admin does the build locally;
  Vercel just serves the files).
- **File size limit:** 100 MB per file on free tier.
- **Serverless functions:** 10s execution limit on free tier (Osler doesn't
  use them — V2 anti-goal §5.12).
- **Edge functions:** not used by Osler.

## Troubleshooting

### "Vercel API: 403 Forbidden"

The Vercel token doesn't have the right scopes. Regenerate with "Full
Account" scope at [vercel.com/account/tokens](https://vercel.com/account/tokens).

### "Deployment failed: build script not found"

Vercel is trying to run a build step. The `vercel.json` should have
`"buildCommand": null` and `"outputDirectory": "."` to skip the build. If
missing, regenerate the bundle (the wizard writes them by default).

### "Site loads but routing is broken (404 on /quiz/123)"

The SPA rewrite isn't applied. Verify `vercel.json` has the `rewrites`
section. If you deployed via Vercel CLI, make sure `vercel.json` is at the
bundle root.

### "Firebase auth not working"

Add your Vercel URL (`https://{random}.vercel.app`) to the Firebase
project's authorized domains.

## What's next

- [Cloudflare Pages](cloudflare-pages.md) — alternative deploy target.
- [Rollback](rollback.md) — how to roll back.
- [Vercel API docs](https://vercel.com/docs/rest-api) — for custom automation.
