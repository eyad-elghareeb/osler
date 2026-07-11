"use client";

import * as React from "react";
import { Download, Check, Loader2, Trash2, CloudOff, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useContentCache } from "@/hooks/use-content-cache";
import { useI18n } from "@/components/osler/i18n-provider";

/**
 * ContentCacheButton — small per-pack download/remove button.
 *
 * Shows one of:
 *   • Download icon (not cached / unknown) — click to precache
 *   • Spinner (downloading) — shows progress count
 *   • Check icon (cached) — click to remove from cache
 *   • Alert icon (error) — click to retry
 *
 * The button is a "small download button" as requested: it's a single
 * icon-only control that fits inside a pack card without disrupting the
 * layout. Calls `e.stopPropagation()` so it works inside a clickable card.
 */
interface ContentCacheButtonProps {
  packId: string;
  /** URLs to cache for this pack (manifest + data files). */
  urls: string[];
  className?: string;
  /** Visual size — matches the surrounding card icon size. */
  size?: "sm" | "md";
  /** Tone — "default" for light backgrounds, "muted" for subtle card chrome. */
  tone?: "default" | "muted";
}

export function ContentCacheButton({
  packId,
  urls,
  className,
  size = "sm",
  tone = "muted",
}: ContentCacheButtonProps) {
  const { getState, getProgress, checkStatus, precache, remove, swReady } = useContentCache();
  const state = getState(packId);
  const progress = getProgress(packId);

  // Check cache status once on mount (and when SW becomes ready)
  React.useEffect(() => {
    if (swReady && state === "unknown") {
      checkStatus(packId, urls);
    }
  }, [packId, urls, state, checkStatus, swReady]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!swReady) return;
    if (state === "cached" || state === "partial") {
      remove(packId, urls);
    } else if (state !== "downloading") {
      precache(packId, urls);
    }
  };

  const sizeClass = size === "sm" ? "size-7" : "size-8";
  const iconSize = size === "sm" ? "size-3.5" : "size-4";

  const { t } = useI18n();
  // Choose icon + color based on state
  let icon: React.ReactNode;
  let label = t("cache.download");
  let colorClass: string;

  if (!swReady) {
    // SW not available (dev mode or unsupported) — don't render the button
    return null;
  }

  switch (state) {
    case "downloading":
      icon = <Loader2 className={cn(iconSize, "animate-spin")} />;
      label = progress
        ? t("cache.downloading", { done: progress.done, total: progress.total })
        : t("cache.downloadingSimple");
      colorClass = "text-primary";
      break;
    case "cached":
      icon = <Check className={iconSize} />;
      label = t("cache.cached");
      colorClass = "text-emerald-500 dark:text-emerald-400";
      break;
    case "partial":
      icon = <Check className={iconSize} />;
      label = t("cache.partial");
      colorClass = "text-amber-500";
      break;
    case "error":
      icon = <AlertCircle className={iconSize} />;
      label = t("cache.error");
      colorClass = "text-destructive";
      break;
    case "not-cached":
    case "unknown":
    default:
      icon = <Download className={iconSize} />;
      label = "Download for offline";
      colorClass =
        tone === "muted"
          ? "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60";
      break;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={state === "cached" || state === "partial"}
      disabled={state === "downloading"}
      className={cn(
        "rounded-lg flex items-center justify-center transition-colors shrink-0 medos-touch-target",
        sizeClass,
        colorClass,
        state === "downloading" && "cursor-wait",
        className
      )}
    >
      {icon}
    </button>
  );
}

/**
 * Helper — build the list of URLs for a content pack given its node.
 * Used by all studios (qbank, flashcard, osce) to feed ContentCacheButton.
 */
export function buildPackUrls(
  basePath: string,
  files: string[] | undefined,
  includeManifest = true
): string[] {
  const urls: string[] = [];
  if (includeManifest) {
    // The manifest URL is the category manifest, not the pack manifest.
    // Each pack doesn't have its own manifest — the category manifest lists
    // all packs. We don't include it per-pack to avoid duplicate caching.
  }
  if (files && files.length > 0) {
    for (const file of files) {
      urls.push(`${basePath}${file}`);
    }
  }
  return urls;
}

// Re-export for convenience
export { CloudOff };
