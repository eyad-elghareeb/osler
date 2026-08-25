"use client";

import * as React from "react";
import { AlignLeft, FileText, Upload, Eye, Tags } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { AnimatedDisclosure } from "@/components/osler/ui-primitives";
import { StructuredEditorProps, Field, TagListField, MilkdownEditor } from "./shared";

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

export function splitFrontmatter(md: string): { fields: Record<string, unknown>; body: string } {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { fields: {}, body: md };
  let end = 1;
  while (end < lines.length && lines[end]?.trim() !== "---") end++;
  if (end >= lines.length) return { fields: {}, body: md };
  const fields: Record<string, unknown> = {};
  let lastKey = "";
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      fields[lastKey] = kv[2].trim();
    } else if (lastKey && /^\s+-\s+/.test(line)) {
      if (!Array.isArray(fields[lastKey])) fields[lastKey] = [];
      (fields[lastKey] as unknown[]).push(line.replace(/^\s+-\s+/, "").trim());
    }
  }
  return { fields, body: lines.slice(end + 1).join("\n").trim() };
}

export interface ArticleMetaDraft {
  title: string;
  specialty: string;
  system: string;
  readTimeMin: string;
  tags: string[];
  lang: "en" | "ar";
}

export const EMPTY_META_DRAFT: ArticleMetaDraft = {
  title: "",
  specialty: "",
  system: "",
  readTimeMin: "",
  tags: [],
  lang: "en",
};

export function metaDraftFrom(fields: Record<string, unknown>, sidecar: Record<string, unknown> | null | undefined): ArticleMetaDraft {
  const pick = (key: string) => String(sidecar?.[key] ?? fields[key] ?? "").trim();
  const rt = sidecar?.readTimeMin ?? fields.readTimeMin;
  return {
    title: pick("title"),
    specialty: pick("specialty"),
    system: pick("system"),
    readTimeMin: Number.isFinite(Number(rt)) && Number(rt) > 0 ? String(Number(rt)) : "",
    tags: Array.isArray(sidecar?.tags)
      ? (sidecar!.tags as unknown[]).map(String)
      : Array.isArray(fields.tags)
        ? (fields.tags as unknown[]).map(String)
        : [],
    lang: pick("lang") === "ar" ? "ar" : "en",
  };
}

/** Strip empty fields so the sidecar only carries what the admin set. */
export function cleanMetaDraft(m: ArticleMetaDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { lang: m.lang };
  if (m.title.trim()) out.title = m.title.trim();
  if (m.specialty.trim()) out.specialty = m.specialty.trim();
  if (m.system.trim()) out.system = m.system.trim();
  const rt = Number(m.readTimeMin);
  if (Number.isFinite(rt) && rt > 0) out.readTimeMin = Math.round(rt);
  if (m.tags.length > 0) out.tags = m.tags;
  return out;
}

