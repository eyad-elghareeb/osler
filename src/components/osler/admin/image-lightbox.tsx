"use client";

/**
 * Admin image lightbox — a full-size image preview overlay used by the
 * structured editors (ImageListField thumbnails) and the content browser
 * (R2 image preview). Clicking a thumbnail opens the image at full size
 * with its filename, pixel dimensions and file size in the footer.
 *
 * Image dimensions are read from the `<img>` element when it loads, so
 * callers don't need to know them ahead of time.
 *
 * Zoom/pan (Kibo UI "Image Zoom" pattern — see design-library-roadmap.md
 * § "Next-wave candidate additions") was added on top of the existing
 * fit-to-container preview rather than as a second, competing lightbox:
 * fit-to-container alone isn't enough to inspect fine detail on dense
 * clinical figures during content review, which was the actual gap. Wheel
 * scroll, pinch (two-pointer), double-click/double-tap, and +/-/0 keys
 * all zoom; dragging pans once zoomed past 1x.
 */

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { formatBytes } from "./editors/image-upload";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

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

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function ImageLightbox({ open, onOpenChange, src, alt, fileName, sizeBytes }: ImageLightboxProps) {
  const { t } = useI18n();
  const [dims, setDims] = React.useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement>(null);
  // Active pointers, for pinch-to-zoom (two-pointer distance tracking —
  // Pointer Events unify mouse + touch, so this covers both).
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const pinchStartDistRef = React.useRef(0);
  const pinchStartScaleRef = React.useRef(1);
  const panStartRef = React.useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const resetView = React.useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  React.useEffect(() => {
    if (!open) {
      setDims(null);
      resetView();
      pointersRef.current.clear();
    }
  }, [open, resetView]);

  const zoomBy = (delta: number, origin?: { x: number; y: number }) => {
    setScale((prev) => {
      const next = clampScale(prev + delta);
      // Keep the point under the cursor/pinch-center stable while zooming,
      // rather than always zooming from the image's own center.
      if (origin && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const cx = origin.x - rect.left - rect.width / 2;
        const cy = origin.y - rect.top - rect.height / 2;
        const ratio = next / prev - 1;
        setPan((p) => ({ x: p.x - cx * ratio, y: p.y - cy * ratio }));
      }
      if (next === MIN_SCALE) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(-e.deltaY * 0.0025, { x: e.clientX, y: e.clientY });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (scale > MIN_SCALE) {
      resetView();
    } else {
      zoomBy(DOUBLE_TAP_SCALE - MIN_SCALE, { x: e.clientX, y: e.clientY });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchStartDistRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScaleRef.current = scale;
    } else if (pointersRef.current.size === 1 && scale > MIN_SCALE) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      // Pinch zoom
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDistRef.current > 0) {
        const next = clampScale(pinchStartScaleRef.current * (dist / pinchStartDistRef.current));
        setScale(next);
        if (next === MIN_SCALE) setPan({ x: 0, y: 0 });
      }
    } else if (isPanning && scale > MIN_SCALE) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchStartDistRef.current = 0;
    if (pointersRef.current.size === 0) setIsPanning(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") zoomBy(0.4);
    else if (e.key === "-") zoomBy(-0.4);
    else if (e.key === "0") resetView();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden gap-0" onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 bg-card/60">
          <span className="text-sm font-medium truncate">{fileName ?? alt ?? t("admin.preview.image")}</span>
          <span className="ms-auto text-xs text-muted-foreground shrink-0">
            {dims ? t("admin.preview.dimensions", { w: String(dims.width), h: String(dims.height) }) : ""}
            {dims && sizeBytes != null ? " · " : ""}
            {sizeBytes != null ? formatBytes(sizeBytes) : ""}
          </span>
          <div className="flex items-center gap-0.5 shrink-0 border-s border-border ps-2 ms-1">
            <button
              type="button"
              onClick={() => zoomBy(-0.4)}
              disabled={scale <= MIN_SCALE}
              title={t("admin.preview.zoomOut")}
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="text-[11px] tabular-nums text-muted-foreground w-9 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomBy(0.4)}
              disabled={scale >= MAX_SCALE}
              title={t("admin.preview.zoomIn")}
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={resetView}
              disabled={scale === MIN_SCALE}
              title={t("admin.preview.zoomReset")}
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>
        <div
          ref={containerRef}
          className="flex items-center justify-center bg-muted/30 min-h-[200px] max-h-[70vh] overflow-hidden p-4 touch-none"
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          style={{ cursor: scale > MIN_SCALE ? (isPanning ? "grabbing" : "grab") : "zoom-in" }}
        >
          <img
            src={src}
            alt={alt ?? ""}
            className={cn("max-w-full max-h-[65vh] rounded-lg select-none", !dims && "opacity-0")}
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transition: isPanning ? "none" : "transform 0.15s ease-out",
            }}
            onLoad={(e) => {
              const el = e.currentTarget;
              setDims({ width: el.naturalWidth, height: el.naturalHeight });
            }}
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              el.style.opacity = "0.3";
              el.style.background = "var(--muted)";
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

