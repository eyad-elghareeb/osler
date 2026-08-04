"use client";

/**
 * Admin image lightbox — a full-size image preview overlay used by the
 * structured editors (ImageListField thumbnails) and the content browser
 * (R2 image preview). Clicking a thumbnail opens the image at full size
 * with its filename, pixel dimensions and file size in the footer.
 *
 * Image dimensions are read from the `<img>` element when it loads, so
 * callers don't need to know them ahead of time.
 */

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { formatBytes } from "./editors/image-upload";

export interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** URL to display (worker URL, object URL, data URI…). */
  src: string;
  alt?: string;
  /** Display name shown in the footer. */
  fileName?: string;
  /** Original file size in bytes (shown in the footer when known). */
  sizeBytes?: number;
}

export function ImageLightbox({ open, onOpenChange, src, alt, fileName, sizeBytes }: ImageLightboxProps) {
  const { t } = useI18n();
  const [dims, setDims] = React.useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    if (!open) setDims(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 bg-card/60">
          <span className="text-sm font-medium truncate">{fileName ?? alt ?? t("admin.preview.image")}</span>
          <span className="ms-auto text-xs text-muted-foreground shrink-0">
            {dims ? t("admin.preview.dimensions", { w: String(dims.width), h: String(dims.height) }) : ""}
            {dims && sizeBytes != null ? " · " : ""}
            {sizeBytes != null ? formatBytes(sizeBytes) : ""}
          </span>
        </div>
        <div className="flex items-center justify-center bg-muted/30 min-h-[200px] max-h-[70vh] overflow-auto medos-scroll-y p-4">
          <img
            src={src}
            alt={alt ?? ""}
            className={cn("max-w-full max-h-[65vh] rounded-lg", !dims && "opacity-0")}
            onLoad={(e) => {
              const el = e.currentTarget;
              setDims({ width: el.naturalWidth, height: el.naturalHeight });
            }}
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              el.style.opacity = "0.3";
              el.style.background = "oklch(0.92 0 0)";
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
