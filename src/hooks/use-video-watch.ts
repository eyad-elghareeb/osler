import * as React from "react";
import { videoWatch, VIDEO_WATCH_EVENT } from "@/lib/osler/storage";

/**
 * Reactive view of the per-video watched set.
 *
 * Backed by the `videoWatch` store (IndexedDB + memory cache, synced to the
 * cloud under the `videos` kind and over P2P/file sync) — this hook only
 * subscribes to its change event so cards, filters, and counts repaint
 * whenever any device or session marks a video.
 */
export function useVideoWatch(): Set<string> {
  const [watched, setWatched] = React.useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set<string>() : new Set(videoWatch.live()),
  );

  React.useEffect(() => {
    const reload = () => setWatched(new Set(videoWatch.live()));
    reload();
    window.addEventListener(VIDEO_WATCH_EVENT, reload);
    return () => window.removeEventListener(VIDEO_WATCH_EVENT, reload);
  }, []);

  return watched;
}
