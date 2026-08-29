"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ZoomIn, ZoomOut, Download, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "./i18n-provider";
import { haptic } from "@/lib/osler/native";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

interface MermaidModalProps {
  svg: string;
  title?: string;
  onClose: () => void;
}

export function MermaidModal({ svg, title, onClose }: MermaidModalProps) {
  const { t } = useI18n();
  const [scale, setScale] = React.useState(1);
  const [isPanning, setIsPanning] = React.useState(false);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const panStartRef = React.useRef<{ mouseX: number; mouseY: number; offX: number; offY: number } | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);

  // Close on Escape — capture phase + stopPropagation so the reader/modal
  // underneath (which also listens on window) doesn't close with it.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // Wheel zoom — a native non-passive listener, because React's delegated
  // `onWheel` is passive and its preventDefault() would be ignored.
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(5, Math.max(0.3, s - e.deltaY * 0.001)));
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  // Mouse pan
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, offX: offset.x, offY: offset.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || !panStartRef.current) return;
    setOffset({
      x: panStartRef.current.offX + (e.clientX - panStartRef.current.mouseX),
      y: panStartRef.current.offY + (e.clientY - panStartRef.current.mouseY),
    });
  };
  const onMouseUp = () => setIsPanning(false);

  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  const downloadSvg = () => {
    haptic("light");
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title ?? "diagram"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const zoomIn = () => { haptic("selection"); setScale((s) => Math.min(5, s + 0.25)); };
  const zoomOut = () => { haptic("selection"); setScale((s) => Math.max(0.3, s - 0.25)); };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={MOTION_TRANSITION.quick}
      className="fixed inset-0 z-[80] flex flex-col bg-background/95 backdrop-blur-xl safe-screen"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-border bg-card/60 backdrop-blur-sm safe-pt">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Maximize2 className="size-4 text-primary shrink-0" />
          {title && (
            <span className="text-sm font-medium truncate text-foreground">{title}</span>
          )}
          <span className="text-xs text-muted-foreground ms-1">
            {t("library.mermaidZoom", { n: Math.round(scale * 100) })}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.3}
            className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
            title="Zoom out"
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            onClick={resetView}
            className="text-xs font-mono tabular-nums px-2 h-9 rounded-lg hover:bg-muted text-muted-foreground min-w-[3rem]"
            title="Reset view"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={zoomIn}
            disabled={scale >= 5}
            className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
            title="Zoom in"
          >
            <ZoomIn className="size-4" />
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          <button
            onClick={downloadSvg}
            className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t("library.mermaidDownload")}
          >
            <Download className="size-4" />
          </button>

          <button
            onClick={() => { haptic("selection"); onClose(); }}
            className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t("common.close")}
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={cn(
          "flex-1 overflow-hidden relative select-none",
          isPanning ? "cursor-grabbing" : "cursor-grab"
        )}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: isPanning ? "none" : "transform 0.12s ease-out",
          }}
        >
          <div
            className="osler-mermaid-svg bg-card/80 border border-border rounded-2xl shadow-2xl p-6 max-w-[90vw] max-h-[80vh] overflow-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>

      {/* Footer hint */}
      <div className="shrink-0 h-9 flex items-center justify-center safe-pb">
        <p className="text-[11px] text-muted-foreground/50">
          Scroll to zoom · Drag to pan · Press Esc to close
        </p>
      </div>
    </motion.div>
  );
}
