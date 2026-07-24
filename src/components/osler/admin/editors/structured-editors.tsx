"use client";

import * as React from "react";
import { CheckCircle2, XCircle, AlignLeft } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { MarkdownEditor } from "./markdown-editor";

// ── Shared types ───────────────────────────────────────────────────────────

export interface StructuredEditorProps {
  /** Current parsed object. */
  value: any;
  /** Called whenever the user mutates the object. The parent is responsible
   *  for serializing back to JSON and persisting via the admin API. */
  onChange: (next: any) => void;
  /** Whether the editor is read-only (e.g. content is in "pending" state). */
  readOnly?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        {hint && <span className="text-xs text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ListToolbar({
  onAdd,
  addLabel,
  readOnly,
}: {
  onAdd: () => void;
  addLabel: string;
  readOnly?: boolean;
}) {
  if (readOnly) return null;
  return (
    <div className="flex justify-end mb-2">
      <Button size="sm" variant="outline" onClick={onAdd}>
        <Plus className="size-3.5 me-1" />
        {addLabel}
      </Button>
    </div>
  );
}

function ItemRow({
  index,
  total,
  onMove,
  onRemove,
  readOnly,
  children,
  title,
}: {
  index: number;
  total: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
  readOnly?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-3 bg-card/40">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono">
          {title}
        </Badge>
        {!readOnly && (
          <div className="ml-auto flex items-center gap-0.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    onClick={() => onMove(-1)}
                    disabled={index === 0}
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Move up</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    onClick={() => onMove(1)}
                    disabled={index === total - 1}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Move down</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={onRemove}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Quiz / QBank editor ────────────────────────────────────────────────────
//
// Supports two shapes:
//   - { questions: [{ stem, choices: [{ text, correct }], explanation }] }
//   - { passages: [{ id, title, stem, questions: [...] }] }
//
// The editor picks the right shape based on which top-level array exists.

export function QuizEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();

  // Passages mode
  if (Array.isArray(value?.passages)) {
    return (
      <PassagesEditor value={value} onChange={onChange} readOnly={readOnly} />
    );
  }

  // Questions mode
  const questions: any[] = Array.isArray(value?.questions) ? value.questions : [];

  function update(next: any[]) {
    onChange({ ...value, questions: next });
  }

  function addQuestion() {
    update([
      ...questions,
      { stem: "", choices: [{ text: "", correct: true }, { text: "", correct: false }], explanation: "" },
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
    <div className="space-y-3">
      <ListToolbar onAdd={addQuestion} addLabel={t("admin.content.editor.addQuestion")} readOnly={readOnly} />
      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No questions yet.</p>
      ) : (
        questions.map((q, i) => (
          <ItemRow
            key={i}
            index={i}
            total={questions.length}
            onMove={(d) => moveQuestion(i, d)}
            onRemove={() => removeQuestion(i)}
            readOnly={readOnly}
            title={t("admin.content.editor.question", { n: i + 1 })}
          >
            <Field label={t("admin.content.editor.stem")}>
              <Textarea
                value={q.stem ?? ""}
                onChange={(e) => patchQuestion(i, { stem: e.target.value })}
                readOnly={readOnly}
                rows={2}
              />
            </Field>
            <ChoicesEditor
              choices={q.choices ?? []}
              onChange={(choices) => patchQuestion(i, { choices })}
              readOnly={readOnly}
            />
            <Field label={t("admin.content.editor.explanation")}>
              <Textarea
                value={q.explanation ?? ""}
                onChange={(e) => patchQuestion(i, { explanation: e.target.value })}
                readOnly={readOnly}
                rows={2}
              />
            </Field>
          </ItemRow>
        ))
      )}
    </div>
  );
}

function PassagesEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();
  const passages: any[] = Array.isArray(value?.passages) ? value.passages : [];

  function update(next: any[]) {
    onChange({ ...value, passages: next });
  }

  function addPassage() {
    update([
      ...passages,
      { id: `passage-${passages.length + 1}`, title: "", stem: "", questions: [] },
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
    <div className="space-y-3">
      <ListToolbar onAdd={addPassage} addLabel="Add passage" readOnly={readOnly} />
      {passages.map((p, i) => (
        <ItemRow
          key={i}
          index={i}
          total={passages.length}
          onMove={(d) => movePassage(i, d)}
          onRemove={() => removePassage(i)}
          readOnly={readOnly}
          title={`Passage ${i + 1}`}
        >
          <Field label="ID">
            <Input
              value={p.id ?? ""}
              onChange={(e) => patchPassage(i, { id: e.target.value })}
              readOnly={readOnly}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Title">
            <Input
              value={p.title ?? ""}
              onChange={(e) => patchPassage(i, { title: e.target.value })}
              readOnly={readOnly}
            />
          </Field>
          <Field label="Passage text">
            <Textarea
              value={p.stem ?? ""}
              onChange={(e) => patchPassage(i, { stem: e.target.value })}
              readOnly={readOnly}
              rows={4}
            />
          </Field>
          <Field label="Questions">
            <QuizEditor
              value={{ questions: p.questions ?? [] }}
              onChange={(v) => patchPassage(i, { questions: v.questions })}
              readOnly={readOnly}
            />
          </Field>
        </ItemRow>
      ))}
    </div>
  );
}

function ChoicesEditor({
  choices,
  onChange,
  readOnly,
}: {
  choices: any[];
  onChange: (c: any[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();

  function addChoice() {
    onChange([...choices, { text: "", correct: false }]);
  }

  function patchChoice(i: number, patch: any) {
    onChange(choices.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function removeChoice(i: number) {
    onChange(choices.filter((_, idx) => idx !== i));
  }

  function setCorrect(i: number) {
    // Single-correct: clear all others
    onChange(choices.map((c, idx) => ({ ...c, correct: idx === i })));
  }

  return (
    <Field label={t("admin.content.editor.choices")}>
      <div className="space-y-1.5">
        {choices.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !readOnly && setCorrect(i)}
              disabled={readOnly}
              className={cn(
                "size-5 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                c.correct
                  ? "bg-success border-success text-success-foreground"
                  : "border-border text-transparent hover:border-success/50",
              )}
              aria-label={c.correct ? "Correct answer" : "Mark as correct"}
            >
              {c.correct && <CheckCircle2 className="size-3" />}
            </button>
            <Input
              value={c.text ?? ""}
              onChange={(e) => patchChoice(i, { text: e.target.value })}
              readOnly={readOnly}
              className="flex-1"
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

// ── Flashcard editor ───────────────────────────────────────────────────────
//
// Shape: { cards: [{ front, back }] } or { front, back, ... } for a single card.
// Also handles subdecks: { decks: [{ name, cards: [...] }] }

export function FlashcardEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();

  // Subdecks mode
  if (Array.isArray(value?.decks)) {
    return <SubdecksEditor value={value} onChange={onChange} readOnly={readOnly} />;
  }

  // Single card mode
  if (value?.front != null || value?.back != null) {
    return (
      <div className="space-y-3">
        <Field label={t("admin.content.editor.front")}>
          <Textarea
            value={value.front ?? ""}
            onChange={(e) => onChange({ ...value, front: e.target.value })}
            readOnly={readOnly}
            rows={3}
          />
        </Field>
        <Field label={t("admin.content.editor.back")}>
          <Textarea
            value={value.back ?? ""}
            onChange={(e) => onChange({ ...value, back: e.target.value })}
            readOnly={readOnly}
            rows={3}
          />
        </Field>
      </div>
    );
  }

  // Cards array mode
  const cards: any[] = Array.isArray(value?.cards) ? value.cards : [];

  function update(next: any[]) {
    onChange({ ...value, cards: next });
  }

  function addCard() {
    update([...cards, { front: "", back: "" }]);
  }

  function patchCard(i: number, patch: any) {
    update(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function moveCard(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }

  function removeCard(i: number) {
    update(cards.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <ListToolbar onAdd={addCard} addLabel={t("admin.content.editor.addCard")} readOnly={readOnly} />
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No cards yet.</p>
      ) : (
        cards.map((c, i) => (
          <ItemRow
            key={i}
            index={i}
            total={cards.length}
            onMove={(d) => moveCard(i, d)}
            onRemove={() => removeCard(i)}
            readOnly={readOnly}
            title={t("admin.content.editor.card", { n: i + 1 })}
          >
            <Field label={t("admin.content.editor.front")}>
              <Textarea
                value={c.front ?? ""}
                onChange={(e) => patchCard(i, { front: e.target.value })}
                readOnly={readOnly}
                rows={2}
              />
            </Field>
            <Field label={t("admin.content.editor.back")}>
              <Textarea
                value={c.back ?? ""}
                onChange={(e) => patchCard(i, { back: e.target.value })}
                readOnly={readOnly}
                rows={2}
              />
            </Field>
          </ItemRow>
        ))
      )}
    </div>
  );
}

function SubdecksEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const decks: any[] = Array.isArray(value?.decks) ? value.decks : [];

  function update(next: any[]) {
    onChange({ ...value, decks: next });
  }

  function addDeck() {
    update([...decks, { name: "New subdeck", cards: [] }]);
  }

  function patchDeck(i: number, patch: any) {
    update(decks.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function removeDeck(i: number) {
    update(decks.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <ListToolbar onAdd={addDeck} addLabel="Add subdeck" readOnly={readOnly} />
      {decks.map((d, i) => (
        <ItemRow
          key={i}
          index={i}
          total={decks.length}
          onMove={() => {}}
          onRemove={() => removeDeck(i)}
          readOnly={readOnly}
          title={`Subdeck ${i + 1}`}
        >
          <Field label="Name">
            <Input
              value={d.name ?? ""}
              onChange={(e) => patchDeck(i, { name: e.target.value })}
              readOnly={readOnly}
            />
          </Field>
          <Field label="Cards">
            <FlashcardEditor
              value={{ cards: d.cards ?? [] }}
              onChange={(v) => patchDeck(i, { cards: v.cards })}
              readOnly={readOnly}
            />
          </Field>
        </ItemRow>
      ))}
    </div>
  );
}

// ── OSCE editor ────────────────────────────────────────────────────────────
//
// Shape: { stations: [{ id, title, brief, tasks: [...], checklist: [...] }] }

export function OsceEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();
  const stations: any[] = Array.isArray(value?.stations) ? value.stations : [];

  function update(next: any[]) {
    onChange({ ...value, stations: next });
  }

  function addStation() {
    update([
      ...stations,
      { id: `station-${stations.length + 1}`, title: "", brief: "", tasks: [], checklist: [] },
    ]);
  }

  function patchStation(i: number, patch: any) {
    update(stations.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function removeStation(i: number) {
    update(stations.filter((_, idx) => idx !== i));
  }

  function moveStation(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= stations.length) return;
    const next = [...stations];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }

  return (
    <div className="space-y-3">
      <ListToolbar onAdd={addStation} addLabel={t("admin.content.editor.addStation")} readOnly={readOnly} />
      {stations.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No stations yet.</p>
      ) : (
        stations.map((s, i) => (
          <ItemRow
            key={i}
            index={i}
            total={stations.length}
            onMove={(d) => moveStation(i, d)}
            onRemove={() => removeStation(i)}
            readOnly={readOnly}
            title={`Station ${i + 1}`}
          >
            <Field label="ID">
              <Input
                value={s.id ?? ""}
                onChange={(e) => patchStation(i, { id: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Title">
              <Input
                value={s.title ?? ""}
                onChange={(e) => patchStation(i, { title: e.target.value })}
                readOnly={readOnly}
              />
            </Field>
            <Field label="Brief">
              <Textarea
                value={s.brief ?? ""}
                onChange={(e) => patchStation(i, { brief: e.target.value })}
                readOnly={readOnly}
                rows={3}
              />
            </Field>
            <StringListField
              label="Tasks"
              items={s.tasks ?? []}
              onChange={(tasks) => patchStation(i, { tasks })}
              readOnly={readOnly}
              placeholder="Describe a task…"
            />
            <StringListField
              label="Checklist"
              items={s.checklist ?? []}
              onChange={(checklist) => patchStation(i, { checklist })}
              readOnly={readOnly}
              placeholder="Checklist item…"
            />
          </ItemRow>
        ))
      )}
    </div>
  );
}

function StringListField({
  label,
  items,
  onChange,
  readOnly,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(e) => onChange(items.map((it, idx) => (idx === i ? e.target.value : it)))}
              readOnly={readOnly}
              placeholder={placeholder}
            />
            {!readOnly && (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange([...items, ""])}
            className="text-xs"
          >
            <Plus className="size-3 me-1" />
            Add {label.toLowerCase()}
          </Button>
        )}
      </div>
    </Field>
  );
}

// ── Video editor ───────────────────────────────────────────────────────────
//
// Shape: { videos: [{ title, url, duration, description }] }

export function VideoEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();
  const videos: any[] = Array.isArray(value?.videos) ? value.videos : [];

  function update(next: any[]) {
    onChange({ ...value, videos: next });
  }

  function addVideo() {
    update([...videos, { title: "", url: "", duration: 0, description: "" }]);
  }

  function patchVideo(i: number, patch: any) {
    update(videos.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }

  function removeVideo(i: number) {
    update(videos.filter((_, idx) => idx !== i));
  }

  function moveVideo(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= videos.length) return;
    const next = [...videos];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }

  return (
    <div className="space-y-3">
      <ListToolbar onAdd={addVideo} addLabel={t("admin.content.editor.addVideo")} readOnly={readOnly} />
      {videos.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No videos yet.</p>
      ) : (
        videos.map((v, i) => (
          <ItemRow
            key={i}
            index={i}
            total={videos.length}
            onMove={(d) => moveVideo(i, d)}
            onRemove={() => removeVideo(i)}
            readOnly={readOnly}
            title={`Video ${i + 1}`}
          >
            <Field label={t("admin.content.editor.titleField")}>
              <Input
                value={v.title ?? ""}
                onChange={(e) => patchVideo(i, { title: e.target.value })}
                readOnly={readOnly}
              />
            </Field>
            <Field label={t("admin.content.editor.url")}>
              <Input
                value={v.url ?? ""}
                onChange={(e) => patchVideo(i, { url: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
                placeholder="https://…"
              />
            </Field>
            <Field label={t("admin.content.editor.duration")}>
              <Input
                type="number"
                value={v.duration ?? 0}
                onChange={(e) => patchVideo(i, { duration: Number(e.target.value) })}
                readOnly={readOnly}
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={v.description ?? ""}
                onChange={(e) => patchVideo(i, { description: e.target.value })}
                readOnly={readOnly}
                rows={2}
              />
            </Field>
          </ItemRow>
        ))
      )}
    </div>
  );
}

// ── Library / article editor ───────────────────────────────────────────────
//
// Shape: raw markdown — handled at the parent level via a textarea, but this
// editor shows title + tags fields if the markdown starts with a YAML frontmatter.

export function LibraryArticleEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();
  const markdown: string = typeof value === "string" ? value : (value?.body ?? "");

  function update(next: string) {
    if (typeof value === "string") onChange(next);
    else onChange({ ...value, body: next });
  }

  // Word/char count
  const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  const chars = markdown.length;
  const lines = markdown.split("\n").length;

  return (
    <div className="space-y-2 h-full flex flex-col">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlignLeft className="size-3.5" />
        <span>{t("admin.content.editor.wordCount", { n: words })}</span>
        <span>·</span>
        <span>{t("admin.content.editor.charCount", { n: chars })}</span>
        <span>·</span>
        <span>{t("admin.content.editor.lineCount", { n: lines })}</span>
      </div>
      <MarkdownEditor
        value={markdown}
        onChange={update}
        readOnly={readOnly}
        placeholder="# Article title\n\nWrite your article in **Markdown**…"
        className="flex-1 min-h-[400px]"
      />
    </div>
  );
}

// ── Written / Prompt editor ─────────────────────────────────────────────────
//
// Shape: { prompts: [{ id, prompt, modelAnswer, explanation, rubric, wordLimit, tags, children }] }

export function WrittenEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();
  const prompts: any[] = Array.isArray(value?.prompts) ? value.prompts : [];

  function update(next: any[]) {
    onChange({ ...value, prompts: next });
  }

  function addPrompt() {
    update([
      ...prompts,
      {
        id: `prompt-${prompts.length + 1}`,
        prompt: "",
        modelAnswer: "",
        explanation: "",
        rubric: [],
        wordLimit: 500,
        tags: [],
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
    <div className="space-y-3">
      <ListToolbar onAdd={addPrompt} addLabel={t("admin.content.editor.addPrompt")} readOnly={readOnly} />
      {prompts.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No prompts yet.</p>
      ) : (
        prompts.map((p, i) => (
          <ItemRow
            key={i}
            index={i}
            total={prompts.length}
            onMove={(d) => movePrompt(i, d)}
            onRemove={() => removePrompt(i)}
            readOnly={readOnly}
            title={t("admin.content.editor.prompt", { n: i + 1 })}
          >
            <Field label="ID">
              <Input
                value={p.id ?? ""}
                onChange={(e) => patchPrompt(i, { id: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Prompt">
              <Textarea
                value={p.prompt ?? ""}
                onChange={(e) => patchPrompt(i, { prompt: e.target.value })}
                readOnly={readOnly}
                rows={3}
              />
            </Field>
            <Field label="Model Answer" hint="Markdown supported">
              <Textarea
                value={p.modelAnswer ?? ""}
                onChange={(e) => patchPrompt(i, { modelAnswer: e.target.value })}
                readOnly={readOnly}
                rows={4}
              />
            </Field>
            <Field label="Explanation" hint="Markdown supported">
              <Textarea
                value={p.explanation ?? ""}
                onChange={(e) => patchPrompt(i, { explanation: e.target.value })}
                readOnly={readOnly}
                rows={2}
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
            <div className="flex items-center gap-4">
              <Field label="Word Limit">
                <Input
                  type="number"
                  value={p.wordLimit ?? 500}
                  onChange={(e) => patchPrompt(i, { wordLimit: Number(e.target.value) })}
                  readOnly={readOnly}
                  className="w-24"
                />
              </Field>
              <StringListField
                label="Tags"
                items={p.tags ?? []}
                onChange={(tags) => patchPrompt(i, { tags })}
                readOnly={readOnly}
                placeholder="Tag…"
              />
            </div>
          </ItemRow>
        ))
      )}
    </div>
  );
}

// ── Bank / Passage editor ───────────────────────────────────────────────────
//
// Shape: { passages: [{ id, content, questions: [...] }] }

export function BankEditor({ value, onChange, readOnly }: StructuredEditorProps) {
  const { t } = useI18n();
  const passages: any[] = Array.isArray(value?.passages) ? value.passages : [];

  function update(next: any[]) {
    onChange({ ...value, passages: next });
  }

  function addPassage() {
    update([
      ...passages,
      { id: `passage-${passages.length + 1}`, content: "", questions: [] },
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
    <div className="space-y-3">
      <ListToolbar onAdd={addPassage} addLabel="Add passage" readOnly={readOnly} />
      {passages.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No passages yet.</p>
      ) : (
        passages.map((p, i) => (
          <ItemRow
            key={i}
            index={i}
            total={passages.length}
            onMove={(d) => movePassage(i, d)}
            onRemove={() => removePassage(i)}
            readOnly={readOnly}
            title={`Passage ${i + 1}`}
          >
            <Field label="ID">
              <Input
                value={p.id ?? ""}
                onChange={(e) => patchPassage(i, { id: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Passage text">
              <Textarea
                value={p.content ?? ""}
                onChange={(e) => patchPassage(i, { content: e.target.value })}
                readOnly={readOnly}
                rows={6}
              />
            </Field>
            <Field label="Questions">
              <QuizEditor
                value={{ questions: p.questions ?? [] }}
                onChange={(v) => patchPassage(i, { questions: v.questions })}
                readOnly={readOnly}
              />
            </Field>
          </ItemRow>
        ))
      )}
    </div>
  );
}
