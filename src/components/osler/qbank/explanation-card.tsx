"use client";

import * as React from "react";
import { motion, animate } from "framer-motion";
import { Check, X, Sparkles } from "lucide-react";
import type { ContentTreeNode } from "@/lib/osler/types";
import { type HighlightItem } from "@/lib/osler/storage";
import { Badge } from "@/components/ui/badge";
import { HighlightedContent } from "@/components/osler/highlighted-content";
import { useI18n } from "@/components/osler/i18n-provider";
import { dirForContent } from "@/lib/osler/i18n";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { choiceLetter, questionAssetBase, renderQuestionText, imageListOf, ContentImageFigure, SessionQuestion, Lightbulb } from "./shared";




































































export function ExplanationCard({
  q,
  selected,
  nonMcq,
  highlights: questionHighlights,
  packUid,
  questionIdx,
  lang,
  item,
  onRemoveHighlight,
}: {
  q: SessionQuestion;
  selected: number | undefined;
  nonMcq?: boolean;
  highlights?: HighlightItem[];
  packUid?: string;
  questionIdx?: number;
  lang?: string;
  item?: ContentTreeNode;
  onRemoveHighlight?: (id: string) => void;
}) {
  const hl = questionHighlights ?? [];

  const { t } = useI18n();
  const base = item ? questionAssetBase(q, item) : { category: "qbank", path: "" };
  if (nonMcq) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION_TRANSITION.normal}
        className="rounded-xl border-2 border-success overflow-hidden"
      >
        <div className="px-4 py-3 flex items-center gap-3 bg-success-soft text-success">
          <div className="size-9 rounded-full flex items-center justify-center shrink-0 bg-success text-success-foreground">
            <Sparkles className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold">{t("qbank.explanation.answerRevealed")}</div>
            <div className="text-xs mt-0.5">
              {t("qbank.explanation.reviewPrompt")}
            </div>
          </div>
        </div>
        <div className="bg-card px-5 py-4" data-explanation>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{t("qbank.explanation.title")}</h3>
          </div>
          <div className="osler-prose text-[14px]" style={{ whiteSpace: "pre-wrap" }} dir={dirForContent(lang)} lang={lang ?? undefined}>
            <HighlightedContent
              html={renderQuestionText(q.explanation || t("qbank.explanation.noExplanation"), q, item)}
              highlights={hl}
              target="explanation"
            />
          </div>
          {imageListOf(q.explanationImages).length > 0 && (
            <div className="flex flex-col gap-3 mt-3">
              {imageListOf(q.explanationImages).map((img) => (
                <ContentImageFigure
                  key={img.src}
                  img={img}
                  category={questionAssetBase(q, item).category}
                  path={questionAssetBase(q, item).path}
                  className="rounded-xl border border-border max-h-[320px] w-auto mx-auto"
                />
              ))}
            </div>
          )}
          {q.tags && q.tags.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-1.5">
              {q.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[11px] rounded-md">
                  #{t}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  const isCorrect = selected === q.correct;
  const correctLetter = choiceLetter(q.correct, lang);
  const selectedLetter = selected !== undefined ? choiceLetter(selected, lang) : "—";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION_TRANSITION.normal}
      className={`rounded-xl border-2 overflow-hidden ${isCorrect ? "border-success" : "border-destructive"}`}
    >
      <div className={`px-4 py-3 flex items-center gap-3 ${isCorrect ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive"}`}>
        <div className={`size-9 rounded-full flex items-center justify-center shrink-0 ${isCorrect ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}`}>
          {isCorrect ? <Check className="size-5" /> : <X className="size-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold">{isCorrect ? t("qbank.explanation.correct") : t("qbank.explanation.incorrect")}</div>
          <div className="text-xs mt-0.5">
            {t("qbank.explanation.yourAnswer", { letter: selectedLetter })}
            {!isCorrect && (
              <>
                {"  ·  "}{t("qbank.explanation.correctAnswer", { letter: correctLetter })}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="bg-card px-5 py-4" data-explanation>
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{t("qbank.explanation.title")}</h3>
        </div>
        <div className="osler-prose text-[14px]" style={{ whiteSpace: "pre-wrap" }} dir="auto">
          <HighlightedContent
            html={renderQuestionText(q.explanation || t("qbank.explanation.noExplanation"), q, item)}
            highlights={hl}
            target="explanation"
          />
        </div>
        {imageListOf(q.explanationImages).length > 0 && (
          <div className="flex flex-col gap-3 mt-3">
            {imageListOf(q.explanationImages).map((img) => (
              <ContentImageFigure
                key={img.src}
                img={img}
                category={questionAssetBase(q, item).category}
                path={questionAssetBase(q, item).path}
                className="rounded-xl border border-border max-h-[320px] w-auto mx-auto"
              />
            ))}
          </div>
        )}
        {q.tags && q.tags.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-[11px] rounded-md capitalize">{q.difficulty ?? "standard"}</Badge>
            {q.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[11px] rounded-md">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}