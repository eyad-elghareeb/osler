/**
 * Osler Permissions — wrapper around the Permissions API + getUserMedia
 * for microphone / camera capability checks.
 *
 * Docs: https://developer.mozilla.org/docs/Web/API/Permissions_API
 *
 * Design notes:
 *  - The Permissions API descriptor names ("microphone", "camera") are NOT
 *    supported everywhere (Firefox and iOS Safari throw TypeError on
 *    query) — every query is feature-detected and falls back to "prompt".
 *  - Actually asking the user requires a getUserMedia probe with minimal
 *    constraints; the stream is stopped immediately. Callers must invoke
 *    this from a user gesture (button tap) so the browser can show the
 *    permission prompt.
 *  - getUserMedia only exists in secure contexts (HTTPS / localhost / an
 *    installed PWA that inherited the privilege) — report "unsupported"
 *    otherwise so UIs can explain instead of throwing.
 */

export type MediaPermissionKind = "microphone" | "camera";

/** "unsupported" — insecure context or no mediaDevices (e.g. plain-HTTP LAN). */
export type MediaPermissionState = "granted" | "denied" | "prompt" | "unsupported";

const CONSTRAINTS: Record<MediaPermissionKind, MediaStreamConstraints> = {
  microphone: { audio: true },
  camera: { video: { facingMode: "user" } },
};

/** Whether mic/camera can be requested at all (secure context + mediaDevices). */
export function isMediaCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Read the current permission state without prompting. */
export async function queryMediaPermission(kind: MediaPermissionKind): Promise<MediaPermissionState> {
  if (!isMediaCaptureSupported()) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state as MediaPermissionState;
  } catch {
    // Firefox / iOS Safari don't support mic/camera descriptors — assume
    // the browser will prompt on next use.
    return "prompt";
  }
}

/**
 * Ask the user for `kind` via a minimal getUserMedia probe (tracks are
 * stopped immediately). Call from a user gesture so the browser may show
 * its permission prompt. Resolves to "denied" when the user (or a
 * Permissions-Policy / remembered denial) blocks the request.
 */
export async function requestMediaPermission(kind: MediaPermissionKind): Promise<MediaPermissionState> {
  if (!isMediaCaptureSupported()) return "unsupported";
  try {
    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS[kind]);
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
      // No such device (or it's busy) — the *permission* itself wasn't the
      // blocker; treat as granted so UIs don't loop on re-request.
      return "granted";
    }
    return "denied";
  }
}
