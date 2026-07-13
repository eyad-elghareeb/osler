/**
 * Osler Wake Lock — wrapper around the Screen Wake Lock API.
 *
 * Docs: https://whatpwacando.today/wake-lock/
 * Spec: https://w3c.github.io/screen-wake-lock/
 *
 * Design notes:
 *  - The Screen Wake Lock API prevents the screen from dimming/sleeping.
 *    Osler requests a wake lock while the video player is open so a long
 *    lecture doesn't get cut off by the OS auto-locking the screen.
 *  - The lock is *automatically released* by the browser when the tab is
 *    backgrounded, the page is unloaded, or the document loses visibility.
 *    On visibility regained we re-acquire the lock (the caller passes a
 *    "still wanted" predicate).
 *  - Wake Lock requires `allow="wake-lock"` permission policy (the
 *    default is `self` for top-level docs, so this works out of the box).
 *  - iOS Safari 16.4+ supports it; older iOS Safari silently no-ops.
 *  - The lock object has a `released` boolean and a `release()` method.
 *    We wrap it so callers don't deal with the sentinel directly.
 */

export interface WakeLockHandle {
  release(): Promise<void>;
  /** Sentinel exposed for tests / debugging. */
  sentinel: any | null;
}

let activeSentinel: any | null = null;
let activePredicate: (() => boolean) | null = null;
let visibilityHandler: (() => void) | null = null;
let releaseListeners: Array<() => void> = [];

export function isWakeLockSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as any).wakeLock?.request === "function";
}

/**
 * Acquire a screen wake lock. The lock is automatically released when
 * the document becomes hidden, and re-acquired when it becomes visible
 * again — but only if `predicate()` still returns true at that time.
 *
 * @param predicate Called on visibility regained to decide whether to
 *                  re-acquire. Returning false releases the lock
 *                  permanently.
 */
export async function acquireWakeLock(
  predicate: () => boolean = () => true,
): Promise<WakeLockHandle | null> {
  if (!isWakeLockSupported()) return null;
  if (typeof document === "undefined") return null;
  // Wake locks cannot be acquired while the document is hidden — wait for
  // visibility change if needed.
  if (document.visibilityState === "hidden") {
    return null;
  }

  // Release any existing lock first.
  await releaseWakeLock();

  activePredicate = predicate;
  try {
    activeSentinel = await (navigator as any).wakeLock.request("screen");
  } catch (err: any) {
    if (err?.name === "NotAllowedError") return null;
    if (err?.name === "NotSupportedError") return null;
    // Re-throw unexpected errors so the caller can surface them.
    throw err;
  }

  // Wire up visibility handling — re-acquire when visible again.
  if (!visibilityHandler) {
    visibilityHandler = async () => {
      if (document.visibilityState !== "visible") return;
      if (!activePredicate || !activePredicate()) {
        await releaseWakeLock();
        return;
      }
      // The sentinel may have been auto-released by the browser — try to
      // re-acquire a new one.
      if (!activeSentinel || activeSentinel.released) {
        try {
          activeSentinel = await (navigator as any).wakeLock.request("screen");
          // Re-fire release listeners if they need to know about the new sentinel.
          releaseListeners.forEach((fn) => fn());
        } catch {
          /* ignore — best effort */
        }
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }

  return {
    release: () => releaseWakeLock(),
    sentinel: activeSentinel,
  };
}

export async function releaseWakeLock(): Promise<void> {
  if (activeSentinel && typeof activeSentinel.release === "function") {
    try {
      await activeSentinel.release();
    } catch { /* noop */ }
  }
  activeSentinel = null;
  activePredicate = null;
  releaseListeners = [];
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

/** Whether a wake lock is currently held. */
export function isWakeLockActive(): boolean {
  return !!activeSentinel && !activeSentinel.released;
}