export function LibraryArticleEditor({ value, onChange, readOnly, r2KeyBase, rawR2Key, meta }: StructuredEditorProps) {
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

  // Markdown articles keep their metadata OUT of the editable surface: the
  // frontmatter block is parsed off and shown as form fields instead, merged
  // with the sidecar `.meta.json` (sidecar wins per-field).
  const fmSplit = React.useMemo(() => splitFrontmatter(rawValue), [rawValue]);
  const [metaDraft, setMetaDraft] = React.useState<ArticleMetaDraft>(() =>
    metaDraftFrom(splitFrontmatter(rawValue).fields, meta),
  );
  // Re-seed when the parent loads a different article's sidecar (the identity
  // of `meta` changes on every load; keystrokes never change it).
  React.useEffect(() => {
    setMetaDraft(metaDraftFrom(fmSplit.fields, meta));
  }, [meta]);

  function emit(nextBody: string, ct: "md" | "pdf" | "html") {
    if (ct === "md") {
      onChange({ body: nextBody, contentType: ct, meta: cleanMetaDraft(metaDraft) });
      return;
    }
    onChange({ body: nextBody, contentType: ct });
  }

  /** Patch one metadata field and re-emit with the current displayed body. */
  function patchMeta(patch: Partial<ArticleMetaDraft>) {
    const next = { ...metaDraft, ...patch };
    setMetaDraft(next);
    onChange({ body: fmSplit.body, contentType: "md", meta: cleanMetaDraft(next) });
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

  function update(next: string, ct?: "md" | "pdf" | "html") {
    const ct2 = ct ?? contentType;
    if (ct2 === "md") {
      emit(next, "md");
      return;
    }
    if (typeof value === "string") {
      onChange({ body: next, contentType: ct2 });
    } else {
      onChange({ ...value, body: next, contentType: ct2 });
    }
  }

  const words = contentType === "md" && fmSplit.body.trim()
    ? fmSplit.body.trim().split(/\s+/).length : 0;
  const chars = fmSplit.body.length;
  const lines = fmSplit.body.split("\n").length;

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

      {/* Metadata panel — markdown articles only. Edits persist through the
          same Save flow as the body, into the `.meta.json` sidecar. */}
      {contentType === "md" && (
        <AnimatedDisclosure
          icon={Tags}
          label={t("admin.content.editor.metaTitle")}
          defaultOpen={metaDraft.title === "" || !rawValue.includes("title:")}
        >
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("admin.content.editor.metaHint")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-2.5">
            <Field label={t("admin.content.editor.metaTitleField")}>
              <Input
                value={metaDraft.title}
                onChange={(e) => patchMeta({ title: e.target.value })}
                readOnly={readOnly}
                className="h-8 text-sm bg-background"
              />
            </Field>
            <Field label={t("admin.content.editor.metaSpecialty")}>
              <Input
                value={metaDraft.specialty}
                onChange={(e) => patchMeta({ specialty: e.target.value })}
                readOnly={readOnly}
                className="h-8 text-sm bg-background"
              />
            </Field>
            <Field label={t("admin.content.editor.metaSystem")}>
              <Input
                value={metaDraft.system}
                onChange={(e) => patchMeta({ system: e.target.value })}
                readOnly={readOnly}
                className="h-8 text-sm bg-background"
              />
            </Field>
            <Field label={t("admin.content.editor.metaReadTime")}>
              <Input
                type="number"
                min={1}
                value={metaDraft.readTimeMin}
                onChange={(e) => patchMeta({ readTimeMin: e.target.value })}
                readOnly={readOnly}
                className="h-8 text-sm bg-background tabular-nums"
              />
            </Field>
            <Field label={t("admin.content.language")}>
              <div className="flex items-center gap-1.5 h-8">
                {(["en", "ar"] as const).map((lg) => (
                  <button
                    key={lg}
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      haptic("selection");
                      patchMeta({ lang: lg });
                    }}
                    className={cn(
                      "px-3 h-8 rounded-lg text-xs font-medium transition-colors border",
                      metaDraft.lang === lg
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "text-muted-foreground border-border hover:text-foreground hover:bg-muted/60",
                      lg === "ar" && "font-[var(--font-cairo)]",
                    )}
                  >
                    {lg === "en" ? "English" : "العربية"}
                  </button>
                ))}
              </div>
            </Field>
            <TagListField
              label={t("admin.content.editor.metaTags")}
              tags={metaDraft.tags}
              onChange={(tags) => patchMeta({ tags })}
              readOnly={readOnly}
              placeholder={t("admin.content.editor.metaTagPlaceholder")}
            />
          </div>
        </AnimatedDisclosure>
      )}

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
          <MilkdownEditor
            value={fmSplit.body}
            onChange={(next) => update(next, "md")}
            readOnly={readOnly}
            r2KeyBase={r2KeyBase}
            rawR2Key={rawR2Key}
            placeholder={t("editor.placeholder.article")}
            className="flex-1 min-h-0"
            // Article editor is a long-form writing context — enable mermaid
            // diagrams and the persistent top formatting bar.
            enableMermaid
            enableTopBar
            showCounters
          />
        </>
      )}
    </div>
  );
}