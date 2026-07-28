"use client";

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

import * as React from "react";
import {
  CheckCircle2,
  XCircle,
  AlignLeft,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  ImagePlus,
  GripVertical,
  Youtube,
  FileText,
  Upload,
  Eye,
  Loader2,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
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
import { MarkdownEditor } from "./markdown-editor";
import { useToast } from "@/hooks/use-toast";
import {
  uploadImageForEditor,
  resolveImageForPreview,
  isImageFile,
} from "./image-upload";

// ── Shared types ───────────────────────────────────────────────────────────

export interface StructuredEditorProps {
  /** Current parsed object. */
  value: any;
  /** Called whenever the user mutates the object. The parent is responsible
   *  for serializing back to JSON and persisting via the admin API. */
  onChange: (next: any) => void;
  /** Whether the editor is read-only (e.g. content is in "pending" state). */
  readOnly?: boolean;
  /** Optional R2 key base for the content_object — used to resolve image
   *  uploads. When provided, the ImageField component shows an "Upload" button
   *  that uploads to `<r2_key_base>/images/<name>` and inserts the reference. */
  r2KeyBase?: string;
  /** Optional raw R2 key for in-place editing of a content-files/.../file
   *  without a managed content_object. Used to resolve image uploads when
   *  `r2KeyBase` is not provided. */
  rawR2Key?: string;
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 mb-1 text-xs font-bold uppercase tracking-wider text-primary/80 border-b border-primary/20 pb-1">
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
  const { t } = useI18n();
  return (
    <div className="border border-border rounded-xl p-3 space-y-3 bg-card/60">
      <div className="flex items-center gap-2">
        <GripVertical className="size-3.5 text-muted-foreground/40" />
        <Badge variant="outline" className="font-mono">
          {title}
        </Badge>
        {!readOnly && (
          <div className="ms-auto flex items-center gap-0.5">
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
                <TooltipContent>{t("admin.structured.moveUp")}</TooltipContent>
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
                <TooltipContent>{t("admin.structured.moveDown")}</TooltipContent>
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
                <TooltipContent>{t("common.remove")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Tag list (chips) ───────────────────────────────────────────────────────

function TagListField({
  label,
  tags,
  onChange,
  readOnly,
  placeholder = "Add tag…",
}: {
  label: string;
  tags: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState("");
  function commit(v: string) {
    const t = v.trim();
    if (!t) return;
    if (tags.includes(t)) { setDraft(""); return; }
    onChange([...tags, t]);
    setDraft("");
  }
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5 p-1.5 border border-border rounded-xl bg-background min-h-9">
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 text-xs"
          >
            {tag}
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
                className="text-primary/70 hover:text-destructive"
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit(draft);
              } else if (e.key === "Backspace" && !draft && tags.length) {
                onChange(tags.slice(0, -1));
              }
            }}
            onBlur={() => commit(draft)}
            placeholder={placeholder}
            className="flex-1 min-w-[100px] bg-transparent text-xs px-1 outline-none"
          />
        )}
      </div>
    </Field>
  );
}

// ── Image list ─────────────────────────────────────────────────────────────

function ImageListField({
  label,
  images,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
  hint,
}: {
  label: string;
  images: any;
  onChange: (next: any) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  // Normalize: accept string | { src, alt, caption } | array of either
  const arr: Array<{ src: string; alt?: string; caption?: string }> = React.useMemo(() => {
    if (!images) return [];
    if (Array.isArray(images)) {
      return images.map((im: any) => (typeof im === "string" ? { src: im } : { ...im }));
    }
    if (typeof images === "string") return [{ src: images }];
    if (typeof images === "object") return [{ ...images }];
    return [];
  }, [images]);

  function commit(next: Array<{ src: string; alt?: string; caption?: string }>) {
    if (next.length === 0) onChange(undefined);
    else if (next.length === 1) onChange(next[0]);
    else onChange(next);
  }

  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  const canUpload = !!(r2KeyBase || rawR2Key);

  async function handleUpload(file: File): Promise<void> {
    if (!isImageFile(file)) {
      toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
      return;
    }
    if (!canUpload) {
      toast({ title: t("admin.structured.cannotUpload"), variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const result = await uploadImageForEditor(file, { r2KeyBase, rawR2Key });
      commit([...arr, { src: result.ref, alt: file.name.replace(/\.[^.]+$/, "") }]);
      toast({
        title: t("admin.markdown.uploaded", { name: file.name }),
        description: result.key,
      });
    } catch (err: any) {
      toast({
        title: t("admin.markdown.uploadFailed"),
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: File[] | FileList): Promise<void> {
    const arr2 = Array.from(files);
    const imgs = arr2.filter(isImageFile);
    if (imgs.length === 0) {
      toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
      return;
    }
    for (const f of imgs) await handleUpload(f);
  }

  function handleDrop(e: React.DragEvent) {
    if (readOnly) return;
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    const arr2 = Array.from(e.dataTransfer.files);
    if (!arr2.some(isImageFile)) return;
    e.preventDefault();
    setDragActive(false);
    void handleFiles(arr2);
  }

  function handleDragOver(e: React.DragEvent) {
    if (readOnly) return;
    if (!e.dataTransfer) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) setDragActive(false);
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (readOnly) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length === 0) return;
    e.preventDefault();
    void handleFiles(imgs);
  }

  return (
    <Field label={label} hint={hint}>
      <div
        className={cn(
          "space-y-1.5 relative rounded transition-colors",
          dragActive && "ring-2 ring-inset ring-primary/60 bg-primary/5",
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onPaste={handlePaste}
      >
        {arr.map((img, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-start">
            <Input
              value={img.src ?? ""}
              onChange={(e) => commit(arr.map((a, idx) => (idx === i ? { ...a, src: e.target.value } : a)))}
              readOnly={readOnly}
              placeholder="ecg.png or images/ecg.png"
              className="text-xs"
            />
            <Input
              value={img.alt ?? ""}
              onChange={(e) => commit(arr.map((a, idx) => (idx === i ? { ...a, alt: e.target.value } : a)))}
              readOnly={readOnly}
              placeholder="alt"
              className="text-xs"
            />
            <Input
              value={img.caption ?? ""}
              onChange={(e) => commit(arr.map((a, idx) => (idx === i ? { ...a, caption: e.target.value } : a)))}
              readOnly={readOnly}
              placeholder="caption"
              className="text-xs"
            />
            {!readOnly && (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => commit(arr.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            {img.src && (
              <div className="col-span-4 -mt-1 mb-1">
                <img
                  src={resolveImageForPreview(img.src, { r2KeyBase, rawR2Key })}
                  alt={img.alt ?? ""}
                  className="h-12 rounded border border-border"
                  onError={(e) => {
                    // Don't hide the whole <img> — show a muted fallback
                    // rectangle so the user can still see something is there.
                    const el = e.currentTarget as HTMLImageElement;
                    el.style.opacity = "0.3";
                    el.style.background = "oklch(0.92 0 0)";
                  }}
                />
              </div>
            )}
          </div>
        ))}
        {!readOnly && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <Button size="sm" variant="ghost" onClick={() => commit([...arr, { src: "" }])} className="text-xs">
              <Plus className="size-3 me-1" /> {t("admin.structured.addImage")}
            </Button>
            {canUpload && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="text-xs"
                >
                  {uploading
                    ? <Loader2 className="size-3 me-1 animate-spin" />
                    : <ImagePlus className="size-3 me-1" />}
                  {t("admin.structured.uploadImage")}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {t("admin.structured.dropOrPasteHint")}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      void handleFiles(e.target.files);
                    }
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </div>
        )}
        {dragActive && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/60 rounded pointer-events-none">
            <div className="flex flex-col items-center gap-1 text-primary">
              <ImagePlus className="size-5" />
              <span className="text-[11px] font-medium">{t("admin.markdown.dropToUpload")}</span>
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}

// ── String list (one per line) ─────────────────────────────────────────────

function StringListField({
  label,
  items,
  onChange,
  readOnly,
  placeholder,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
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

// ── Quiz editor (questions + passages) ─────────────────────────────────────
//
// Supports the rich shape from tauri-admin:
//   { questions: [{ id, question, options[], correct, explanation, images,
//                   choiceImages[], explanationImages, tags[], difficulty }] }
// Also handles bank-style passages: { passages: [{ id, content, questions: [...] }] }

export function QuizEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();

  if (Array.isArray(value?.passages)) {
    return <PassagesEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }

  const questions: any[] = Array.isArray(value?.questions) ? value.questions : [];

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
    <div className="space-y-3">
      <ListToolbar onAdd={addQuestion} addLabel={t("admin.content.editor.addQuestion")} readOnly={readOnly} />
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
            title={t("admin.content.editor.question", { n: i + 1 })}
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
              <Textarea
                value={q.question ?? q.stem ?? ""}
                onChange={(e) => patchQuestion(i, { question: e.target.value, stem: e.target.value })}
                readOnly={readOnly}
                rows={3}
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
              <Textarea
                value={q.explanation ?? ""}
                onChange={(e) => patchQuestion(i, { explanation: e.target.value })}
                readOnly={readOnly}
                rows={3}
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
  );
}

function ChoicesEditor({
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

function ChoiceImagesEditor({
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

function PassagesEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const passages: any[] = Array.isArray(value?.passages) ? value.passages : [];

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
          <Field label="Passage text" hint="Markdown supported">
            <Textarea
              value={p.content ?? p.stem ?? ""}
              onChange={(e) => patchPassage(i, { content: e.target.value, stem: e.target.value })}
              readOnly={readOnly}
              rows={5}
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
  );
}

// ── Flashcard editor (basic + cloze + subdecks) ────────────────────────────

export function FlashcardEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  if (Array.isArray(value?.decks)) {
    return <SubdecksEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }

  if (value?.front != null || value?.back != null) {
    return (
      <div className="space-y-3">
        <Field label="Front">
          <Textarea
            value={value.front ?? ""}
            onChange={(e) => onChange({ ...value, front: e.target.value })}
            readOnly={readOnly}
            rows={3}
          />
        </Field>
        <Field label="Back">
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

  const cards: any[] = Array.isArray(value?.cards) ? value.cards : [];
  const subdecks: any[] = Array.isArray(value?.subdecks) ? value.subdecks : [];

  function updateCards(next: any[]) {
    onChange({ ...value, cards: next });
  }
  function addCard() {
    updateCards([
      ...cards,
      {
        id: `fc-${String(Date.now()).slice(-6)}`,
        front: "",
        back: "",
        tags: [],
      },
    ]);
  }
  function moveCard(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    updateCards(next);
  }
  function removeCard(i: number) {
    updateCards(cards.filter((_, idx) => idx !== i));
  }
  function patchCard(i: number, patch: any) {
    updateCards(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function updateSubdecks(next: any[]) {
    onChange({ ...value, subdecks: next });
  }

  return (
    <div className="space-y-4">
      {/* Subdecks */}
      <div className="space-y-3">
        <SectionLabel>Subdecks ({subdecks.length})</SectionLabel>
        {subdecks.map((sd, i) => (
          <div key={i} className="border border-border rounded-xl p-3 space-y-2 bg-card/60">
            <div className="flex items-center gap-2">
              <Field label="ID">
                <Input
                  value={sd.id ?? ""}
                  onChange={(e) => updateSubdecks(subdecks.map((s, idx) => (idx === i ? { ...s, id: e.target.value } : s)))}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Title">
                <Input
                  value={sd.title ?? ""}
                  onChange={(e) => updateSubdecks(subdecks.map((s, idx) => (idx === i ? { ...s, title: e.target.value } : s)))}
                  readOnly={readOnly}
                />
              </Field>
              {!readOnly && (
                <Button
                  size="iconSm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive mt-5"
                  onClick={() => updateSubdecks(subdecks.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => updateSubdecks([...subdecks, { id: `sd-${String(Date.now()).slice(-6)}`, title: "" }])}
            className="text-xs"
          >
            <Plus className="size-3 me-1" /> Add subdeck
          </Button>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        <SectionLabel>Cards ({cards.length})</SectionLabel>
        <ListToolbar onAdd={addCard} addLabel={t("admin.structured.addCard")} readOnly={readOnly} />
        {cards.map((c, i) => {
          const isCloze = (c.type ?? "basic") === "cloze";
          return (
            <ItemRow
              key={i}
              index={i}
              total={cards.length}
              onMove={(d) => moveCard(i, d)}
              onRemove={() => removeCard(i)}
              readOnly={readOnly}
              title={`Card ${i + 1}`}
            >
              <Field label="ID">
                <Input
                  value={c.id ?? ""}
                  onChange={(e) => patchCard(i, { id: e.target.value })}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                  placeholder="fc-001"
                />
              </Field>
              <Field label="Type">
                <Select
                  value={c.type ?? "basic"}
                  onValueChange={(v) => patchCard(i, { type: v === "basic" ? undefined : v })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">{t("admin.structured.basicFrontBack")}</SelectItem>
                    <SelectItem value="cloze">Cloze ({`{{c1::answer::hint}}`})</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {isCloze ? (
                <>
                  <Field label="Text" hint="Use {{c1::answer::hint}} for cloze deletions">
                    <Textarea
                      value={c.text ?? ""}
                      onChange={(e) => patchCard(i, { text: e.target.value })}
                      readOnly={readOnly}
                      rows={3}
                    />
                  </Field>
                  <Field label="Extra (shown under answer)">
                    <Textarea
                      value={c.extra ?? ""}
                      onChange={(e) => patchCard(i, { extra: e.target.value })}
                      readOnly={readOnly}
                      rows={2}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Front">
                    <Textarea
                      value={c.front ?? ""}
                      onChange={(e) => patchCard(i, { front: e.target.value })}
                      readOnly={readOnly}
                      rows={3}
                    />
                  </Field>
                  <Field label="Back">
                    <Textarea
                      value={c.back ?? ""}
                      onChange={(e) => patchCard(i, { back: e.target.value })}
                      readOnly={readOnly}
                      rows={3}
                    />
                  </Field>
                </>
              )}
              <ImageListField
                label="Image (front)"
                images={c.image}
                onChange={(v) => patchCard(i, { image: v })}
                readOnly={readOnly}
                r2KeyBase={r2KeyBase}
                rawR2Key={rawR2Key}
              />
              <ImageListField
                label="Image (back)"
                images={c.backImage}
                onChange={(v) => patchCard(i, { backImage: v })}
                readOnly={readOnly}
                r2KeyBase={r2KeyBase}
                rawR2Key={rawR2Key}
              />
              <Field label="Audio">
                <Input
                  value={c.audio ?? ""}
                  onChange={(e) => patchCard(i, { audio: e.target.value || undefined })}
                  readOnly={readOnly}
                  placeholder="clip.mp3"
                />
              </Field>
              {subdecks.length > 0 && (
                <Field label="Subdeck">
                  <Select
                    value={c.subdeckId ?? ""}
                    onValueChange={(v) => patchCard(i, { subdeckId: v || undefined })}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t("common.none")}</SelectItem>
                      {subdecks.map((sd) => (
                        <SelectItem key={sd.id} value={sd.id}>{sd.title || sd.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <TagListField
                label="Tags"
                tags={c.tags ?? []}
                onChange={(v) => patchCard(i, { tags: v })}
                readOnly={readOnly}
              />
            </ItemRow>
          );
        })}
      </div>
    </div>
  );
}

function SubdecksEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const decks: any[] = Array.isArray(value?.decks) ? value.decks : [];
  function update(next: any[]) {
    onChange({ ...value, decks: next });
  }
  function addDeck() {
    update([...decks, { id: `deck-${decks.length + 1}`, name: t("admin.structured.newDeck"), cards: [] }]);
  }
  function patchDeck(i: number, patch: any) {
    update(decks.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }
  function removeDeck(i: number) {
    update(decks.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-3">
      <ListToolbar onAdd={addDeck} addLabel={t("admin.structured.addDeck")} readOnly={readOnly} />
      {decks.map((d, i) => (
        <ItemRow
          key={i}
          index={i}
          total={decks.length}
          onMove={() => {}}
          onRemove={() => removeDeck(i)}
          readOnly={readOnly}
          title={`Deck ${i + 1}`}
        >
          <Field label="ID">
            <Input
              value={d.id ?? ""}
              onChange={(e) => patchDeck(i, { id: e.target.value })}
              readOnly={readOnly}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Name">
            <Input
              value={d.name ?? d.title ?? ""}
              onChange={(e) => patchDeck(i, { name: e.target.value, title: e.target.value })}
              readOnly={readOnly}
            />
          </Field>
          <Field label="Cards">
            <FlashcardEditor
              value={{ cards: d.cards ?? [] }}
              onChange={(v) => patchDeck(i, { cards: v.cards })}
              readOnly={readOnly}
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
          </Field>
        </ItemRow>
      ))}
    </div>
  );
}

// ── OSCE editor (full schema: patient, hiddenProfile, rubric, questions) ───

export function OsceEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const stations: any[] = Array.isArray(value?.stations) ? value.stations : [];

  function update(next: any[]) {
    onChange({ ...value, stations: next });
  }
  function addStation() {
    update([
      ...stations,
      {
        id: `osce-${String(Date.now()).slice(-6)}`,
        title: "",
        type: "history",
        specialty: "",
        difficulty: "Medium",
        task: "",
        time: 10,
        examiner: { name: "", title: "" },
        patient: { name: "", age: 0, gender: "male", avatarSeed: "", opening: "" },
        hiddenProfile: { diagnosis: "", keySymptoms: [], redFlags: [], pastHistory: [], vitalSigns: "" },
        rubric: { mustAsk: [], bonus: [] },
        dataPresented: null,
        questions: [],
      },
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
      <ListToolbar onAdd={addStation} addLabel={t("admin.structured.addStation")} readOnly={readOnly} />
      {stations.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t("admin.structured.noStations")}</p>
      ) : (
        stations.map((s, i) => (
          <ItemRow
            key={i}
            index={i}
            total={stations.length}
            onMove={(d) => moveStation(i, d)}
            onRemove={() => removeStation(i)}
            readOnly={readOnly}
            title={`Station ${i + 1}: ${s.title || ""}`}
          >
            <Field label="ID">
              <Input
                value={s.id ?? ""}
                onChange={(e) => patchStation(i, { id: e.target.value })}
                readOnly={readOnly}
                className="font-mono text-xs"
                placeholder="osce-001"
              />
            </Field>
            <Field label="Title">
              <Input
                value={s.title ?? ""}
                onChange={(e) => patchStation(i, { title: e.target.value })}
                readOnly={readOnly}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Type">
                <Select
                  value={s.type ?? "history"}
                  onValueChange={(v) => patchStation(i, { type: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="history">{t("admin.structured.historyTaking")}</SelectItem>
                    <SelectItem value="data-interp">{t("admin.structured.dataInterpretation")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Specialty">
                <Input
                  value={s.specialty ?? ""}
                  onChange={(e) => patchStation(i, { specialty: e.target.value })}
                  readOnly={readOnly}
                  placeholder="Cardiology"
                />
              </Field>
              <Field label="Difficulty">
                <Select
                  value={s.difficulty ?? "Medium"}
                  onValueChange={(v) => patchStation(i, { difficulty: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Easy">{t("admin.structured.easy")}</SelectItem>
                    <SelectItem value="Medium">{t("admin.structured.medium")}</SelectItem>
                    <SelectItem value="Hard">{t("admin.structured.hard")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Task">
              <Textarea
                value={s.task ?? ""}
                onChange={(e) => patchStation(i, { task: e.target.value })}
                readOnly={readOnly}
                rows={3}
              />
            </Field>
            <Field label="Time (minutes)">
              <Input
                type="number"
                value={s.time ?? 10}
                onChange={(e) => patchStation(i, { time: Number(e.target.value) })}
                readOnly={readOnly}
                className="w-24"
              />
            </Field>

            <SectionLabel>{t("admin.structured.examiner")}</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input
                  value={s.examiner?.name ?? ""}
                  onChange={(e) => patchStation(i, { examiner: { ...(s.examiner ?? { name: "", title: "" }), name: e.target.value } })}
                  readOnly={readOnly}
                />
              </Field>
              <Field label="Title">
                <Input
                  value={s.examiner?.title ?? ""}
                  onChange={(e) => patchStation(i, { examiner: { ...(s.examiner ?? { name: "", title: "" }), title: e.target.value } })}
                  readOnly={readOnly}
                />
              </Field>
            </div>

            <SectionLabel>{t("admin.structured.patient")}</SectionLabel>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Name">
                <Input
                  value={s.patient?.name ?? ""}
                  onChange={(e) => patchStation(i, { patient: { ...(s.patient ?? {}), name: e.target.value } })}
                  readOnly={readOnly}
                />
              </Field>
              <Field label="Age">
                <Input
                  type="number"
                  value={s.patient?.age ?? 0}
                  onChange={(e) => patchStation(i, { patient: { ...(s.patient ?? {}), age: Number(e.target.value) } })}
                  readOnly={readOnly}
                />
              </Field>
              <Field label="Gender">
                <Select
                  value={s.patient?.gender ?? "male"}
                  onValueChange={(v) => patchStation(i, { patient: { ...(s.patient ?? {}), gender: v } })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">{t("admin.structured.male")}</SelectItem>
                    <SelectItem value="female">{t("admin.structured.female")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Avatar seed">
              <Input
                value={s.patient?.avatarSeed ?? ""}
                onChange={(e) => patchStation(i, { patient: { ...(s.patient ?? {}), avatarSeed: e.target.value } })}
                readOnly={readOnly}
              />
            </Field>
            <Field label="Opening">
              <Textarea
                value={s.patient?.opening ?? ""}
                onChange={(e) => patchStation(i, { patient: { ...(s.patient ?? {}), opening: e.target.value } })}
                readOnly={readOnly}
                rows={2}
                placeholder="Patient's first line"
              />
            </Field>

            <SectionLabel>{t("admin.structured.hiddenProfile")}</SectionLabel>
            <Field label="Diagnosis">
              <Textarea
                value={s.hiddenProfile?.diagnosis ?? ""}
                onChange={(e) => patchStation(i, { hiddenProfile: { ...(s.hiddenProfile ?? {}), diagnosis: e.target.value } })}
                readOnly={readOnly}
                rows={2}
              />
            </Field>
            <TagListField
              label="Key symptoms"
              tags={s.hiddenProfile?.keySymptoms ?? []}
              onChange={(v) => patchStation(i, { hiddenProfile: { ...(s.hiddenProfile ?? {}), keySymptoms: v } })}
              readOnly={readOnly}
            />
            <TagListField
              label="Red flags"
              tags={s.hiddenProfile?.redFlags ?? []}
              onChange={(v) => patchStation(i, { hiddenProfile: { ...(s.hiddenProfile ?? {}), redFlags: v } })}
              readOnly={readOnly}
            />
            <TagListField
              label="Past history"
              tags={s.hiddenProfile?.pastHistory ?? []}
              onChange={(v) => patchStation(i, { hiddenProfile: { ...(s.hiddenProfile ?? {}), pastHistory: v } })}
              readOnly={readOnly}
            />
            <Field label="Vital signs">
              <Textarea
                value={s.hiddenProfile?.vitalSigns ?? ""}
                onChange={(e) => patchStation(i, { hiddenProfile: { ...(s.hiddenProfile ?? {}), vitalSigns: e.target.value } })}
                readOnly={readOnly}
                rows={2}
                placeholder="BP, HR, RR, O2 sat, Temp"
              />
            </Field>

            <SectionLabel>{t("admin.structured.rubric")}</SectionLabel>
            <TagListField
              label="Must ask"
              tags={s.rubric?.mustAsk ?? []}
              onChange={(v) => patchStation(i, { rubric: { ...(s.rubric ?? { mustAsk: [], bonus: [] }), mustAsk: v } })}
              readOnly={readOnly}
            />
            <TagListField
              label="Bonus"
              tags={s.rubric?.bonus ?? []}
              onChange={(v) => patchStation(i, { rubric: { ...(s.rubric ?? { mustAsk: [], bonus: [] }), bonus: v } })}
              readOnly={readOnly}
            />

            <SectionLabel>{t("admin.structured.questions")}</SectionLabel>
            <OsceQuestionsEditor
              questions={s.questions ?? []}
              onChange={(v) => patchStation(i, { questions: v })}
              readOnly={readOnly}
            />
          </ItemRow>
        ))
      )}
    </div>
  );
}

function OsceQuestionsEditor({
  questions,
  onChange,
  readOnly,
}: {
  questions: any[];
  onChange: (next: any[]) => void;
  readOnly?: boolean;
}) {
  function add() {
    onChange([...questions, { question: "", answer: "", rubric: "" }]);
  }
  function patch(i: number, patch: any) {
    onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function remove(i: number) {
    onChange(questions.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      {questions.map((q, i) => (
        <div key={i} className="border border-border rounded-xl p-2 space-y-2 bg-card/60">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="font-mono text-xs">Q{i + 1}</Badge>
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
          <Textarea
            value={q.question ?? ""}
            onChange={(e) => patch(i, { question: e.target.value })}
            readOnly={readOnly}
            rows={2}
            placeholder="Question"
          />
          <Textarea
            value={q.answer ?? ""}
            onChange={(e) => patch(i, { answer: e.target.value })}
            readOnly={readOnly}
            rows={2}
            placeholder="Answer"
          />
          <Textarea
            value={q.rubric ?? ""}
            onChange={(e) => patch(i, { rubric: e.target.value })}
            readOnly={readOnly}
            rows={2}
            placeholder="Rubric"
          />
        </div>
      ))}
      {!readOnly && (
        <Button size="sm" variant="ghost" onClick={add} className="text-xs">
          <Plus className="size-3 me-1" /> Add question
        </Button>
      )}
    </div>
  );
}

// ── Video editor (full schema: YouTube URL extraction, chapters, etc.) ─────

function extractYouTubeId(input: string): string {
  if (!input) return "";
  const s = String(input).trim();
  if (!s) return "";
  if (/^[a-zA-Z0-9_-]{8,32}$/.test(s)) return s;
  const short = s.match(/youtu\.be\/([a-zA-Z0-9_-]{8,32})/);
  if (short) return short[1];
  const watch = s.match(/[?&]v=([a-zA-Z0-9_-]{8,32})/);
  if (watch) return watch[1];
  const embed = s.match(/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{8,32})/);
  if (embed) return embed[1];
  const fallback = s.match(/([a-zA-Z0-9_-]{11})/);
  return fallback ? fallback[1] : "";
}

function youTubeThumb(id: string): string {
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

export function VideoEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const videos: any[] = Array.isArray(value?.videos) ? value.videos : [];

  function update(next: any[]) {
    onChange({ ...value, videos: next });
  }
  function addVideo() {
    update([
      ...videos,
      {
        id: `video-${String(Date.now()).slice(-6)}`,
        title: "",
        description: "",
        specialty: "",
        topic: "",
        duration: null,
        source: { type: "youtube", id: "" },
        instructor: "",
        tags: [],
        chapters: [],
        relatedArticles: [],
        lang: "en",
      },
    ]);
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
      <ListToolbar onAdd={addVideo} addLabel={t("admin.structured.addVideo")} readOnly={readOnly} />
      {videos.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t("admin.structured.noVideos")}</p>
      ) : (
        videos.map((v, i) => {
          const source = v.source ?? { type: "youtube", id: "" };
          const ytId = source.type === "youtube" ? source.id : "";
          return (
            <ItemRow
              key={i}
              index={i}
              total={videos.length}
              onMove={(d) => moveVideo(i, d)}
              onRemove={() => removeVideo(i)}
              readOnly={readOnly}
              title={`Video ${i + 1}: ${v.title || ""}`}
            >
              <Field label="ID">
                <Input
                  value={v.id ?? ""}
                  onChange={(e) => patchVideo(i, { id: e.target.value })}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                  placeholder="ecg-interpretation"
                />
              </Field>
              <Field label="Title">
                <Input
                  value={v.title ?? ""}
                  onChange={(e) => patchVideo(i, { title: e.target.value })}
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
              <div className="grid grid-cols-2 gap-3">
                <Field label="Specialty">
                  <Input
                    value={v.specialty ?? ""}
                    onChange={(e) => patchVideo(i, { specialty: e.target.value })}
                    readOnly={readOnly}
                    placeholder="Cardiology"
                  />
                </Field>
                <Field label="Topic">
                  <Input
                    value={v.topic ?? ""}
                    onChange={(e) => patchVideo(i, { topic: e.target.value })}
                    readOnly={readOnly}
                    placeholder="ECG Interpretation"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Instructor">
                  <Input
                    value={v.instructor ?? ""}
                    onChange={(e) => patchVideo(i, { instructor: e.target.value })}
                    readOnly={readOnly}
                    placeholder="Dr. Sarah Chen, MD"
                  />
                </Field>
                <Field label="Duration (seconds)">
                  <Input
                    type="number"
                    value={v.duration ?? ""}
                    onChange={(e) => patchVideo(i, { duration: e.target.value === "" ? null : Number(e.target.value) })}
                    readOnly={readOnly}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Language">
                  <Select
                    value={v.lang ?? "en"}
                    onValueChange={(val) => patchVideo(i, { lang: val })}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t("admin.structured.english")}</SelectItem>
                      <SelectItem value="ar">العربية</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Custom thumbnail URL (optional)">
                  <Input
                    value={v.thumbnail ?? ""}
                    onChange={(e) => patchVideo(i, { thumbnail: e.target.value })}
                    readOnly={readOnly}
                    placeholder="https://… — defaults to YouTube thumbnail"
                  />
                </Field>
              </div>

              <SectionLabel>{t("admin.structured.source")}</SectionLabel>
              <Field label="Source type">
                <Select
                  value={source.type ?? "youtube"}
                  onValueChange={(val) => {
                    const next = val === "youtube"
                      ? { type: "youtube", id: "" }
                      : { type: val, url: "" };
                    patchVideo(i, { source: next });
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="youtube">YouTube (paste any video URL or ID)</SelectItem>
                    <SelectItem value="mp4">Direct MP4 (CDN or same-origin URL)</SelectItem>
                    <SelectItem value="hls">HLS stream (.m3u8 URL)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {source.type === "youtube" ? (
                <Field label="YouTube URL or video ID">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Youtube className="size-4 text-destructive shrink-0" />
                      <Input
                        value={source.id ?? ""}
                        onChange={(e) => {
                          const extracted = extractYouTubeId(e.target.value);
                          patchVideo(i, { source: { ...source, id: extracted || e.target.value.trim() } });
                        }}
                        readOnly={readOnly}
                        placeholder="Paste https://www.youtube.com/watch?v=… OR youtu.be/… OR dQw4w9WgXcQ"
                        className="font-mono text-xs"
                      />
                    </div>
                    {ytId ? (
                      <div className="flex items-center gap-2 text-xs text-success">
                        <CheckCircle2 className="size-3.5" />
                        <span>ID: {ytId}</span>
                        <img
                          src={youTubeThumb(ytId)}
                          alt={t("admin.structured.thumbnailPreview")}
                          className="h-12 rounded border border-border"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Paste a YouTube link above — {t("admin.structured.youtubeHint")}
                      </p>
                    )}
                  </div>
                </Field>
              ) : (
                <Field label="Stream URL">
                  <Input
                    value={source.url ?? ""}
                    onChange={(e) => patchVideo(i, { source: { ...source, url: e.target.value } })}
                    readOnly={readOnly}
                    placeholder="https://cdn.example.com/video.mp4"
                    className="font-mono text-xs"
                  />
                </Field>
              )}

              <SectionLabel>{t("admin.structured.chaptersOptional")}</SectionLabel>
              <ChaptersEditor
                chapters={v.chapters ?? []}
                onChange={(c) => patchVideo(i, { chapters: c })}
                readOnly={readOnly}
              />

              <SectionLabel>{t("admin.structured.tagsRelated")}</SectionLabel>
              <TagListField
                label="Tags"
                tags={v.tags ?? []}
                onChange={(t) => patchVideo(i, { tags: t })}
                readOnly={readOnly}
              />
              <TagListField
                label="Related articles (paths under public/osler-content/library/)"
                tags={v.relatedArticles ?? []}
                onChange={(t) => patchVideo(i, { relatedArticles: t })}
                readOnly={readOnly}
                placeholder="cardiology/asthma.md"
              />
            </ItemRow>
          );
        })
      )}
    </div>
  );
}

function ChaptersEditor({
  chapters,
  onChange,
  readOnly,
}: {
  chapters: any[];
  onChange: (next: any[]) => void;
  readOnly?: boolean;
}) {
  function add() {
    const lastTime = chapters.length ? chapters[chapters.length - 1].time : 0;
    onChange([...chapters, { time: (lastTime || 0) + 60, title: "" }]);
  }
  function patch(i: number, patch: any) {
    onChange(chapters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function remove(i: number) {
    onChange(chapters.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-1.5">
      {chapters.map((c, i) => (
        <div key={i} className="grid grid-cols-[100px_1fr_auto] gap-2 items-center">
          <Input
            type="number"
            value={c.time ?? 0}
            onChange={(e) => patch(i, { time: Number(e.target.value) })}
            readOnly={readOnly}
            placeholder="seconds"
            className="text-xs"
          />
          <Input
            value={c.title ?? ""}
            onChange={(e) => patch(i, { title: e.target.value })}
            readOnly={readOnly}
            placeholder="Chapter title"
            className="text-xs"
          />
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
      ))}
      {!readOnly && (
        <Button size="sm" variant="ghost" onClick={add} className="text-xs">
          <Plus className="size-3 me-1" /> Add chapter
        </Button>
      )}
    </div>
  );
}

// ── Written editor (with children) ─────────────────────────────────────────

export function WrittenEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const prompts: any[] = Array.isArray(value?.prompts) ? value.prompts : [];

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
    <div className="space-y-3">
      <ListToolbar onAdd={addPrompt} addLabel={t("admin.structured.addPrompt")} readOnly={readOnly} />
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
            title={`Prompt ${i + 1}`}
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
            />
          </ItemRow>
        ))
      )}
    </div>
  );
}

function WrittenChildrenEditor({
  items,
  onChange,
  readOnly,
}: {
  items: any[];
  onChange: (next: any[]) => void;
  readOnly?: boolean;
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
          <Textarea
            value={c.question ?? ""}
            onChange={(e) => patch(i, { question: e.target.value })}
            readOnly={readOnly}
            rows={2}
            placeholder="Sub-question"
          />
          <Textarea
            value={c.modelAnswer ?? ""}
            onChange={(e) => patch(i, { modelAnswer: e.target.value })}
            readOnly={readOnly}
            rows={2}
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

// ── Bank editor (alias for PassagesEditor shape) ───────────────────────────

export function BankEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  return (
    <PassagesEditor value={value} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />
  );
}

// ── Library / article editor (markdown) ────────────────────────────────────

export function LibraryArticleEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  // Detect content type from value
  const rawValue = typeof value === "string" ? value : (value?.body ?? "");
  const detectedType = typeof value === "object" && value?.contentType
    ? value.contentType
    : rawValue.startsWith("data:application/pdf;")
    ? "pdf"
    : rawValue.startsWith("<") && !rawValue.startsWith("---")
    ? "html"
    : "md";

  const [contentType, setContentType] = React.useState<"md" | "pdf" | "html">(detectedType);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Store content type in the value object so content-editor.tsx can read it
  const currentBody = typeof value === "string" ? rawValue : (value?.body ?? "");

  function update(next: string, ct?: "md" | "pdf" | "html") {
    const ct2 = ct ?? contentType;
    if (typeof value === "string") {
      onChange(ct2 === "md" ? next : { body: next, contentType: ct2 });
    } else {
      onChange({ ...value, body: next, contentType: ct2 });
    }
  }

  async function handlePdfUpload(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const dataUri = `data:application/pdf;base64,${b64}`;
      setContentType("pdf");
      update(dataUri, "pdf");
      toast({ title: `Loaded ${file.name}` });
    } catch (err) {
      toast({ title: `Failed to read PDF: ${String(err)}`, variant: "destructive" });
    }
  }

  const words = contentType === "md" && currentBody.trim()
    ? currentBody.trim().split(/\s+/).length : 0;
  const chars = currentBody.length;
  const lines = currentBody.split("\n").length;

  return (
    <div className="space-y-2 h-full flex flex-col">
      {/* Content type selector */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground font-medium uppercase tracking-wider">{t("admin.content.editor.articleType")}:</span>
        {(["md", "pdf", "html"] as const).map((ct) => (
          <button
            key={ct}
            type="button"
            onClick={() => {
              haptic("selection");
              setContentType(ct);
              if (ct === "md" && typeof value === "object" && value?.body) {
                update(value.body, "md");
              } else if (ct === "html") {
                update(currentBody || "<!DOCTYPE html>\n<html>\n<head><title>Article</title></head>\n<body>\n\n</body>\n</html>", "html");
              }
            }}
            disabled={readOnly}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
              contentType === ct
                ? "bg-primary/10 text-primary border-primary/30"
                : "text-muted-foreground border-border hover:text-foreground hover:bg-muted/60"
            )}
          >
            {ct === "md" ? ".md" : ct === "pdf" ? ".pdf" : ".html"}
          </button>
        ))}
      </div>

      {contentType === "pdf" ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-muted/20 rounded-xl border-2 border-dashed border-border p-8">
          {currentBody.startsWith("data:application/pdf;base64,") ? (
            <div className="flex flex-col items-center gap-3">
              <FileText className="size-12 text-warning" />
              <p className="text-sm font-medium">PDF loaded ({Math.round(chars / 1024)} KB base64)</p>
              <div className="flex gap-2">
                {!readOnly && (
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    <Upload className="size-3.5 me-1.5" /> Replace PDF
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => window.open(currentBody, "_blank")}>
                  <Eye className="size-3.5 me-1.5" /> Preview
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <FileText className="size-12 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("admin.content.editor.pdfDropHint")}</p>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={readOnly}>
                <Upload className="size-3.5 me-1.5" /> {t("admin.content.editor.uploadPdf")}
              </Button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePdfUpload(f);
              e.target.value = "";
            }}
          />
        </div>
      ) : contentType === "html" ? (
        <div className="flex-1 flex flex-col">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <span>{chars} chars</span>
            <span>·</span>
            <span>{lines} lines</span>
          </div>
          <textarea
            value={currentBody}
            onChange={(e) => update(e.target.value, "html")}
            readOnly={readOnly}
            className="flex-1 w-full min-h-[400px] p-4 font-mono text-sm bg-background border border-border rounded-xl resize-none focus:outline-none"
            placeholder="<!DOCTYPE html>\n<html>\n<head><title>Article</title></head>\n<body>\n  ...\n</body>\n</html>"
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlignLeft className="size-3.5" />
            <span>{t("admin.content.editor.wordCount", { n: words })}</span>
            <span>·</span>
            <span>{t("admin.content.editor.charCount", { n: chars })}</span>
            <span>·</span>
            <span>{t("admin.content.editor.lineCount", { n: lines })}</span>
          </div>
          <MarkdownEditor
            value={currentBody}
            onChange={(next) => update(next, "md")}
            readOnly={readOnly}
            r2KeyBase={r2KeyBase}
            rawR2Key={rawR2Key}
            placeholder="# Article title\n\nWrite your article in **Markdown**…"
            className="flex-1 min-h-[400px]"
          />
        </>
      )}
    </div>
  );
}
