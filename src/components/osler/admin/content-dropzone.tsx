"use client";

import * as React from "react";
import { UploadCloud, FileText, FileJson, Loader2, X } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { adminApi, type ContentType } from "@/components/osler/admin/admin-api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DroppedFile {
  file: File;
  /** Resolved content type (guessed from filename/extension). */
  contentType: ContentType;
  /** Suggested title (filename without extension). */
  title: string;
  /** Suggested language ("en" or "ar") — derived from path/filename. */
  language: string;
  /** File body as text. */
  body: string;
}

interface ContentDropzoneProps {
  /** Called when files are dropped or picked. The parent decides whether to
   *  actually upload them (e.g. opening a confirm dialog per file). */
  onFiles: (files: DroppedFile[]) => void;
  /** Compact variant — smaller padding for inline use. */
  compact?: boolean;
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ContentDropzone({
  onFiles,
  compact = false,
  className,
}: ContentDropzoneProps) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    // Validate
    const valid = files.filter((f) => f.name.endsWith(".md") || f.name.endsWith(".json"));
    if (valid.length === 0) {
      toast({ title: t("admin.content.dropzone.invalid"), variant: "destructive" });
      return;
    }
    if (valid.length < files.length) {
      toast({
        title: t("admin.content.dropzone.invalid"),
        variant: "destructive",
      });
    }

    setBusy(true);
    try {
      const dropped: DroppedFile[] = [];
      for (const file of valid) {
        const body = await file.text();
        dropped.push({
          file,
          contentType: guessContentType(file.name),
          title: file.name.replace(/\.(md|json)$/i, ""),
          language: guessLanguage(file.name) ?? "en",
          body,
        });
      }
      onFiles(dropped);
    } catch (err) {
      toast({
        title: "Failed to read files",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        "admin-dropzone flex flex-col items-center justify-center text-center transition-colors cursor-pointer",
        dragActive && "admin-dropzone--active",
        compact ? "p-4 rounded-lg" : "p-8 rounded-xl",
        className,
      )}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".md,.json,.markdown"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          // reset so the same file can be picked again
          e.target.value = "";
        }}
      />

      {busy ? (
        <Loader2 className="size-6 text-primary animate-spin mb-2" />
      ) : (
        <UploadCloud
          className={cn(
            "text-primary mb-2",
            compact ? "size-5" : "size-7",
          )}
        />
      )}

      <div className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>
        {t("admin.content.dropzone.title")}
      </div>
      <div className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>
        {t("admin.content.dropzone.subtitle")}
      </div>

      {!compact && (
        <>
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <FileText className="size-3.5" />
            <span>.md</span>
            <FileJson className="size-3.5 ms-2" />
            <span>.json</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {t("admin.content.dropzone.browse")}
          </Button>
          <p className="mt-2 text-[10px] text-muted-foreground/70 max-w-xs">
            {t("admin.content.dropzone.hint")}
          </p>
        </>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function guessContentType(filename: string): ContentType {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md")) return "library";
  if (lower.includes("flashcard") || lower.includes("cards")) return "flashcard";
  if (lower.includes("osce") || lower.includes("station")) return "osce";
  if (lower.includes("video")) return "video";
  if (lower.includes("written") || lower.includes("prompt")) return "written";
  if (lower.includes("bank") || lower.includes("passage")) return "bank";
  // default for .json without hints
  return "quiz";
}

function guessLanguage(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.includes("arabic") || lower.includes("-ar") || lower.includes("/ar/") || lower.includes("ar-")) {
    return "ar";
  }
  return "en";
}

// ── Upload helper — uploads a DroppedFile as a new content object ──────────

export async function uploadDroppedFile(d: DroppedFile): Promise<string> {
  // Try to parse JSON to validate before upload
  if (d.contentType !== "library") {
    try {
      JSON.parse(d.body);
    } catch (err) {
      throw new Error(`Invalid JSON in ${d.file.name}: ${String(err)}`);
    }
  }
  const res = await adminApi.createContent({
    contentType: d.contentType,
    title: d.title,
    language: d.language,
    content: d.body,
  });
  return res.id;
}
