"use client";

import * as React from "react";
import { LifeBuoy, Send, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/osler/i18n-provider";
import { toast } from "@/hooks/use-toast";
import { haptic } from "@/lib/osler/native";
import { readCloudSession } from "@/lib/osler/cloud";
import {
  fileTicket,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_I18N,
  type TicketContext,
  type TicketCategory,
  type TicketSource,
} from "@/lib/osler/support";

/**
 * Shared "report a problem" dialog used by Settings, the QBank question
 * toolbar and the Library article reader. Contextual details (pack, question
 * id, chosen answer / article) are attached automatically and shown to the
 * reporter so they know what admins will receive.
 */
export function ReportTicketDialog({
  open,
  onOpenChange,
  source,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: TicketSource;
  context?: TicketContext;
}) {
  const { t } = useI18n();
  const [category, setCategory] = React.useState<TicketCategory>("bug");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const username = readCloudSession()?.user.displayName ?? null;

  const reset = () => {
    setCategory("bug");
    setSubject("");
    setMessage("");
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim()) {
      haptic("warning");
      toast({ title: t("support.requiredError"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const ticket = await fileTicket({ source, category, subject, message, context });
      haptic(ticket.synced ? "success" : "warning");
      toast({
        title: t("support.successTitle"),
        description: t(ticket.synced ? "support.successDesc" : "support.pendingDesc"),
      });
      reset();
      onOpenChange(false);
    } catch {
      haptic("error");
      toast({ title: t("support.errorTitle"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const contextLines: string[] = [];
  if (username) contextLines.push(t("support.contextUser", { name: username }));
  else contextLines.push(t("support.contextGuest"));
  if (context?.packTitle) contextLines.push(`${t("support.contextPack")}: ${context.packTitle}`);
  if (context?.qid) contextLines.push(`${t("support.contextQuestionId")}: ${context.qid}`);
  if (context?.questionExcerpt) contextLines.push(`${t("support.contextQuestion")}: "${context.questionExcerpt}"`);
  if (context?.selectedAnswer) contextLines.push(`${t("support.contextAnswer")}: ${context.selectedAnswer}`);
  if (context?.articleTitle) contextLines.push(`${t("support.contextArticle")}: ${context.articleTitle}`);
  if (context?.question?.stem) contextLines.push(t("support.attachFullQuestion"));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="size-4 text-primary" />
            {t("support.title")}
          </DialogTitle>
          <DialogDescription>{t("support.desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="ticket-category">{t("support.categoryLabel")}</Label>
            <Select value={category} onValueChange={(v) => { haptic("selection"); setCategory(v as TicketCategory); }}>
              <SelectTrigger id="ticket-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{t(TICKET_CATEGORY_I18N[c])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ticket-subject">{t("support.subjectLabel")}</Label>
            <Input
              id="ticket-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("support.subjectPlaceholder")}
              maxLength={200}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ticket-message">{t("support.messageLabel")}</Label>
            <Textarea
              id="ticket-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("support.messagePlaceholder")}
              rows={4}
              maxLength={5000}
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
              <TriangleAlert className="size-3" />
              {t("support.attachContext")}
            </div>
            <ul className="space-y-0.5">
              {contextLines.map((line) => (
                <li key={line} className="text-xs text-muted-foreground truncate">{line}</li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {!submitting && <Send className="size-4" />}
            {t("support.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
