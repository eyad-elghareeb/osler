"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, ChevronDown, Flag, Timer, X } from "lucide-react";
import type { EngineType } from "@/lib/osler/types";
import type { StringKey } from "@/lib/osler/i18n";
import { ENGINE_META } from "@/lib/osler/content";
import { renderRichText } from "@/lib/osler/richtext";
import type { PoolQuestion } from "@/lib/osler/qbank-pool";
import type { QuestionRecord } from "@/lib/osler/storage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useI18n } from "./i18n-provider";
import { EmptyState, PackSheetHeader, PackSheetFooter, SwipeableSideSheet } from "./ui-primitives";
import { disclosureVariants } from "@/lib/osler/motion";
import { cn } from "@/lib/utils";

export interface TrackerPreviewItem {
  key: string;
  record: QuestionRecord;
  question: PoolQuestion | null;
}

export interface TrackerPreviewPack {
  uid: string;
  title: string;
  type: EngineType;
  lang?: string;
}

interface TrackerPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack: TrackerPreviewPack | null;
  items: TrackerPreviewItem[];
  selectedKeys: Set<string>;
  onToggleRecord: (key: string) => void;
  onToggleAll: () => void;
  onStartReview: () => void;
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ARABIC_LETTERS = ["أ", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط", "ي"];
const choiceLetter = (idx: number, lang?: string): string =>
  (lang && lang.startsWith("ar") ? ARABIC_LETTERS : LETTERS)[idx] ?? "?";

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function previewHtml(text: string, q: PoolQuestion): string {
  return renderRichText(text, q.sourceCategory ?? "qbank", q.sourcePath ?? "");
}

function StatusBadges({ record, t }: { record: QuestionRecord; t: (key: StringKey) => string }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {record.dismissed && (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {t("qbank.tracker.dismissed")}
        </Badge>
      )}
      {!record.correct && (
        <Badge variant="outline" className="text-xs border-destructive/30 text-destructive">
          <X className="size-2.5 me-1" />
          {t("qbank.tracker.wrongLabel")}
        </Badge>
      )}
      {record.flagged && (
        <Badge variant="outline" className="text-xs border-warning/30 text-warning">
          <Flag className="size-2.5 me-1" />
          {t("qbank.tracker.flaggedLabel")}
        </Badge>
      )}
      {record.correct && (
        <Badge variant="outline" className="text-xs border-success/30 text-success">
          <CheckCircle2 className="size-2.5 me-1" />
          {t("qbank.tracker.correctLabel")}
        </Badge>
      )}
    </div>
  );
}

/** Inline disclosure for the explanation / model answer under each preview
 *  card. Uses the shared `disclosureVariants` from motion.ts so the height
 *  + opacity transition matches every other expandable surface in the app. */
