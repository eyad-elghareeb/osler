"use client";

import * as React from "react";
import { UploadCloud, FileText, Loader2, FolderOpen } from "lucide-react";
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
  /** File body — UTF-8 text for text files, a `data:` URI for binary files. */
  body: string;
  /** Path relative to the dropped/picked folder root (e.g.
   *  "cardiology/images/x.png"). Set when the file came from a folder;
   *  undefined for plain file drops. */
  relativePath?: string;
}

interface ContentDropzoneProps {
  /** Called when files are dropped or picked. The parent decides whether to
   *  actually upload them (e.g. opening a confirm dialog per file). */
  onFiles: (files: DroppedFile[]) => void;
  /** Compact variant — smaller padding for inline use. */
  compact?: boolean;
  className?: string;
}

const TEXT_EXT = /\.(md|markdown|json|html?|svg|xml|css|txt)$/i;

function isTextFile(name: string): boolean {
  return TEXT_EXT.test(name);
}

/** Read a File into the body representation the upload endpoint expects:
 *  UTF-8 text for text-ish files, a base64 `data:` URI for everything else. */
function readAsUploadBody(file: File): Promise<string> {
  if (isTextFile(file.name)) {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export function ContentDropzone({
  onFiles,
  compact = false,
  className,
}: ContentDropzoneProps) {
  const { t } = useI18n();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function handleFiles(fileList: FileList | File[], relativePaths?: Map<File, string>) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    // The merged workflow accepts any file type (content + images + PDFs +
    // assets) so a whole content pack folder can be dropped as-is.
    const valid = files;

    setBusy(true);
    try {
      const dropped: DroppedFile[] = [];
      for (const file of valid) {
        const body = await readAsUploadBody(file);
        const rel = relativePaths?.get(file) ?? file.name;
        dropped.push({
          file,
          contentType: guessContentType(file.name),
          title: file.name.replace(/\.(md|json)$/i, ""),
          language: guessLanguage(file.name) ?? "en",
          body,
          relativePath: rel,
        });
      }
      onFiles(dropped);
    } catch (err) {
      toast({
        title: t("admin.toast.failedReadFiles"),
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    // Walk the drop entries so folder structure (webkitGetAsEntry) survives.
    const { files: walked, paths } = await walkDropEntries(e.dataTransfer);
    await handleFiles(walked, paths);
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

  const subtitle = t("admin.content.dropzone.subtitle");
  const hint = t("admin.content.dropzone.hint");

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        "osler-dropzone flex flex-col items-center justify-center text-center transition-colors cursor-pointer",
        dragActive && "osler-dropzone--active",
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
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          // reset so the same file can be picked again
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as any)}
        onChange={(e) => {
          if (e.target.files) {
            const paths = new Map<File, string>();
            for (const f of Array.from(e.target.files)) {
              const rel = (f as any).webkitRelativePath || "";
              if (rel) paths.set(f, rel);
            }
            handleFiles(e.target.files, paths);
          }
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
      <div className={cn("text-muted-foreground", compact ? "text-xs" : "text-xs")}>
        {subtitle}
      </div>

      {!compact && (
        <>
          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
            <FileText className="size-3.5" />
            <span>{t("admin.content.dropzone.anyFiles")}</span>
            <FolderOpen className="size-3.5 ms-2" />
            <span>{t("admin.content.dropzone.folders")}</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              {t("admin.content.dropzone.browse")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
            >
              <FolderOpen className="size-3.5 me-1.5" />
              {t("admin.content.dropzone.browseFolder")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground/70 max-w-xs">
            {hint}
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

/** Walk a DataTransfer's entries recursively, preserving folder structure.
 *  Falls back to the flat file list when webkitGetAsEntry is unavailable. */
async function walkDropEntries(
  dt: DataTransfer,
): Promise<{ files: File[]; paths: Map<File, string> }> {
  const paths = new Map<File, string>();
  const items = dt.items;
  const hasEntries = items && typeof (items as any).webkitGetAsEntry === "function";

  if (!hasEntries) {
    const files = Array.from(dt.files || []);
    return { files, paths };
  }

  const files: File[] = [];
  const queue: Array<{ entry: any; path: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = item && typeof (item as any).webkitGetAsEntry === "function"
      ? (item as any).webkitGetAsEntry()
      : null;
    if (entry) queue.push({ entry, path: entry.name || "" });
  }

  while (queue.length > 0) {
    const { entry, path } = queue.shift()!;
    if (entry.isFile) {
      const file: File | null = await new Promise((resolve) => {
        entry.file((f: File) => resolve(f), () => resolve(null));
      });
      if (file) {
        files.push(file);
        if (path) paths.set(file, path);
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries must be called repeatedly until it returns an empty array.
      let entries: any[] = [];
      let done = false;
      while (!done) {
        const batch: any[] = await new Promise((resolve, reject) => {
          reader.readEntries((res: any[]) => {
            if (!res || res.length === 0) done = true;
            resolve(res || []);
          }, reject);
        });
        entries = entries.concat(batch);
        if (done) break;
      }
      for (const child of entries) {
        queue.push({ entry: child, path: path ? `${path}/${child.name}` : child.name });
      }
    }
  }
  return { files, paths };
}

// ── Upload helper — stage a dropped file into content-staging/ ─────────────

/** Upload a file into the private staging keyspace under `destination`,
 *  preserving its relative folder path (e.g. destination "qbank/cardiology" +
 *  relative path "images/x.png" →
 *  "content-staging/qbank/cardiology/images/x.png"). Staged files are not
 *  student-visible until a "Publish" action moves them into content-files/.
 *  Returns the full R2 key that was written. */
export async function uploadStagedFile(d: DroppedFile, destination: string): Promise<string> {
  const dest = destination.replace(/^\/+|\/+$/g, "");
  const rel = (d.relativePath || d.file.name).replace(/^\/+/, "");
  // Reject traversal / absolute / backslash paths client-side so a bad
  // destination or nested folder can't smuggle a key outside content-staging/.
  const badSeg = (s: string) => s.split("/").some((seg) => seg === "..") || s.includes("\\") || s.startsWith("/");
  if (badSeg(dest) || badSeg(rel)) {
    throw new Error("Invalid path — cannot contain '..' or '\\'");
  }
  const key = `content-staging/${dest ? `${dest}/` : ""}${rel}`;

  // Validate JSON before it reaches R2 so publishing never surfaces
  // malformed content.
  if (/\.json$/i.test(key)) {
    try {
      JSON.parse(d.body);
    } catch (err) {
      throw new Error(`Invalid JSON in ${rel}: ${String(err)}`);
    }
  }

  await adminApi.uploadFile(key, d.body);
  return key;
}
