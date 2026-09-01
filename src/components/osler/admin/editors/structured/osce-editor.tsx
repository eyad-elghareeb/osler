"use client";

import * as React from "react";
import { Plus, Trash2, ImagePlus, Eye, Loader2, X } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ImageLightbox } from "@/components/osler/admin/image-lightbox";
import { uploadImageForEditor, resolveImageForPreview, isImageFile, formatBytes } from "@/components/osler/admin/editors/image-upload";
import { StructuredEditorProps, Field, SectionLabel, ListToolbar, arrayMove, ItemRow, TagListField, MilkdownEditor } from "./shared";

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

export function OsceEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key }: StructuredEditorProps) {
  const { t } = useI18n();
  const dndScope = React.useId();
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
            dragScope={dndScope}
            onDragReorder={(from, to) => update(arrayMove(stations, from, to))}
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
                  onValueChange={(v) =>
                    patchStation(i, {
                      type: v,
                      dataPresented:
                        v === "data-interp" ? s.dataPresented ?? {} : s.dataPresented,
                    })
                  }
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
              <MilkdownEditor
  value={s.task ?? ""}
  onChange={(v) => patchStation(i, { task: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
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
              <MilkdownEditor
  value={s.patient?.opening ?? ""}
  onChange={(v) => patchStation(i, { patient: { ...(s.patient ?? {}), opening: v } })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
  placeholder="Patient's first line"
/>
            </Field>

            {s.type === "data-interp" && (
              <>
                <SectionLabel>{t("admin.structured.dataPresented")}</SectionLabel>
                <Field label={t("admin.structured.dataScenario")}>
                  <MilkdownEditor
                    value={s.dataPresented?.scenario ?? ""}
                    onChange={(v) =>
                      patchStation(i, { dataPresented: { ...(s.dataPresented ?? {}), scenario: v } })
                    }
                    readOnly={readOnly}
                    r2KeyBase={r2KeyBase}
                    rawR2Key={rawR2Key}
                    className="min-h-[120px]"
                    placeholder="The student is handed this clinical vignette…"
                  />
                </Field>
                <DataTablesField
                  tables={s.dataPresented?.tables ?? []}
                  onChange={(v) =>
                    patchStation(i, { dataPresented: { ...(s.dataPresented ?? {}), tables: v } })
                  }
                  readOnly={readOnly}
                />
                <DataImagesField
                  images={s.dataPresented?.images ?? []}
                  onChange={(v) =>
                    patchStation(i, { dataPresented: { ...(s.dataPresented ?? {}), images: v } })
                  }
                  readOnly={readOnly}
                  r2KeyBase={r2KeyBase}
                  rawR2Key={rawR2Key}
                />
              </>
            )}

            <SectionLabel>{t("admin.structured.hiddenProfile")}</SectionLabel>
            <Field label="Diagnosis">
              <MilkdownEditor
  value={s.hiddenProfile?.diagnosis ?? ""}
  onChange={(v) => patchStation(i, { hiddenProfile: { ...(s.hiddenProfile ?? {}), diagnosis: v } })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
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
              <MilkdownEditor
  value={s.hiddenProfile?.vitalSigns ?? ""}
  onChange={(v) => patchStation(i, { hiddenProfile: { ...(s.hiddenProfile ?? {}), vitalSigns: v } })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
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
              r2KeyBase={r2KeyBase}
              rawR2Key={rawR2Key}
            />
          </ItemRow>
        ))
      )}
    </div>
  );
}

export function OsceQuestionsEditor({
  questions,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
}: {
  questions: any[];
  onChange: (next: any[]) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
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
          <MilkdownEditor
  value={q.question ?? ""}
  onChange={(v) => patch(i, { question: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
  placeholder="Question"
/>
          <MilkdownEditor
  value={q.answer ?? ""}
  onChange={(v) => patch(i, { answer: v })}
  readOnly={readOnly}
  r2KeyBase={r2KeyBase}
  rawR2Key={rawR2Key}
  className="min-h-[120px]"
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

// ── Data-interpretation "Data presented" editors ──────────────────────────

export function DataTablesField({
  tables,
  onChange,
  readOnly,
}: {
  tables: any[];
  onChange: (next: any[]) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const list: any[] = Array.isArray(tables) ? tables : [];

  function patch(i: number, patch: any) {
    onChange(list.map((tb, idx) => (idx === i ? { ...tb, ...patch } : tb)));
  }
  function addTable() {
    onChange([...list, { title: "", headers: ["Result", "Value"], rows: [["", ""]] }]);
  }
  function removeTable(i: number) {
    onChange(list.filter((_, idx) => idx !== i));
  }
  function addRow(i: number) {
    const n = Math.max(1, (list[i]?.headers || []).length);
    patch(i, { rows: [...(list[i]?.rows || []), Array.from({ length: n }, () => "")] });
  }
  function removeRow(i: number, ri: number) {
    patch(i, { rows: (list[i]?.rows || []).filter((_: any, idx: number) => idx !== ri) });
  }

  return (
    <div className="space-y-2">
      {list.map((tb, i) => (
        <div key={i} className="border border-border rounded-xl p-2 space-y-2 bg-card/60">
          <div className="flex items-center justify-between gap-2">
            <Input
              value={tb.title ?? ""}
              onChange={(e) => patch(i, { title: e.target.value })}
              readOnly={readOnly}
              placeholder={t("admin.structured.dataTableTitle")}
              className="text-xs"
            />
            {!readOnly && (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => removeTable(i)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
          <TagListField
            label={t("admin.structured.dataHeaders")}
            tags={tb.headers ?? []}
            onChange={(v) => patch(i, { headers: v })}
            readOnly={readOnly}
          />
          {(tb.rows || []).map((row: string[], ri: number) => (
            <div key={ri} className="flex items-center gap-1.5">
              {row.map((cell, ci) => (
                <Input
                  key={ci}
                  value={cell ?? ""}
                  onChange={(e) =>
                    patch(i, {
                      rows: (tb.rows || []).map((r: string[], ridx: number) =>
                        ridx === ri ? r.map((c, cidx) => (cidx === ci ? e.target.value : c)) : r
                      ),
                    })
                  }
                  readOnly={readOnly}
                  className="text-xs flex-1 min-w-0"
                />
              ))}
              {!readOnly && (
                <Button
                  size="iconSm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => removeRow(i, ri)}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => addRow(i)} className="text-xs">
                <Plus className="size-3 me-1" /> {t("admin.structured.addRow")}
              </Button>
            </div>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button size="sm" variant="ghost" onClick={addTable} className="text-xs">
          <Plus className="size-3 me-1" /> {t("admin.structured.addTable")}
        </Button>
      )}
    </div>
  );
}

export function DataImagesField({
  images,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
}: {
  images: any;
  onChange: (next: any) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const arr: Array<{ title?: string; caption?: string; alt?: string; src?: string }> = React.useMemo(() => {
    if (!images) return [];
    if (Array.isArray(images)) return images.map((im: any) => ({ ...im }));
    if (typeof images === "object") return [{ ...images }];
    return [];
  }, [images]);

  function commit(next: Array<{ title?: string; caption?: string; alt?: string; src?: string }>) {
    if (next.length === 0) onChange(undefined);
    else if (next.length === 1) onChange(next[0]);
    else onChange(next);
  }
  function patchField(i: number, field: string, v: string) {
    commit(arr.map((im, idx) => (idx === i ? { ...im, [field]: v } : im)));
  }

  const [previewIdx, setPreviewIdx] = React.useState<number | null>(null);
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
      commit([...arr, { src: result.ref, title: file.name.replace(/\.[^.]+$/, ""), alt: file.name.replace(/\.[^.]+$/, "") }]);
      toast({
        title: result.converted
          ? t("admin.markdown.optimized", {
              before: formatBytes(result.originalBytes),
              after: formatBytes(result.optimizedBytes),
            })
          : t("admin.markdown.uploaded", { name: file.name }),
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
    const imgs = Array.from(files).filter(isImageFile);
    if (imgs.length === 0) {
      toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
      return;
    }
    for (const f of imgs) await handleUpload(f);
  }

  return (
    <Field label={t("admin.structured.dataImages")} hint={canUpload ? t("admin.structured.dropOrPasteHint") : undefined}>
      <div
        className={cn(
          "space-y-1.5 relative rounded transition-colors",
          dragActive && "ring-2 ring-inset ring-primary/60 bg-primary/5"
        )}
        onDrop={(e) => {
          if (readOnly || !e.dataTransfer?.files?.length) return;
          if (!Array.from(e.dataTransfer.files).some(isImageFile)) return;
          e.preventDefault();
          setDragActive(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => {
          if (readOnly || !e.dataTransfer) return;
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragActive(false);
        }}
        onPaste={(e) => {
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
        }}
      >
        {arr.map((img, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-start">
            <Input
              value={img.title ?? ""}
              onChange={(e) => patchField(i, "title", e.target.value)}
              readOnly={readOnly}
              placeholder={t("admin.structured.imageTitle")}
              className="text-xs"
            />
            <Input
              value={img.src ?? ""}
              onChange={(e) => patchField(i, "src", e.target.value)}
              readOnly={readOnly}
              placeholder="ecg.png or images/ecg.png"
              className="text-xs font-mono"
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
            <Input
              value={img.caption ?? ""}
              onChange={(e) => patchField(i, "caption", e.target.value)}
              readOnly={readOnly}
              placeholder={t("admin.structured.imageCaption")}
              className="text-xs"
            />
            <Input
              value={img.alt ?? ""}
              onChange={(e) => patchField(i, "alt", e.target.value)}
              readOnly={readOnly}
              placeholder={t("admin.structured.imageAlt")}
              className="text-xs"
            />
            <span />
            {img.src && (
              <div className="col-span-3 -mt-1 mb-1">
                <button
                  type="button"
                  onClick={() => setPreviewIdx(i)}
                  disabled={readOnly}
                  className="group relative block h-20 w-full overflow-hidden rounded-xl border border-border bg-muted/40"
                  aria-label={t("admin.preview.previewImage")}
                  title={t("admin.preview.previewImage")}
                >
                  <img
                    src={resolveImageForPreview(img.src, { r2KeyBase, rawR2Key })}
                    alt={img.alt ?? ""}
                    className="h-full w-full object-contain transition-transform group-hover:scale-105"
                    onError={(e) => {
                      const el = e.currentTarget as HTMLImageElement;
                      el.style.opacity = "0.3";
                      el.style.background = "var(--muted)";
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-primary/0 text-primary opacity-0 transition-opacity group-hover:bg-primary/10 group-hover:opacity-100">
                    <Eye className="size-5" />
                  </span>
                </button>
              </div>
            )}
          </div>
        ))}
        {!readOnly && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <Button size="sm" variant="ghost" onClick={() => commit([...arr, { title: "", src: "" }])} className="text-xs">
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

      {previewIdx != null && arr[previewIdx]?.src && (
        <ImageLightbox
          open={previewIdx != null}
          onOpenChange={(open) => { if (!open) setPreviewIdx(null); }}
          src={resolveImageForPreview(arr[previewIdx].src, { r2KeyBase, rawR2Key })}
          alt={arr[previewIdx].alt}
          fileName={arr[previewIdx].src.split("/").pop()}
        />
      )}
    </Field>
  );
}

// ── Video editor (full schema: YouTube URL extraction, chapters, etc.) ─────
