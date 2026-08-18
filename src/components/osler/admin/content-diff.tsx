"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { LoadingState } from "@/components/osler/ui-primitives";
import { adminApi, type ContentObject } from "@/components/osler/admin/admin-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function tryFormat(raw: string | null): string {
  if (!raw) return "";
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

/** Very simple line-diff: returns array of { line, type: 'same'|'added'|'removed' } */
function lineDiff(left: string, right: string) {
  const lLines = left.split("\n");
  const rLines = right.split("\n");
  const maxLen = Math.max(lLines.length, rLines.length);
  const result: { left: string; right: string; changed: boolean }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const l = lLines[i] ?? "";
    const r = rLines[i] ?? "";
    result.push({ left: l, right: r, changed: l !== r });
  }
  return result;
}

interface ContentDiffProps {
  id: string;
}

export function ContentDiff({ id }: ContentDiffProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [obj, setObj] = useState<ContentObject | null>(null);
  const [diff, setDiff] = useState<{ pending: string | null; published: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([adminApi.getContent(id), adminApi.getDiff(id)])
      .then(([content, d]) => { setObj(content); setDiff(d); })
      .catch(() => toast({ title: t("admin.toast.failedLoadDiff"), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [id]);

  async function approve() {
    haptic("success");
    setBusy(true);
    try {
      await adminApi.approveContent(id);
      toast({ title: t("admin.review.approve") });
      router.push("/admin/review");
    } catch {
      toast({ title: t("admin.toast.approveFailed"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    haptic("warning");
    setBusy(true);
    try {
      await adminApi.rejectContent(id, reason);
      toast({ title: t("admin.review.reject") });
      router.push("/admin/review");
    } catch {
      toast({ title: t("admin.toast.rejectFailed"), variant: "destructive" });
    } finally {
      setBusy(false);
      setRejectOpen(false);
    }
  }

  if (loading) return <LoadingState label={t("common.loading")} />;
  if (!obj || !diff) return null;

  const pendingFormatted   = tryFormat(diff.pending);
  const publishedFormatted = tryFormat(diff.published);
  const rows = lineDiff(publishedFormatted, pendingFormatted);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3 sm:px-4 backdrop-blur-md safe-pt">
        <Button variant="ghost" size="iconSm" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm truncate block">{obj.title ?? t("admin.content.untitled")}</span>
          {obj.creator_username && (
            <span className="text-xs text-muted-foreground">
              {t("admin.review.submittedBy", { name: `@${obj.creator_username}` })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
            onClick={approve}
            disabled={busy}
          >
            <CheckCircle2 className="me-1.5 size-3.5" />
            <span className="hidden sm:inline">{t("admin.review.approve")}</span>
            <span className="sm:hidden"><CheckCircle2 className="size-3.5" /></span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setRejectOpen(true)}
            disabled={busy}
          >
            <XCircle className="me-1.5 size-3.5" />
            <span className="hidden sm:inline">{t("admin.review.reject")}</span>
            <span className="sm:hidden"><XCircle className="size-3.5" /></span>
          </Button>
        </div>
      </div>

      {/* Diff pane */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Left — published */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-[200px] md:min-h-0">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border">
            {diff.published ? t("admin.review.diff.published") : t("admin.review.diff.nopublished")}
          </div>
          <div className="flex-1 overflow-auto osler-scroll-y">
            <DiffColumn lines={rows.map((r) => ({ line: r.left, changed: r.changed }))} side="left" />
          </div>
        </div>

        {/* Right — pending */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-[200px] md:min-h-0">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border">
            {t("admin.review.diff.pending")}
          </div>
          <div className="flex-1 overflow-auto osler-scroll-y">
            <DiffColumn lines={rows.map((r) => ({ line: r.right, changed: r.changed }))} side="right" />
          </div>
        </div>
      </div>

      {/* Reject dialog */}
      <AlertDialog open={rejectOpen} onOpenChange={(o) => { if (!o) setRejectOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.review.confirmReject")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.review.reason")}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            id="reject-reason"
            placeholder={t("admin.review.reasonPlaceholder")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-2 min-h-[80px]"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={reject}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t("admin.review.confirmReject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DiffColumn({ lines, side }: { lines: { line: string; changed: boolean }[]; side: "left" | "right" }) {
  return (
    <pre className="text-[12px] font-mono leading-5 p-4 h-full">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "px-1",
            l.changed && side === "left"  && "bg-destructive/15 text-destructive",
            l.changed && side === "right" && "bg-success/15 text-success",
          )}
        >
          {l.line || " "}
        </div>
      ))}
    </pre>
  );
}
