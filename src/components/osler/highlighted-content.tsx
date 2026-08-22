"use client";

import * as React from "react";
import { applyHighlightsToHtml, applyHighlightsToText } from "@/lib/osler/article-highlights";
import type { HighlightItem } from "@/lib/osler/storage";
import { useOslerTheme } from "@/components/osler/theme-provider";

interface HighlightedContentProps {
  html?: string;
  text?: string;
  highlights: HighlightItem[];
  /** Only paint highlights recorded against this region (QBank stem /
   *  choice-N / explanation scoping — see storage.highlights). */
  target?: string;
  onHighlightClick?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

const HL_DATA_ATTR = "data-osler-hl-id";

export const HighlightedContent = React.memo(function HighlightedContent({
  html,
  text,
  highlights,
  target,
  onHighlightClick,
  className = "",
  style,
}: HighlightedContentProps) {
  const { theme } = useOslerTheme();

  const processedHtml = React.useMemo(() => {
    if (typeof document === "undefined") return html ?? escapeHtmlSimple(text ?? "");
    if (html) {
      return applyHighlightsToHtml(html, highlights as any, target);
    }
    if (text) {
      return applyHighlightsToText(text, highlights as any, target);
    }
    return "";
  }, [html, text, highlights, target, theme]);

  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !onHighlightClick) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const span = target.closest(`[${HL_DATA_ATTR}]`) as HTMLElement | null;
      if (span) {
        const id = span.getAttribute(HL_DATA_ATTR);
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          onHighlightClick(id);
        }
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [onHighlightClick, processedHtml]);

  return (
    <div
      ref={ref}
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
});

function escapeHtmlSimple(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
