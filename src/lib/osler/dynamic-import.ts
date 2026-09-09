"use client";

/**
 * Resilient dynamic imports for every code-split surface (settings panes,
 * lazy overlays, structured editors, article views, sync modal) and heavy
 * vendor chunks (mermaid, plyr).
 *
 * Chunk loads fail transiently on stale-deploy races (old shell referencing
 * pruned chunks) and first-visit offline gaps. A single retry — after nudging
 * the service worker to update so the second attempt resolves against fresh
 * chunks — converts most full-page errors into a slightly slower open.
 * Re-throws the first error when the retry also fails so callers keep their
 * real error states.
 */
export async function resilientImport<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (firstError) {
    try {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch {
      // fall through to the retry below
    }
    try {
      return await loader();
    } catch {
      throw firstError;
    }
  }
}
