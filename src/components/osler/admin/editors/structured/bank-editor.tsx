"use client";

import * as React from "react";
import { Tags } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Input } from "@/components/ui/input";
import { StructuredEditorProps, Field, SectionLabel, CollapseContext, questionSnippet, useCollapseState, ListToolbar, arrayMove, ItemRow, TagListField, ImageListField, MilkdownEditor } from "./shared";
import { QuizEditor, ChoicesEditor } from "./quiz-editor";

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

export function PassagesEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const dndScope = React.useId();
  const passages: any[] = Array.isArray(value?.passages) ? value.passages : [];
  const collapseState = useCollapseState(passages.length);

  function update(next: any[]) {
    onChange({ ...value, passages: next });
  }
  function addPassage() {
    update([
      ...passages,
      { id: `p-${String(Date.now()).slice(-6)}`, content: "", questions: [] },
    ]);
  }
  function patchPassage(i: number, patch: any) {
    update(passages.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removePassage(i: number) {
    update(passages.filter((_, idx) => idx !== i));
  }
  function movePassage(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= passages.length) return;
    const next = [...passages];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }

  return (
    <CollapseContext.Provider value={collapseState}>
      <div className="space-y-3">
        <ListToolbar onAdd={addPassage} addLabel="Add passage" readOnly={readOnly} showCollapseControls />
        {passages.map((p, i) => (
          <ItemRow
            key={i}
            index={i}
            total={passages.length}
            onMove={(d) => movePassage(i, d)}
            onRemove={() => removePassage(i)}
            readOnly={readOnly}
            dragScope={dndScope}
            onDragReorder={(from, to) => update(arrayMove(passages, from, to))}
            title={`Passage ${i + 1}`}
            collapsible
          >
          <Field label="ID">
            <Input
              value={p.id ?? ""}
              onChange={(e) => patchPassage(i, { id: e.target.value })}
              readOnly={readOnly}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Passage text" hint="Markdown supported">
            <MilkdownEditor
  value={p.content ?? p.stem ?? ""}
  onChange={(v) => patchPassage(i, { content: v, stem: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
          </Field>
          <Field label="Questions">
            <QuizEditor
              value={{ questions: p.questions ?? [] }}
              onChange={(v) => patchPassage(i, { questions: v.questions })}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
          </Field>
        </ItemRow>
      ))}
      </div>
    </CollapseContext.Provider>
  );
}

// ── Flashcard editor (basic + cloze + subdecks) ────────────────────────────

export function BankEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const hasPassages = Array.isArray(value?.passages) && value.passages.length > 0;
  const hasFlatQuestions = Array.isArray(value?.questions) && value.questions.length > 0;

  // If only passages (classic mode), delegate to PassagesEditor
  if (hasPassages && !hasFlatQuestions) {
    return <PassagesEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }

  // If only flat questions, render them directly with the bank question shape
  if (!hasPassages && hasFlatQuestions) {
    return <BankFlatQuestionsEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }

  // Both passages and flat questions — render in sections
  return (
    <div className="space-y-4">
      {hasPassages && (
        <div>
          <SectionLabel>Passages</SectionLabel>
          <PassagesEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />
        </div>
      )}
      {hasFlatQuestions && (
        <div>
          <SectionLabel>Standalone Questions</SectionLabel>
          <BankFlatQuestionsEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />
        </div>
      )}
    </div>
  );
}

// ── Flat questions editor for bank files without passages ─────────────────
export function BankFlatQuestionsEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const dndScope = React.useId();
  const questions: any[] = Array.isArray(value?.questions) ? value.questions : [];
  const collapseState = useCollapseState(questions.length);

  function update(next: any[]) {
    onChange({ ...value, questions: next });
  }
  function addQuestion() {
    update([
      ...questions,
      {
        id: `bq-${String(Date.now()).slice(-6)}`,
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
              title={`Question ${i + 1}${questionSnippet(q)}`}
              collapsible
            >
              <Field label="ID">
                <Input
                  value={q.id ?? ""}
                  onChange={(e) => patchQuestion(i, { id: e.target.value })}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                  placeholder="bq-001"
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

// ── Editor Navigator — compact question grid for quick jumping ────────────
// Similar to the QuestionNavigatorSheet in qbank mobile quiz UI.
// Shows a small floating panel with a grid of numbered cells that
// scroll the corresponding ItemRow into view.