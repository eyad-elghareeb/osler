/**
 * Cloudflare Pages Function: fix Next static-export RSC 404s.
 *
 * Static export emits RSC payloads at /<seg>/__next.<hash>/<seg>.txt (slash)
 * but the client prefetches /<seg>/__next.<hash>.<seg>.txt (dot). When the
 * dot-path file doesn't exist (404), this Function rewrites it to the slash
 * path and serves the static asset via ASSETS.
 *
 * It also handles the __PAGE__ variant:
 *   /<seg>/__next.<hash>.<seg>.__PAGE__.txt → /<seg>/__next.<hash>/<seg>/__PAGE__.txt
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Only intercept RSC txt fetches that look like the dot-form.
  // Patterns:
  //   /settings/__next.!KGFwcCk.settings.txt
  //   /settings/__next.!KGFwcCk.settings.__PAGE__.txt
  if (pathname.includes("/__next.") && pathname.endsWith(".txt")) {
    // Try dot → slash rewrite for the plain segment payload
    // e.g. /settings/__next.!KGFwcCk.settings.txt → /settings/__next.!KGFwcCk/settings.txt
    let rewritten = pathname.replace(
      /^(\/[^/]+)\/__next\.([^/]+)\.([^/.]+)\.txt$/,
      "$1/__next.$2/$3.txt"
    );
    // If still unchanged, try the __PAGE__ variant
    if (rewritten === pathname) {
      rewritten = pathname.replace(
        /^(\/[^/]+)\/__next\.([^/]+)\.([^/.]+)\.__PAGE__\.txt$/,
        "$1/__next.$2/$3/__PAGE__.txt"
      );
    }

    if (rewritten !== pathname) {
      const assetUrl = new URL(rewritten + url.search, url.origin);
      // Fetch the static asset from the Pages asset store.
      // context.env.ASSETS is available in Pages Functions.
      try {
        const assetRequest = new Request(assetUrl.toString(), context.request);
        const res = await context.env.ASSETS.fetch(assetRequest);
        if (res.ok) {
          // Clone with correct headers for RSC payloads
          const headers = new Headers(res.headers);
          headers.set("Cache-Control", "public, max-age=0, must-revalidate");
          return new Response(res.body, { status: res.status, headers });
        }
      } catch {}
    }
  }

  // Fallback: let Pages serve the original request (static file or 404)
  return context.next();
}