function Disclosure({ title, html }: { title: string; html: string }) {
  const reduced = useReducedMotion() ?? false;
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none rounded-md"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {title}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={disclosureVariants}
            transition={reduced ? { duration: 0 } : undefined}
            className="overflow-hidden"
          >
            <div className="osler-prose mt-2 text-sm" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PreviewCard({ item, pack, selected, onToggle, t }: {
  item: TrackerPreviewItem;
  pack: TrackerPreviewPack;
  selected: boolean;
  onToggle: () => void;
  t: (key: StringKey) => string;
}) {
  const { record, question: q } = item;
  return (
    <div className="osler-card--default">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          className="mt-0.5 size-4 shrink-0"
          aria-label={t("qbank.preview.selectQuestion")}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <StatusBadges record={record} t={t} />
            <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
              <span>{new Date(record.timestamp).toLocaleDateString()}</span>
              {(record.timeMs ?? 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Timer className="size-3" />
                  {formatMs(record.timeMs ?? 0)}
                </span>
              )}
            </span>
          </div>
          {q ? (
            <>
              <div
                className="osler-prose text-sm"
                dir="auto"
                dangerouslySetInnerHTML={{ __html: previewHtml(q.stem, q) }}
              />
              {q.choices.length > 0 && (
                <div className="space-y-1">
                  {q.choices.map((choice, i) => {
                    const isCorrect = i === q.correct;
                    const isSelected = i === record.selected;
                    return (
                      <div
                        key={i}
                        dir="auto"
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-sm",
                          isCorrect
                            ? "bg-success/10 font-medium text-success"
                            : isSelected
                              ? "bg-destructive/10 text-destructive line-through"
                              : "bg-muted/40 text-muted-foreground",
                        )}
                      >
                        <span className="me-2 font-medium">{choiceLetter(i, pack.lang)}</span>
                        {choice}
                      </div>
                    );
                  })}
                </div>
              )}
              {q.explanation && (
                <Disclosure title={t("qbank.preview.explanation")} html={previewHtml(q.explanation, q)} />
              )}
              {!q.explanation && q.modelAnswer && (
                <Disclosure title={t("qbank.preview.modelAnswer")} html={previewHtml(q.modelAnswer, q)} />
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t("qbank.preview.noContent")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TrackerPreviewSheet({
  open,
  onOpenChange,
  pack,
  items,
  selectedKeys,
  onToggleRecord,
  onToggleAll,
  onStartReview,
}: TrackerPreviewSheetProps) {
  const { t, rtl } = useI18n();
  // Keep the last non-null pack + items around so the sheet stays populated
  // while its exit animation plays (parent clears previewUid on close).
  const snapshot = React.useRef<{ pack: TrackerPreviewPack; items: TrackerPreviewItem[] } | null>(null);
  if (pack && items.length > 0) snapshot.current = { pack, items };
  const shown = snapshot.current;
  if (!shown) return null;
  const shownPack = shown.pack;
  const shownItems = shown.items;
  const meta = ENGINE_META[shownPack.type] ?? ENGINE_META.quiz;
  const selectedCount = items.reduce((n, it) => n + (selectedKeys.has(it.key) ? 1 : 0), 0);
  const allSelected = items.length > 0 && selectedCount === items.length;
  const wrongCount = shownItems.reduce((n, it) => n + (it.record.correct ? 0 : 1), 0);
  const flaggedCount = shownItems.reduce((n, it) => n + (it.record.flagged ? 1 : 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        dir={rtl ? "rtl" : "ltr"}
        className="w-full gap-0 bg-background p-0 sm:max-w-xl"
      >
        <SwipeableSideSheet onClose={() => onOpenChange(false)} rtl={rtl} className="gap-0">
          <PackSheetHeader
            title={shownPack.title}
            meta={
              <>
                <span>{meta.label}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{t("qbank.preview.questions", { n: shownItems.length })}</span>
              </>
            }
            badges={
              <>
                {wrongCount > 0 && (
                  <Badge variant="outline" className="shrink-0 text-xs border-destructive/30 text-destructive">
                    <X className="size-2.5 me-1" />
                    {wrongCount}
                  </Badge>
                )}
                {flaggedCount > 0 && (
                  <Badge variant="outline" className="shrink-0 text-xs border-warning/30 text-warning">
                    <Flag className="size-2.5 me-1" />
                    {flaggedCount}
                  </Badge>
                )}
              </>
            }
          />

          <ScrollArea className="min-h-0 flex-1" dir={rtl ? "rtl" : "ltr"}>
            <div className="space-y-3 pt-6 pb-4 px-4">
              {shownItems.length === 0 ? (
                <EmptyState icon={CheckCircle2} title={t("qbank.preview.noContent")} />
              ) : (
                shownItems.map((it) => (
                  <PreviewCard
                    key={it.key}
                    item={it}
                    pack={shownPack}
                    selected={selectedKeys.has(it.key)}
                    onToggle={() => onToggleRecord(it.key)}
                    t={t}
                  />
                ))
              )}
            </div>
          </ScrollArea>

          <PackSheetFooter>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleAll}
                  className="size-4"
                />
                {t("qbank.preview.selectAll")}
              </label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("qbank.tracker.selected", { n: selectedCount })}
              </span>
              <Button size="sm" className="ms-auto" disabled={selectedCount === 0} onClick={onStartReview}>
                {t("qbank.tracker.startReview")}
              </Button>
            </div>
          </PackSheetFooter>
        </SwipeableSideSheet>
      </SheetContent>
    </Sheet>
  );
}
