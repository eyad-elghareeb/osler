"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";

const ImageLightbox = dynamic(
  () => import("@/components/ui/image-lightbox").then((module) => ({ default: module.ImageLightbox })),
  { ssr: false, loading: () => null },
);

interface LightboxState {
  src: string;
  alt: string;
}

interface LightboxContextValue {
  openLightbox: (src: string, alt?: string) => void;
  closeLightbox: () => void;
}

const LightboxContext = React.createContext<LightboxContextValue | null>(null);

export function useLightbox(): LightboxContextValue {
  const ctx = React.useContext(LightboxContext);
  if (!ctx) {
    throw new Error("useLightbox must be used within a <LightboxProvider>");
  }
  return ctx;
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [lightbox, setLightbox] = React.useState<LightboxState | null>(null);

  const openLightbox = React.useCallback((src: string, alt = "") => {
    setLightbox({ src, alt });
  }, []);

  const closeLightbox = React.useCallback(() => {
    setLightbox(null);
  }, []);

  // Global delegation: catch img clicks not stopped by component handlers
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target instanceof HTMLImageElement ? e.target : null;
      if (!target) return;
      if (e.defaultPrevented) return;
      // Images inside links/buttons belong to that control. Opening a lightbox
      // from the document-level fallback would hijack navigation and taps on
      // image-backed cards, thumbnails, and upload controls.
      if (target.closest("a, button, [role=\"button\"], [data-lightbox=\"false\"]")) return;
      if (target.width < 64 && target.height < 64) return;
      openLightbox(target.src, target.alt);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openLightbox]);

  return (
    <LightboxContext value={{ openLightbox, closeLightbox }}>
      {children}
      <AnimatePresence>
        {lightbox && (
          <ImageLightbox
            src={lightbox.src}
            alt={lightbox.alt}
            onClose={closeLightbox}
          />
        )}
      </AnimatePresence>
    </LightboxContext>
  );
}
