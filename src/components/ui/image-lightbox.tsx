"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const offsetStart = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    const cb = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", cb);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", cb);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(0.25, Math.min(10, s - e.deltaY * 0.005)));
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

  const handleDoubleClick = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onClick={onClose}
    >
      <div
        className="absolute top-4 left-4 flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5 text-white/70 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <span>{Math.round(scale * 100)}%</span>
        <span className="text-white/30">|</span>
        <span className="text-white/50 hidden sm:inline">Scroll to zoom &middot; Drag to pan &middot; Double-click to reset</span>
      </div>
      <button
        className="absolute top-4 right-4 size-10 flex items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors z-10"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close lightbox"
      >
        <X className="size-5" />
      </button>
      <img
        src={src} alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-75"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
        }}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </motion.div>
  );
}
