"use client";

import * as React from "react";
import { Plus, Trash2, Tags } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StructuredEditorProps, Field, SectionLabel, CollapseContext, useCollapseState, ListToolbar, arrayMove, ItemRow, TagListField, MilkdownEditor } from "./shared";

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

export function WrittenEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const dndScope = React.useId();
  const prompts: any[] = Array.isArray(value?.prompts) ? value.prompts : [];
  const collapseState = useCollapseState(prompts.length);

  function update(next: any[]) {
    onChange({ ...value, prompts: next });
  }
  function addPrompt() {
    update([
      ...prompts,
      {
        id: `w-${String(Date.now()).slice(-6)}`,
        prompt: "",
        modelAnswer: "",
        explanation: "",
        rubric: [],
        wordLimit: 500,
        tags: [],
        children: [],
      },
    ]);
  }
  function patchPrompt(i: number, patch: any) {
    update(prompts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removePrompt(i: number) {
    update(prompts.filter((_, idx) => idx !== i));
  }
  function movePrompt(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= prompts.length) return;
    const next = [...prompts];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }

  return (
    <CollapseContext.Provider value={collapseState}>
      <div className="space-y-3">
        <ListToolbar onAdd={addPrompt} addLabel={t("admin.structured.addPrompt")} readOnly={readOnly} showCollapseControls />
        {prompts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t("admin.structured.noPrompts")}</p>
        ) : (
          prompts.map((p, i) => (
            <ItemRow
              key={i}
              index={i}
              total={prompts.length}
              onMove={(d) => movePrompt(i, d)}
              onRemove={() => removePrompt(i)}
              readOnly={readOnly}
              dragScope={dndScope}
              onDragReorder={(from, to) => update(arrayMove(prompts, from, to))}
              title={`Prompt ${i + 1}`}
              collapsible
            >
            <Field label="ID">
              <Input
                value={p.id ?? ""}
                onChange={(e) => patchPrompt(i, { id: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
                placeholder="w-001"
              />
            </Field>
            <Field label="Prompt">
              <MilkdownEditor
  value={p.prompt ?? ""}
  onChange={(v) => patchPrompt(i, { prompt: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
            </Field>
            <Field label="Model Answer" hint="Markdown supported">
              <MilkdownEditor
  value={p.modelAnswer ?? ""}
  onChange={(v) => patchPrompt(i, { modelAnswer: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
            </Field>
            <Field label="Explanation" hint="Markdown supported">
              <MilkdownEditor
  value={p.explanation ?? ""}
  onChange={(v) => patchPrompt(i, { explanation: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
/>
            </Field>
            <Field label="Rubric" hint="One item per line">
              <Textarea
                value={Array.isArray(p.rubric) ? p.rubric.join("\n") : ""}
                onChange={(e) => patchPrompt(i, { rubric: e.target.value.split("\n").filter(Boolean) })}
                readOnly={readOnly}
                rows={3}
                placeholder="One rubric item per line…"
              />
            </Field>
            <TagListField
              label="Tags"
              tags={p.tags ?? []}
              onChange={(t) => patchPrompt(i, { tags: t })}
              readOnly={readOnly}
            />
            <Field label="Word limit">
              <Input
                type="number"
                value={p.wordLimit ?? 500}
                onChange={(e) => patchPrompt(i, { wordLimit: Number(e.target.value) })}
                readOnly={readOnly}
                className="w-24"
              />
            </Field>

            <SectionLabel>{t("admin.structured.childrenSubquestions")}</SectionLabel>
            <WrittenChildrenEditor
              items={p.children ?? []}
              onChange={(c) => patchPrompt(i, { children: c })}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
          </ItemRow>
        ))
      )}
      </div>
    </CollapseContext.Provider>
  );
}

export function WrittenChildrenEditor({
  items,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
}: {
  items: any[];
  onChange: (next: any[]) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
}) {
  const children = items;
  function add() {
    onChange([...children, { id: `c-${String(Date.now()).slice(-6)}`, label: "", question: "", modelAnswer: "" }]);
  }
  function patch(i: number, patch: any) {
    onChange(children.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function remove(i: number) {
    onChange(children.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      {children.map((c, i) => (
        <div key={i} className="border border-border rounded-xl p-2 space-y-2 bg-card/60">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="font-mono text-xs">Child {i + 1}</Badge>
            {!readOnly && (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => remove(i)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="ID">
              <Input
                value={c.id ?? ""}
                onChange={(e) => patch(i, { id: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Label">
              <Input
                value={c.label ?? ""}
                onChange={(e) => patch(i, { label: e.target.value })}
                readOnly={readOnly}
                placeholder="Part A"
              />
            </Field>
          </div>
          <MilkdownEditor
  value={c.question ?? ""}
  onChange={(v) => patch(i, { question: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
  placeholder="Sub-question"
/>
          <MilkdownEditor
  value={c.modelAnswer ?? ""}
  onChange={(v) => patch(i, { modelAnswer: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
  placeholder="Model answer"
/>
        </div>
      ))}
      {!readOnly && (
        <Button size="sm" variant="ghost" onClick={add} className="text-xs">
          <Plus className="size-3 me-1" /> Add child
        </Button>
      )}
    </div>
  );
}

// ── Bank editor — supports passages + flat questions ──────────────────────
// Bank files may have:
//   { passages: [...], questions: [...] }  — passage-backed + standalone
//   { passages: [...] }                    — passage-backed only
//   { questions: [...] }                   — flat questions only (no passages)