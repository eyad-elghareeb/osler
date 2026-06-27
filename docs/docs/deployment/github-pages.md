# Deploy to GitHub Pages

GitHub Pages is the simplest deploy target — free, no separate account,
already integrated with the GitHub token the admin uses for CMS. Recommended
for first-time deploys.

## Prerequisites

- A GitHub account (already signed in to the admin)
- A repository for the site (the admin can create one)
- The repo must be public for free GitHub Pages (private repos require
  GitHub Pro for Pages)

## One-click deploy from the wizard

After [generating a bundle](../site-generation/wizard.md), pick **GitHub
Pages** in Step 5 and click **Deploy now**. The admin:

1. **Picks or creates a repo.** If you don't have one, the admin offers to
   create `{username}.github.io` (which deploys to
   `https://{username}.github.io/`) or `osler-site-{name}` (which deploys to
   `https://{username}.github.io/osler-site-{name}/`).
2. **Creates an orphan `gh-pages` branch** in the repo (orphan = no commit
   history, so the Pages branch doesn't bloat the repo).
3. **Pushes the bundle** as the branch root (replaces any existing content).
4. **Enables Pages** on the repo settings (via the GitHub API):
   - Source: `gh-pages` branch
   - Visibility: matches repo visibility
5. **Returns the URL** — `https://{username}.github.io/{repo}/`

The deploy takes ~30 seconds. The first deploy may take up to 5 minutes for
GitHub's CDN to propagate.

## Manual deploy

If you prefer to deploy manually:

1. In the wizard, click **Save zip** instead of **Deploy now**.
2. Unzip the bundle locally.
3. Create a `gh-pages` branch in your repo:
   ```bash
   cd your-repo
   git checkout --orphan gh-pages
   git rm -rf .
   ```
4. Copy the bundle files into the repo root.
5. Commit and push:
   ```bash
   git add .
   git commit -m "deploy: osler site v1.0.0"
   git push origin gh-pages
   ```
6. In the GitHub repo settings → Pages → set Source to `gh-pages` branch.

## URL patterns

| Repo name | URL |
|-----------|-----|
| `{username}.github.io` | `https://{username}.github.io/` |
| `{repo-name}` | `https://{username}.github.io/{repo-name}/` |

The PWA's `manifest.webmanifest` and `sw.js` use relative paths, so they
work at any subpath. The `config.json`'s `basePath` field is auto-set by
the wizard based on the chosen repo name.

## Custom domain

GitHub Pages supports custom domains. To use one:

1. In the GitHub repo settings → Pages → Custom domain → enter your domain
   (e.g. `osler.example.com`).
2. Configure DNS:
   - For apex domains: A records pointing to GitHub Pages IPs
     (185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153)
   - For subdomains: CNAME record pointing to `{username}.github.io`
3. Wait for DNS to propagate (minutes to hours).
4. Check "Enforce HTTPS" in the Pages settings.

The Osler bundle works on custom domains without modification — all paths
are relative. The service worker registers at the domain root.

V2 anti-goal: the admin dashboard does NOT manage custom domains. Use the
GitHub repo settings UI (or the `gh` CLI).

## Update behavior

When you redeploy (regenerate + push), GitHub Pages serves the new bundle
within ~30 seconds of the push. Users who have the PWA installed will get
the update on next visit via the service worker update flow (see
[Bundle Updates](../admin-dashboard/bundle-update.md)).

## Limitations

- **Repo size limit:** 1 GB recommended (soft), 5 GB hard limit. Large
  content bundles (100s of MB of images) will hit this. Use Cloudflare Pages
  or Netlify for larger sites.
- **Bandwidth limit:** 100 GB/month soft limit. Sites with heavy traffic
  may exceed this.
- **Build time:** GitHub Pages doesn't run a build step (it serves the
  `gh-pages` branch as-is). The Osler wizard does the build locally and
  pushes the built files.
- **HTTPS:** enforced by default. HTTP requests redirect to HTTPS.
- **Single Pages site per GitHub account** for the `{username}.github.io`
  repo. Multiple project sites (`{username}.github.io/{repo}/`) are
  unlimited.

## Troubleshooting

### "404 — There isn't a GitHub Pages site here"

- Wait — first deploys take up to 5 minutes.
- Verify the `gh-pages` branch exists and has an `index.html` at the root.
- Verify Pages is enabled in repo settings → Pages.
- Verify the source branch is `gh-pages` (not `main`).

### "CSS / JS not loading"

- Check the browser's network tab — files should return 200.
- If 404, the file paths in `index.html` don't match the bundle structure.
  This indicates a bug in the wizard — report it.
- If serving from a subpath (`{username}.github.io/{repo}/`), verify the
  paths are relative (start with `./` or no leading slash).

### "Service worker not registering"

- Open DevTools → Application → Service Workers. Check the error.
- GitHub Pages serves over HTTPS by default — SW should work.
- Verify `sw.js` is at the repo root (not in a subdirectory).

### "Firebase auth not working"

- Add your GitHub Pages URL to the Firebase project's authorized domains
  (Firebase console → Auth → Settings → Authorized domains).
- The URL pattern is `https://{username}.github.io` (no trailing slash, no
  path).

## What's next

- [Netlify](netlify.md) — alternative deploy target.
- [Rollback](rollback.md) — how to roll back a bad deploy.
- [Operations → CI/CD](../operations/ci-cd.md) — automating deploys.
