"use client";

import * as React from "react";
import { CheckCircle2, Download, ExternalLink, Loader2, RefreshCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import {
  COBALT_ENABLED,
  COBALT_KEY,
  classifyError,
  createSession,
  fetchInstanceInfo,
  requestDownload,
  type CobaltDownloadResult,
  type CobaltInstanceInfo,
  type DownloadFailure,
} from "@/lib/osler/cobalt";
import { useI18n } from "./i18n-provider";

/* ── Turnstile widget (explicit render, no dependency) ─────────────── */

function TurnstileChallenge({ sitekey, onToken, onExpire }: { sitekey: string; onToken: (token: string) => void; onExpire?: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onTokenRef = React.useRef(onToken);
  const onExpireRef = React.useRef(onExpire);
  React.useEffect(() => {
    onTokenRef.current = onToken;
    onExpireRef.current = onExpire;
  });

  React.useEffect(() => {
    let widgetId: string | undefined;
    let script: HTMLScriptElement | undefined;
    const render = () => {
      if (!ref.current || !window.turnstile) return;
      widgetId = window.turnstile.render(ref.current, {
        sitekey,
        theme: "auto",
        size: "flexible",
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onExpireRef.current?.(),
      });
    };
    if (window.turnstile) {
      render();
    } else {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      script?.remove();
    };
  }, [sitekey]);

  return <div ref={ref} className="min-h-16 w-full" />;
}

/* ── Types ─────────────────────────────────────────────────────────── */

type Phase = "booting" | "ready" | "auth" | "processing" | "done" | "picker" | "error";

const QUALITY_OPTIONS = [
  { id: "best", quality: "max" },
  { id: "1080", quality: "1080" },
  { id: "720", quality: "720" },
  { id: "480", quality: "480" },
  { id: "360", quality: "360" },
] as const;

interface VideoDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  title?: string;
}

/* ── Component ─────────────────────────────────────────────────────── */

export function VideoDownloadDialog({ open, onOpenChange, videoId, title }: VideoDownloadDialogProps) {
  const { t } = useI18n();

  const [phase, setPhase] = React.useState<Phase>("booting");
  const [instance, setInstance] = React.useState<CobaltInstanceInfo | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [quality, setQuality] = React.useState<(typeof QUALITY_OPTIONS)[number]["id"] | "audio">("best");
  const [result, setResult] = React.useState<CobaltDownloadResult | null>(null);
  const [failure, setFailure] = React.useState<DownloadFailure>("unknown");
  const [retryKey, setRetryKey] = React.useState(0);

  const boot = React.useCallback(async () => {
    setPhase("booting");
    setInstance(null);
    setToken(null);
    setResult(null);
    try {
      const inst = await fetchInstanceInfo();
      setInstance(inst);
      setPhase(COBALT_KEY || !inst?.turnstileSitekey ? "ready" : "auth");
    } catch {
      setFailure("unavailable");
      setPhase("error");
    }
  }, []);

  React.useEffect(() => {
    if (open) void boot();
  }, [open, retryKey, boot]);

  const handleToken = React.useCallback((t: string) => {
    setToken(t);
    haptic("selection");
    setPhase("ready");
  }, []);

  const handleTokenExpire = React.useCallback(() => {
    setToken(null);
    haptic("warning");
    setPhase("auth");
  }, []);

  const openUrl = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownload = async () => {
    if (phase === "processing" || !instance) return;
    haptic("selection");
    setPhase("processing");
    setResult(null);
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const isAudio = quality === "audio";
      const opts = isAudio
        ? { mode: "audio" as const, videoQuality: "max" }
        : { mode: "video" as const, videoQuality: QUALITY_OPTIONS.find((q) => q.id === quality)?.quality ?? "max" };

      let auth: { kind: "apiKey" | "bearer"; token: string } | undefined;
      if (COBALT_KEY) {
        auth = { kind: "apiKey", token: COBALT_KEY };
      } else if (token) {
        const jwt = await createSession(token);
        auth = { kind: "bearer", token: jwt };
      } else if (instance.turnstileSitekey) {
        setPhase("auth");
        return;
      }

      const res = await requestDownload(watchUrl, opts, auth);
      if (res.status === "tunnel" || res.status === "redirect") {
        if (res.url) openUrl(res.url);
        setResult(res);
        setPhase("done");
      } else if (res.status === "picker") {
        setResult(res);
        setPhase("picker");
      } else {
        const kind = res.errorCode?.includes("auth")
          ? "auth"
          : res.errorCode?.includes("rate")
            ? "rate"
            : "unknown";
        setFailure(kind);
        setPhase("error");
      }
    } catch (err) {
      setFailure(classifyError(err));
      setPhase("error");
    }
  };

  const failureMessage = (kind: DownloadFailure) => {
    if (kind === "auth") return t("videos.downloadModal.authRequired");
    if (kind === "rate") return t("videos.downloadModal.rateLimited");
    if (kind === "unavailable") return t("videos.downloadModal.unavailable");
    return t("videos.downloadModal.error");
  };

  const isAudio = quality === "audio";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] max-w-md">
        <DialogHeader>
          <DialogTitle>{t("videos.downloadModal.title")}</DialogTitle>
          <DialogDescription>{t("videos.downloadModal.subtitle")}</DialogDescription>
        </DialogHeader>

        {phase === "booting" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("videos.downloadModal.loading")}
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {failureMessage(failure)}
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRetryKey((k) => k + 1)}>
              <RefreshCcw className="size-3.5" />
              {t("videos.downloadModal.retry")}
            </Button>
          </div>
        )}

        {phase === "auth" && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
              {t("videos.downloadModal.verify")}
            </p>
            {instance?.turnstileSitekey && <TurnstileChallenge sitekey={instance.turnstileSitekey} onToken={handleToken} onExpire={handleTokenExpire} />}
          </div>
        )}

        {(phase === "ready" || phase === "processing") && (
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("videos.downloadModal.quality")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUALITY_OPTIONS.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => {
                      haptic("selection");
                      setQuality(q.id);
                    }}
                    className={cn(
                      "px-2.5 h-8 rounded-md text-xs font-medium transition-colors border",
                      quality === q.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border",
                    )}
                  >
                    {q.id === "best" ? t("videos.downloadModal.best") : `${q.id}p`}
                  </button>
                ))}
                <button
                  onClick={() => {
                    haptic("selection");
                    setQuality("audio");
                  }}
                  className={cn(
                    "px-2.5 h-8 rounded-md text-xs font-medium transition-colors border",
                    isAudio
                      ? "bg-primary text-primary-foreground border-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border",
                  )}
                >
                  {t("videos.downloadModal.audioOnly")}
                </button>
              </div>
            </div>

            {token && instance?.turnstileSitekey && (
              <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-xs text-success">
                <CheckCircle2 className="size-3.5" />
                {t("videos.downloadModal.verified")}
              </div>
            )}

            <Button className="w-full gap-1.5" size="lg" loading={phase === "processing"} onClick={handleDownload}>
              <Download className="size-4" />
              {phase === "processing" ? t("videos.downloadModal.processing") : t("videos.downloadModal.download")}
            </Button>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
              {t("videos.downloadModal.hint")}
            </p>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">{t("videos.downloadModal.started")}</div>
                {result?.filename && <div className="mt-0.5 truncate text-xs">{result.filename}</div>}
              </div>
            </div>
            <Button className="w-full gap-1.5" size="lg" onClick={handleDownload}>
              <Download className="size-4" />
              {t("videos.downloadModal.downloadAgain")}
            </Button>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
              {t("videos.downloadModal.hint")}
            </p>
          </div>
        )}

        {phase === "picker" && result?.picker && (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">{t("videos.downloadModal.picker")}</div>
            {result.picker.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="truncate text-sm font-medium">{item.type}</div>
                <Button size="sm" variant="outline" onClick={() => item.url && openUrl(item.url)}>
                  <Download className="size-3.5" />
                  {t("videos.download")}
                </Button>
              </div>
            ))}
          </div>
        )}

        {title && (
          <p className="truncate text-xs text-muted-foreground" title={title}>
            {title}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { COBALT_ENABLED };
