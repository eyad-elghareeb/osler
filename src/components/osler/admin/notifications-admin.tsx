"use client";

import * as React from "react";
import { Loader2, Megaphone, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, SectionHeading } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/osler/native";
import { adminApi } from "@/components/osler/admin/admin-api";
import { ANNOUNCEMENTS_R2_KEY, type Announcement } from "@/lib/osler/notifications";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function readAnnouncements(): Promise<Announcement[]> {
  try {
    const r = await adminApi.getR2Content(ANNOUNCEMENTS_R2_KEY);
    const doc = JSON.parse(r.body) as { announcements?: unknown };
    if (!Array.isArray(doc.announcements)) return [];
    return (doc.announcements as Announcement[]).filter(
      (a) => a && typeof a.id === "string" && typeof a.title === "string",
    );
  } catch {
    // Missing file (never published) reads as empty, never a failure.
    return [];
  }
}

/**
 * Admin → users broadcast. Announcements are stored as a single public JSON
 * file (`content-files/notifications/announcements.json`) through the
 * existing R2 upload endpoint and served through the existing public content
 * endpoint — students pick them up in the notification center on their next
 * poll, with zero worker changes.
 */
export function NotificationsAdmin() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = React.useState<Announcement[] | null>(null);
  const [title, setTitle] = React.useState("");
  const [titleAr, setTitleAr] = React.useState("");
  const [body, setBody] = React.useState("");
  const [bodyAr, setBodyAr] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setItems(null);
    readAnnouncements()
      .then((list) => setItems([...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))))
      .catch(() => setItems([]));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const persist = async (list: Announcement[]) => {
    await adminApi.uploadFile(ANNOUNCEMENTS_R2_KEY, JSON.stringify({ announcements: list }, null, 2));
  };

  const publish = async () => {
    if (!title.trim() || !body.trim()) {
      haptic("warning");
      toast({ title: t("admin.notif.requiredError"), variant: "destructive" });
      return;
    }
    setPublishing(true);
    try {
      const current = await readAnnouncements();
      const entry: Announcement = {
        id: crypto.randomUUID(),
        title: title.trim(),
        ...(titleAr.trim() ? { titleAr: titleAr.trim() } : {}),
        body: body.trim(),
        ...(bodyAr.trim() ? { bodyAr: bodyAr.trim() } : {}),
        createdAt: Date.now(),
      };
      await persist([entry, ...current]);
      haptic("success");
      toast({ title: t("admin.notif.publishedToast") });
      setTitle("");
      setTitleAr("");
      setBody("");
      setBodyAr("");
      load();
    } catch {
      haptic("error");
      toast({ title: t("admin.notif.publishFailed"), variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      const current = await readAnnouncements();
      await persist(current.filter((a) => a.id !== id));
      haptic("success");
      toast({ title: t("admin.notif.deletedToast") });
      load();
    } catch {
      haptic("error");
      toast({ title: t("admin.notif.deleteFailed"), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-4 grid gap-3">
        <SectionHeading icon={Megaphone}>{t("admin.notif.composeTitle")}</SectionHeading>
        <p className="text-sm text-muted-foreground -mt-2">{t("admin.notif.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor="notif-title">{t("admin.notif.titleLabel")}</Label>
            <Input
              id="notif-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("admin.notif.titlePlaceholder")}
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor="notif-title-ar">{t("admin.notif.titleArLabel")}</Label>
            <Input
              id="notif-title-ar"
              value={titleAr}
              onChange={(e) => setTitleAr(e.target.value)}
              placeholder={t("admin.notif.titlePlaceholder")}
              maxLength={120}
              dir="auto"
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor="notif-body">{t("admin.notif.bodyLabel")}</Label>
            <Textarea
              id="notif-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("admin.notif.bodyPlaceholder")}
              rows={3}
              maxLength={1000}
            />
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            <Label htmlFor="notif-body-ar">{t("admin.notif.bodyArLabel")}</Label>
            <Textarea
              id="notif-body-ar"
              value={bodyAr}
              onChange={(e) => setBodyAr(e.target.value)}
              placeholder={t("admin.notif.bodyPlaceholder")}
              rows={3}
              maxLength={1000}
              dir="auto"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={publish} loading={publishing} disabled={!title.trim() || !body.trim()}>
            {!publishing && <Send className="size-4" />}
            {t("admin.notif.publish")}
          </Button>
        </div>
      </div>

      <SectionHeading>{t("admin.notif.history")}</SectionHeading>

      {items === null ? (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={t("admin.notif.empty")}
          description={t("admin.notif.hint")}
        />
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
            >
              <span className="size-9 rounded-lg bg-primary-soft border border-primary/20 flex items-center justify-center shrink-0">
                <Megaphone className="size-4 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold break-words">
                  {lang === "ar" && a.titleAr ? a.titleAr : a.title}
                  {a.titleAr && a.title && (
                    <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                      {lang === "ar" ? a.title : a.titleAr}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words" dir="auto">
                  {lang === "ar" && a.bodyAr ? a.bodyAr : a.body}
                </p>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatDate(a.createdAt)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="iconSm"
                onClick={() => void remove(a.id)}
                disabled={deletingId === a.id}
                aria-label={t("admin.notif.delete")}
                title={t("admin.notif.delete")}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                {deletingId === a.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
