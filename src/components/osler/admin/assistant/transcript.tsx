"use client";

// Presentational layer of the /admin/assistant harness: memoized transcript
// rows (a streaming token must not re-render settled bubbles), markdown
// rendering via the shared AiMarkdown component (react-markdown, no raw
// HTML — model output can never inject markup), copy affordances, token
// badges, and "Open in editor" deep links for content ids surfaced by tool
// results.

import * as React from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { AiMarkdown } from "@/components/osler/ai-markdown";
import type { ChatMsg } from "./types";

export function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…[truncated]` : text;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Copy-to-clipboard button with a flashed "Copied" state. Used on message
 *  bubbles and tool result blocks. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    haptic("light");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (insecure context) — fail silently.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground",
        "opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100",
      )}
      aria-label={label ?? "Copy"}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

function UsageBadge({ inputTokens, outputTokens, durationMs }: { inputTokens: number; outputTokens: number; durationMs: number }) {
  const { t } = useI18n();
  if (!inputTokens && !outputTokens) return null;
  return (
    <span
      dir="ltr"
      className="mt-1.5 block text-[10px] text-muted-foreground/80"
      title={t("admin.assistant.tokensHint")}
    >
      ↑{formatTokens(inputTokens)} ↓{formatTokens(outputTokens)} · {durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`}
    </span>
  );
}

/** One transcript row. Memoized on props: during a stream the parent state
 *  changes per token, and every settled row must bail out here instead of
 *  re-parsing its markdown. */
export const TranscriptRow = React.memo(function TranscriptRow({
  msg,
  onResolve,
}: {
  msg: ChatMsg;
  onResolve: (id: string, ok: boolean) => void;
}) {
  const { t } = useI18n();

  if (msg.role === "user") {
    return (
      <div className="group flex justify-end">
        <div className="flex max-w-[85%] items-end gap-1">
          <CopyButton text={msg.text} />
          <div className="whitespace-pre-wrap rounded-xl rounded-ee-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{msg.text}</div>
        </div>
      </div>
    );
  }

  if (msg.role === "system-note") {
    return (
      <div className="whitespace-pre-wrap rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{msg.text}</div>
    );
  }

  if (msg.role === "tool" && msg.tool) {
    const toolItem = msg.tool;
    const pending = toolItem.needsApproval && toolItem.approved === null;
    return (
      <div className={cn("rounded-xl border px-3 py-2", toolItem.isError ? "border-destructive/40" : pending ? "border-warning/50" : "border-border")}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-[var(--font-code)] text-[11px]">{toolItem.toolName}</Badge>
          {toolItem.needsApproval && <Badge variant="outline" className="border-warning/50 text-warning text-[11px]">{t("admin.assistant.destructive")}</Badge>}
          {toolItem.approved === false && <Badge variant="outline" className="text-[11px]">{t("admin.assistant.rejected")}</Badge>}
          {toolItem.result == null && !pending && (
            <span className="text-[11px] text-muted-foreground">{t("admin.assistant.toolRunning")}</span>
          )}
        </div>
        <details className="mt-1.5 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("admin.assistant.viewArgs")}</summary>
          <pre dir="ltr" className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted/50 p-2 font-[var(--font-code)] text-[11px]">{truncate(JSON.stringify(toolItem.args, null, 2), 4000)}</pre>
        </details>
        {toolItem.result != null && (
          <div className="group relative">
            <pre dir="ltr" className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2 font-[var(--font-code)] text-[11px]">{truncate(toolItem.result, 6000)}</pre>
            <div className="absolute end-1.5 top-1.5">
              <CopyButton text={toolItem.result} />
            </div>
          </div>
        )}
        {toolItem.contentIds && toolItem.contentIds.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {toolItem.contentIds.map((cid) => (
              <Link
                key={cid}
                href={`/admin/content?id=${cid}`}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-primary hover:bg-muted"
              >
                <ExternalLink className="size-3" />
                {t("admin.assistant.openInEditor")}
              </Link>
            ))}
          </div>
        )}
        {pending && (
          <div className="mt-2">
            <p className="mb-1.5 text-xs text-warning">{t("admin.assistant.destructiveWarn")}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onResolve(msg.id, true)} className="h-8 text-xs">
                <Check className="size-3.5 me-1" />{t("admin.assistant.approve")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onResolve(msg.id, false)} className="h-8 text-xs">
                <X className="size-3.5 me-1" />{t("admin.assistant.reject")}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Assistant — markdown-rendered (safe: no raw HTML), streaming cursor while
  // deltas are still arriving for this bubble.
  return (
    <div className="group max-w-[95%]">
      <div className="rounded-xl rounded-es-sm border border-border bg-card px-3 py-2 text-sm">
        {msg.text
          ? <AiMarkdown text={msg.text} writing={msg.streaming} />
          : msg.streaming
            ? <span className="text-muted-foreground">{t("admin.assistant.thinking")}</span>
            : null}
      </div>
      {msg.usage && <UsageBadge {...msg.usage} />}
      {msg.text && !msg.streaming && <div className="-mt-1 flex justify-start"><CopyButton text={msg.text} /></div>}
    </div>
  );
});
