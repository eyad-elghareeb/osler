"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { ImageLightbox } from "@/components/ui/image-lightbox";

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
