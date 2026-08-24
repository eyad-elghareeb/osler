"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/**
 * ImageLightbox — full-screen image viewer with zoom + pan.
 *
 * Desktop: scroll-to-zoom, drag-to-pan (when zoomed in), double-click to reset.
 * Mobile: pinch-to-zoom, drag-to-pan (one finger when zoomed), double-tap to
 *         toggle zoom, dedicated zoom buttons. Safe-area aware so the close
 *         button clears the notch / home indicator.
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  // Drag state (mouse + single-touch pan)
  const [dragging, setDragging] = React.useState(false);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const offsetStart = React.useRef({ x: 0, y: 0 });

  // Pinch state (two-finger touch)
  const pinchStart = React.useRef<{ dist: number; scale: number } | null>(null);
  const lastTapRef = React.useRef(0);

  React.useEffect(() => {
    const cb = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", cb);
    document.body.style.overflow = "hidden";
    // Also prevent touch scroll behind the modal on iOS
    document.body.style.position = "fixed";
    document.body.style.inset = "0";
    return () => {
      window.removeEventListener("keydown", cb);
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.inset = "";
    };
  }, [onClose]);

  const clampScale = (s: number) => Math.max(0.25, Math.min(10, s));

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => clampScale(s - e.deltaY * 0.005));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (scale <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({
      x: offsetStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetStart.current.y + (e.clientY - dragStart.current.y),
    });
  };

  const handleMouseUp = () => setDragging(false);

  const handleDoubleClick = () => {
    if (scale > 1) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  };

  // ── Touch handlers for pinch + pan + double-tap ──────────────────────
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Begin pinch
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStart.current = { dist: Math.hypot(dx, dy), scale };
      setDragging(false);
    } else if (e.touches.length === 1) {
      // Begin pan (only if zoomed in)
      if (scale > 1) {
        setDragging(true);
        dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        offsetStart.current = { ...offset };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchStart.current.dist;
      setScale(clampScale(pinchStart.current.scale * ratio));
      // Re-center offset when pinching so the zoom focal point stays mid
      setOffset({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && dragging) {
      setOffset({
        x: offsetStart.current.x + (e.touches[0].clientX - dragStart.current.x),
        y: offsetStart.current.y + (e.touches[0].clientY - dragStart.current.y),
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      pinchStart.current = null;
      setDragging(false);
    }
  };

  const handleTouchTap = () => {
    // Detect double-tap on touch devices
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap: toggle zoom
      if (scale > 1) {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      } else {
        setScale(2.5);
      }
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  const zoomIn = () => setScale((s) => clampScale(s + 0.5));
  const zoomOut = () => {
    setScale((s) => {
      const next = clampScale(s - 0.5);
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };
  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={MOTION_TRANSITION.fast}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 select-none"
      style={{ touchAction: "none" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={(e) => {
        // On touch devices a "click" fires after touchend — use it for tap-to-close
        // when the image isn't zoomed in. Don't close if the tap was on a control.
        if (e.target === e.currentTarget && scale <= 1) onClose();
      }}
    >
      {/* Zoom level indicator — top-start, safe-area aware */}
      <div
        className="absolute flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5 text-white/70 text-xs pointer-events-none"
        style={{
          top: "max(env(safe-area-inset-top, 0px), 1rem)",
          left: "max(env(safe-area-inset-left, 0px), 1rem)",
        }}
      >
        <span>{Math.round(scale * 100)}%</span>
        <span className="text-white/30 hidden sm:inline">|</span>
        <span className="text-white/50 hidden sm:inline">
          Scroll to zoom · Drag to pan · Double-click to reset
        </span>
        <span className="text-white/50 sm:hidden">Pinch to zoom · double-tap to reset</span>
      </div>

      {/* Close button — top-end, safe-area aware, larger on touch */}
      <button
        className="absolute size-11 sm:size-10 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 hover:text-white transition-colors z-10 osler-touch-target"
        style={{
          top: "max(env(safe-area-inset-top, 0px), 1rem)",
          right: "max(env(safe-area-inset-right, 0px), 1rem)",
        }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close lightbox"
      >
        <X className="size-5" />
      </button>

      {/* Zoom controls — bottom-center, safe-area aware, always visible on touch */}
      <div
        className="absolute flex items-center gap-1.5 z-10"
        style={{
          bottom: "max(env(safe-area-inset-bottom, 0px), 1rem)",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); zoomOut(); }}
          className="size-10 sm:size-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 transition-colors osler-touch-target"
          aria-label="Zoom out"
        >
          <ZoomOut className="size-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); resetZoom(); }}
          className="px-3 h-10 sm:h-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 transition-colors text-xs font-medium tabular-nums osler-touch-target"
          aria-label="Reset zoom"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); zoomIn(); }}
          className="size-10 sm:size-9 flex items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 transition-colors osler-touch-target"
          aria-label="Zoom in"
        >
          <ZoomIn className="size-4" />
        </button>
      </div>

      <img
        src={src}
        alt={alt}
        className="max-w-[95vw] max-h-[95dvh] object-contain transition-transform duration-75"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          touchAction: "none",
        }}
        onClick={(e) => {
          e.stopPropagation();
          // Handle tap on the image itself for double-tap detection
          handleTouchTap();
        }}
        draggable={false}
      />
    </motion.div>
  );
}
