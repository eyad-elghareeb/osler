"use client";

import * as React from "react";
import { CheckCircle2, Plus, Trash2, Tags } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StructuredEditorProps, Field, CollapseContext, questionSnippet, useCollapseState, ListToolbar, arrayMove, ItemRow, TagListField, ImageListField, MilkdownEditor } from "./shared";
import { PassagesEditor } from "./bank-editor";

/**
 * Structured content editors — full React port of
 * tauri-admin/frontend/views/content-editor.js.
 *
 * Each editor matches the full content schema (per-choice images, cloze
 * flashcards, OSCE patient/hiddenProfile/rubric, video YouTube-URL extraction
 * + chapters, written prompt children). Image references use the same
 * `images/<name>` convention as the student app — uploads land in the
 * content_object's R2 folder via the adminApi.uploadFile helper.
 */

export function QuizEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const dndScope = React.useId();
  const questions: any[] = Array.isArray(value?.questions) ? value.questions : [];
  // Hooks must run before the passages early-return below — the value shape
  // can change between renders, and a conditional hook crashes React.
  const collapseState = useCollapseState(questions.length);

  if (Array.isArray(value?.passages)) {
    return <PassagesEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }

  function update(next: any[]) {
    onChange({ ...value, questions: next });
  }
  function addQuestion() {
    update([
      ...questions,
      {
        id: `q-${String(Date.now()).slice(-6)}`,
        question: "",
        options: ["", "", "", ""],
        correct: 0,
        explanation: "",
        tags: [],
        difficulty: 2,
      },
    ]);
  }
  function moveQuestion(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }
  function removeQuestion(i: number) {
    update(questions.filter((_, idx) => idx !== i));
  }
  function patchQuestion(i: number, patch: any) {
    update(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  return (
    <CollapseContext.Provider value={collapseState}>
      <div className="space-y-3">
        <ListToolbar onAdd={addQuestion} addLabel={t("admin.content.editor.addQuestion")} readOnly={readOnly} showCollapseControls />
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t("admin.structured.noQuestions")}</p>
        ) : (
          questions.map((q, i) => (
            <ItemRow
              key={i}
              index={i}
              total={questions.length}
              onMove={(d) => moveQuestion(i, d)}
              onRemove={() => removeQuestion(i)}
              readOnly={readOnly}
              dragScope={dndScope}
              onDragReorder={(from, to) => update(arrayMove(questions, from, to))}
              title={`${t("admin.content.editor.question", { n: i + 1 })}${questionSnippet(q)}`}
              collapsible
            >
            <Field label="ID">
              <Input
                value={q.id ?? ""}
                onChange={(e) => patchQuestion(i, { id: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
                placeholder="q-001"
              />
            </Field>
            <Field label={t("admin.content.editor.stem")} hint="Markdown supported">
              <MilkdownEditor
  value={q.question ?? q.stem ?? ""}
  onChange={(v) => patchQuestion(i, { question: v, stem: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
  placeholder="Question text — supports **bold**, *italic*, `code`, and ![alt](image.png)"
/>
            </Field>
            <ChoicesEditor
              choices={q.options ?? q.choices ?? []}
              correct={q.correct}
              onChange={(options, correct) => patchQuestion(i, { options, correct })}
              readOnly={readOnly}
            />
            <Field label={t("admin.content.editor.explanation")} hint="Markdown supported">
              <MilkdownEditor
  value={q.explanation ?? ""}
  onChange={(v) => patchQuestion(i, { explanation: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
            </Field>
            <ImageListField
              label="Stem image(s)"
              images={q.images}
              onChange={(v) => patchQuestion(i, { images: v })}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
              hint="Reference as ecg.png or images/ecg.png"
            />
            <ChoiceImagesEditor
              choices={q.options ?? q.choices ?? []}
              choiceImages={q.choiceImages}
              onChange={(v) => patchQuestion(i, { choiceImages: v })}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
            <ImageListField
              label="Explanation image(s)"
              images={q.explanationImages}
              onChange={(v) => patchQuestion(i, { explanationImages: v })}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
            <TagListField
              label="Tags"
              tags={q.tags ?? []}
              onChange={(v) => patchQuestion(i, { tags: v })}
              readOnly={readOnly}
            />
            <Field label="Difficulty (1-5)">
              <Input
                type="number"
                min={1}
                max={5}
                value={q.difficulty ?? 2}
                onChange={(e) => patchQuestion(i, { difficulty: Number(e.target.value) })}
                readOnly={readOnly}
                className="w-24"
              />
            </Field>
          </ItemRow>
        ))
      )}
      </div>
    </CollapseContext.Provider>
  );
}

export function ChoicesEditor({
  choices,
  correct,
  onChange,
  readOnly,
}: {
  choices: any[];
  correct: number;
  onChange: (choices: any[], correct: number) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  // Normalize: each choice may be either a string or { text, correct }.
  const strings: string[] = choices.map((c) => (typeof c === "string" ? c : c?.text ?? ""));

  function addChoice() {
    onChange([...strings, ""], correct);
  }
  function patchChoice(i: number, v: string) {
    onChange(strings.map((s, idx) => (idx === i ? v : s)), correct);
  }
  function removeChoice(i: number) {
    const next = strings.filter((_, idx) => idx !== i);
    let nextCorrect = correct;
    if (correct === i) nextCorrect = 0;
    else if (correct > i) nextCorrect -= 1;
    onChange(next, nextCorrect);
  }
  function setCorrect(i: number) {
    onChange(strings, i);
  }

  return (
    <Field label={t("admin.content.editor.choices")}>
      <div className="space-y-1.5">
        {strings.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !readOnly && setCorrect(i)}
              disabled={readOnly}
              className={cn(
                "size-5 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                correct === i
                  ? "bg-success border-success text-success-foreground"
                  : "border-border text-transparent hover:border-success/50",
              )}
              aria-label={correct === i ? t("admin.structured.correctAnswer") : t("admin.structured.markAsCorrect")}
            >
              {correct === i && <CheckCircle2 className="size-3" />}
            </button>
            <Input
              value={c}
              onChange={(e) => patchChoice(i, e.target.value)}
              readOnly={readOnly}
              className="flex-1"
              placeholder={`Option ${i + 1}`}
            />
            {!readOnly && (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => removeChoice(i)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={addChoice} className="text-xs">
            <Plus className="size-3 me-1" />
            Add choice
          </Button>
        )}
      </div>
    </Field>
  );
}

export function ChoiceImagesEditor({
  choices,
  choiceImages,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
}: {
  choices: any[];
  choiceImages: any[] | undefined;
  onChange: (next: any[]) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
}) {
  // Always pad to choices.length
  const arr = React.useMemo(() => {
    const base = Array.isArray(choiceImages) ? [...choiceImages] : [];
    while (base.length < choices.length) base.push(undefined);
    return base.slice(0, choices.length);
  }, [choiceImages, choices.length]);

  return (
    <Field label="Per-choice image(s)">
      <div className="space-y-2">
        {arr.map((im, i) => (
          <div key={i} className="border-s-2 border-border ps-2">
            <div className="text-xs font-medium mb-1 text-muted-foreground">Choice {i + 1}</div>
            <ImageListField
              label=""
              images={im}
              onChange={(v) => {
                const next = [...arr];
                next[i] = v;
                onChange(next);
              }}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
          </div>
        ))}
      </div>
    </Field>
  );
}

// ── Passages editor (quiz mode + bank mode) ────────────────────────────────