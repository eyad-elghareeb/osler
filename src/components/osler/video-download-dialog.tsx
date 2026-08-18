"use client";

import * as React from "react";
import { Check, Download, Loader2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { useI18n } from "./i18n-provider";

/* ── Types ─────────────────────────────────────────────────────────── */

type DownloadGroup = "muxed" | "video" | "audio";
type RowStatus = "idle" | "downloading" | "done" | "error";

interface DownloadFormat {
  key: string;
  label: string;
  ext: string;
  url: string;
  size?: number;
  bitrate?: number;
  group: DownloadGroup;
}

interface VideoDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** YouTube video ID to query on the Invidious host. */
  videoId: string;
  /** Video title — used to build the downloaded file name. */
  title: string;
  /** Invidious instance host (no scheme, e.g. "invidious.tiekoetter.com"). */
  host: string;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function extOf(type: string | undefined): string {
  if (!type) return "mp4";
  const m = type.match(/^[a-z0-9.]+\/([a-z0-9.]+)/i);
  return m ? m[1] : "mp4";
}

function fmtBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function fmtKbps(bitrate: number): string {
  return `${Math.round(bitrate / 1000)} kbps`;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "video";
}

/* ── Component ─────────────────────────────────────────────────────── */

export function VideoDownloadDialog({ open, onOpenChange, videoId, title, host }: VideoDownloadDialogProps) {
  const { t } = useI18n();

  const [formats, setFormats] = React.useState<DownloadFormat[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [statuses, setStatuses] = React.useState<Record<string, RowStatus>>({});
  const [activeKey, setActiveKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFormats([]);
    setStatuses({});
    setActiveKey(null);
    setLoading(true);
    setLoadError(false);

    (async () => {
      try {
        const res = await fetch(`https://${host}/api/v1/videos/${videoId}?fields=formatStreams,adaptiveFormats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;

        const list: DownloadFormat[] = [];
        const streamList = Array.isArray(data.formatStreams) ? (data.formatStreams as any[]) : [];
        for (const s of streamList) {
          list.push({
            key: `muxed-${s.itag}`,
            label: typeof s.quality === "string" ? s.quality : "Video",
            ext: extOf(s.type),
            url: s.url,
            size: Number(s.size) || undefined,
            group: "muxed",
          });
        }
        const adaptiveList = Array.isArray(data.adaptiveFormats) ? (data.adaptiveFormats as any[]) : [];
        for (const f of adaptiveList) {
          const type: string = typeof f.type === "string" ? f.type : "";
          if (type.startsWith("video/")) {
            list.push({
              key: `video-${f.itag}`,
              label: typeof f.qualityLabel === "string" ? f.qualityLabel : "Video",
              ext: extOf(type),
              url: f.url,
              size: Number(f.size) || undefined,
              bitrate: Number(f.bitrate) || undefined,
              group: "video",
            });
          } else if (type.startsWith("audio/")) {
            list.push({
              key: `audio-${f.itag}`,
              label: t("videos.downloadModal.audioOnly"),
              ext: extOf(type),
              url: f.url,
              size: Number(f.size) || undefined,
              bitrate: Number(f.bitrate) || undefined,
              group: "audio",
            });
          }
        }
        setFormats(list);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, videoId, host, t]);

  const startDownload = async (f: DownloadFormat) => {
    haptic("light");
    if (activeKey) return;
    setActiveKey(f.key);
    setStatuses((prev) => ({ ...prev, [f.key]: "downloading" }));
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${sanitizeFileName(title)}.${f.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      setStatuses((prev) => ({ ...prev, [f.key]: "done" }));
      haptic("success");
    } catch {
      setStatuses((prev) => ({ ...prev, [f.key]: "error" }));
      haptic("error");
    } finally {
      setActiveKey(null);
    }
  };

  const groups: DownloadGroup[] = ["muxed", "video", "audio"];
  const groupLabels: Record<DownloadGroup, string> = {
    muxed: t("videos.downloadModal.muxed"),
    video: t("videos.downloadModal.videoOnly"),
    audio: t("videos.downloadModal.audioOnly"),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] max-w-md">
        <DialogHeader>
          <DialogTitle>{t("videos.downloadModal.title")}</DialogTitle>
          <DialogDescription>{t("videos.downloadModal.subtitle")}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("videos.downloadModal.loading")}
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {t("videos.downloadModal.error")}
          </div>
        )}

        {!loading && !loadError && formats.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("videos.downloadModal.empty")}
          </div>
        )}

        {!loading && !loadError && formats.length > 0 && (
          <div className="osler-scroll-y max-h-[50vh] space-y-4 pr-1">
            {groups.map((group) => {
              const rows = formats.filter((f) => f.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupLabels[group]}
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((f) => {
                      const st = statuses[f.key] ?? "idle";
                      const busy = activeKey !== null && activeKey !== f.key;
                      return (
                        <div key={f.key} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{f.label}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              <span className="uppercase">{f.ext}</span>
                              {f.size != null && <span> · {fmtBytes(f.size)}</span>}
                              {f.bitrate != null && <span> · {fmtKbps(f.bitrate)}</span>}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={st === "done" ? "secondary" : st === "error" ? "outline" : "default"}
                            disabled={busy || st === "done" || st === "downloading"}
                            className={cn(st === "error" && "border-destructive/40 text-destructive hover:text-destructive")}
                            onClick={() => {
                              if (st !== "done" && st !== "downloading") void startDownload(f);
                            }}
                          >
                            {st === "downloading" ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : st === "done" ? (
                              <Check className="size-3.5" />
                            ) : st === "error" ? (
                              <RotateCcw className="size-3.5" />
                            ) : (
                              <Download className="size-3.5" />
                            )}
                            {st === "downloading"
                              ? t("videos.downloadModal.downloading")
                              : st === "done"
                                ? t("videos.downloadModal.saved")
                                : st === "error"
                                  ? t("videos.downloadModal.retry")
                                  : t("videos.download")}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
