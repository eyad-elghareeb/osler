"use client";

import * as React from "react";
import { useI18n } from "@/components/osler/i18n-provider";
import { StructuredEditorProps, SectionLabel, ChaptersEditor } from "./shared";
import { QuizEditor } from "./quiz-editor";
import { PassagesEditor } from "./bank-editor";
import { WrittenEditor } from "./written-editor";

/**
 * Mixed pack editor (MCQ + written + chapters).
 *
 * A `mixed` pack holds MCQ content (`questions` and/or `passages`) alongside
 * written `prompts`, plus an optional top-level `chapters` array. Each
 * section reuses the corresponding standalone editor with `hideChapters` —
 * one shared ChaptersEditor sits above them. Every sub-editor spreads the
 * value it receives, so each onChange is merged back key-by-key and no
 * section can clobber the others.
 */
export function MixedEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const passthrough = { readOnly, r2KeyBase, rawR2Key, hideChapters: true as const };

  return (
    <div className="space-y-4">
      <ChaptersEditor value={value} onChange={onChange} readOnly={readOnly} />
      <div>
        <SectionLabel>{t("admin.structured.mixedQuestions")}</SectionLabel>
        <QuizEditor
          value={{ ...value, passages: undefined, questions: Array.isArray(value?.questions) ? value.questions : [] }}
          onChange={(v) => onChange({ ...value, questions: v.questions })}
          {...passthrough}
        />
      </div>
      <div>
        <SectionLabel>{t("admin.structured.mixedPassages")}</SectionLabel>
        <PassagesEditor
          value={{ ...value, passages: Array.isArray(value?.passages) ? value.passages : [] }}
          onChange={(v) => onChange({ ...value, passages: v.passages })}
          {...passthrough}
        />
      </div>
      <div>
        <SectionLabel>{t("admin.structured.mixedPrompts")}</SectionLabel>
        <WrittenEditor
          value={{ ...value, prompts: Array.isArray(value?.prompts) ? value.prompts : [] }}
          onChange={(v) => onChange({ ...value, prompts: v.prompts })}
          {...passthrough}
        />
      </div>
    </div>
  );
}
