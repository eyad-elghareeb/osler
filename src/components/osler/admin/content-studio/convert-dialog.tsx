"use client";

/**
 * Convert Dialog — content-type conversion modal.
 *
 * Opens when the user picks "Convert" from the context menu or detail panel.
 * Shows:
 *   - The source content type (read-only)
 *   - A grid of target types (only the ones the source can convert to)
 *   - A live preview of the converted body (collapsed by default)
 *   - A "Convert & open" button that creates a new managed object with the
 *     converted body and routes to the editor.
 *
 * The original content is never modified — conversions always produce a new
 * managed object so admins can compare side-by-side.
 */

import * as React from "react";
import { Loader2, Repeat2, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import {
  adminApi,
  type ContentType,
} from "@/components/osler/admin/admin-api";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { r2KeyToWorkerUrl } from "@/components/osler/admin/editors/image-upload";
import {
  convertOptionsFrom,
  convertContent,
  type ConvertOption,
} from "./converters";

interface ConvertDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The node to convert. Null when closed. */
  node: ContentTreeNode | null;
  /** Called after a successful conversion — typically navigates to the
   *  newly-created object's editor. */
  onConverted?: (newId: string) => void;
}

export function ConvertDialog({ open, onOpenChange, node, onConverted }: ConvertDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  const [body, setBody] = React.useState<string>("");
  const [bodyLoading, setBodyLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<ConvertOption | null>(null);
  const [converted, setConverted] = React.useState<{ body: string; summary: string; itemCount?: number } | null>(null);
  const [converting, setConverting] = React.useState(false);

  // ── Load the source body when the dialog opens ────────────────────────
  React.useEffect(() => {
    if (!open || !node) return;
    setBody("");
    setSelected(null);
    setConverted(null);
    setBodyLoading(true);

    (async () => {
      try {
        // Managed leaf → fetch body via adminApi.getContent
        if (node.managed && node.cloudObject) {
          const obj = await adminApi.getContent(node.cloudObject.id);
          setBody(obj.body ?? "");
          return;
        }
        // Loose / staged R2 leaf → fetch via adminApi.getR2Content or the
        // public worker URL.
        if (node.r2Key) {
          if (node.r2Key.startsWith("content-staging/")) {
            const res = await adminApi.getR2Content(node.r2Key);
            setBody(res.body);
            return;
          }
          // Public key — fetch from the worker directly
          const url = r2KeyToWorkerUrl(node.r2Key);
          if (!url) throw new Error("Cloud not configured");
          const r = await fetch(url);
          if (!r.ok) throw new Error(`${r.status}`);
          setBody(await r.text());
        }
      } catch (err) {
        toast({
          title: t("admin.studio.convertFailed", { error: String(err) }),
          variant: "destructive",
        });
        onOpenChange(false);
      } finally {
        setBodyLoading(false);
      }
    })();
  }, [open, node, toast, t, onOpenChange]);

  // ── Infer source content type ─────────────────────────────────────────
  const sourceType: ContentType | null = React.useMemo(() => {
    if (!node) return null;
    if (node.cloudObject?.content_type) return node.cloudObject.content_type;
    // Infer from extension / category
    if (node.ext === "md") return "library";
    if (node.r2Key?.includes("/qbank/")) return "quiz";
    if (node.r2Key?.includes("/flashcard/")) return "flashcard";
    if (node.r2Key?.includes("/osce/")) return "osce";
    if (node.r2Key?.includes("/videos/")) return "video";
    return "library";
  }, [node]);

  // ── Compute available conversion options ──────────────────────────────
  const options = React.useMemo(() => {
    if (!sourceType) return [];
    return convertOptionsFrom(sourceType);
  }, [sourceType]);

  // ── Run the conversion preview when an option is selected ─────────────
  React.useEffect(() => {
    if (!selected || !sourceType || bodyLoading) {
      setConverted(null);
      return;
    }
    try {
      const result = convertContent(sourceType, selected.target, body);
      setConverted({ body: result.body, summary: result.summary, itemCount: result.itemCount });
    } catch (err) {
      setConverted(null);
      toast({
        title: t("admin.studio.convertFailed", { error: String(err) }),
        variant: "destructive",
      });
    }
  }, [selected, sourceType, body, bodyLoading, toast, t]);

  // ── Confirm: create a new managed object with the converted body ─────
  async function handleConfirm() {
    if (!selected || !sourceType || !converted || !node) return;
    setConverting(true);
    try {
      const title = (node.cloudObject?.title ?? node.name).replace(/\.[^.]+$/, "") + ` (${selected.target})`;
      const language = node.cloudObject?.language ?? "en";
      const createRes = await adminApi.createContent({
        contentType: selected.target,
        title,
        language,
        content: converted.body,
      });
      toast({
        title: t("admin.studio.convertSuccess", { from: sourceType, to: selected.target }),
        description: converted.summary,
      });
      onOpenChange(false);
      if (onConverted) onConverted(createRes.id);
      else router.push(`/admin/content?id=${encodeURIComponent(createRes.id)}`);
    } catch (err: any) {
      toast({
        title: t("admin.studio.convertFailed", { error: String(err?.message ?? err) }),
        variant: "destructive",
      });
    } finally {
      setConverting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat2 className="size-4" />
            {t("admin.studio.convertTitle")}
          </DialogTitle>
          <DialogDescription>{t("admin.studio.convertDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Source → Target row */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.studio.convertFrom")}:
            </span>
            <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs">
              {sourceType ?? "?"}
            </span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.studio.convertTo")}:
            </span>
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
              {selected?.target ?? "?"}
            </span>
          </div>

          {/* Target options grid */}
          {bodyLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : options.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              No conversions available for this content type.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {options.map((opt) => (
                <button
                  key={opt.target}
                  type="button"
                  onClick={() => setSelected(opt)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-start transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    selected?.target === opt.target
                      ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
                      : "border-border bg-card hover:bg-muted/40",
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {opt.lossless ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="size-2.5" /> {t("admin.studio.convertLossless")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="size-2.5" /> {t("admin.studio.convertLossy")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </button>
              ))}
            </div>
          )}

          {/* Conversion summary + preview */}
          {converted && (
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium text-foreground">{converted.summary}</p>
                {converted.itemCount != null && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {converted.itemCount} item(s) produced
                  </p>
                )}
              </div>
              <details>
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                  {t("admin.studio.convertPreview")}
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto medos-scroll-y rounded-md border border-border bg-card p-2 text-[11px] font-mono whitespace-pre-wrap break-words">
                  {converted.body.slice(0, 4000)}
                  {converted.body.length > 4000 && `\n\n… (${converted.body.length - 4000} more chars)`}
                </pre>
              </details>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={converting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!selected || converting || !converted}>
            {converting ? (
              <Loader2 className="me-1.5 size-3.5 animate-spin" />
            ) : (
              <Repeat2 className="me-1.5 size-3.5" />
            )}
            {t("admin.studio.convertConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
