"use client";

import * as React from "react";
import {
  type ArticleSource,
  type ArticleHighlightItem,
  HL_CLASS,
} from "@/lib/osler/article-highlights";
import {
  HIGHLIGHT_COLOR_KEYS,
  ERASER_TOOL,
  resolveHighlightColor,
} from "@/lib/osler/highlight-palette";
import { useOslerTheme } from "@/components/osler/theme-provider";
import { articleHighlights } from "@/lib/osler/storage";

interface UseArticleHighlighterOptions {
  source: ArticleSource;
  articleId: string | number | null;
  enabled?: boolean;
}

export interface UseArticleHighlighterReturn {
  /** null = off, "eraser" = erase tool, otherwise a color key */
  tool: string | null;
  setTool: (t: string | null) => void;
  /** currently selected color key */
  color: string;
  setColor: (c: string) => void;
  highlightMode: boolean;
  setHighlightMode: (v: boolean) => void;
  highlightColor: string;
  setHighlightColor: (c: string) => void;
  highlights: ArticleHighlightItem[];
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  refresh: () => void;
  onColorPick: (color?: string) => void;
  onAdd: (text: string, color: string, ranges?: ArticleHighlightItem["ranges"]) => void;
  onRemove: (id: string) => void;
  clearAll: () => void;
}

const HL_DATA_ATTR = "data-osler-hl-id";

export function useArticleHighlighter(
  opts: UseArticleHighlighterOptions
): UseArticleHighlighterReturn {
  const { source: _source, articleId, enabled = true } = opts;
  const { theme } = useOslerTheme();

  const [tool, setTool] = React.useState<string | null>(null);
  const [color, setColor] = React.useState<string>(HIGHLIGHT_COLOR_KEYS[0]);
  const [highlights, setHighlights] = React.useState<ArticleHighlightItem[]>([]);

  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const attachedRef = React.useRef<HTMLDocument | null>(null);
  const loadIdRef = React.useRef(0);

  const toolRef = React.useRef(tool);
  toolRef.current = tool;
  const colorRef = React.useRef(color);
  colorRef.current = color;
  const articleIdRef = React.useRef(articleId);
  articleIdRef.current = articleId;

  React.useEffect(() => {
    if (articleId == null) {
      setHighlights([]);
      return;
    }
    const myLoadId = ++loadIdRef.current;
    const aid = String(articleId);
    setHighlights(articleHighlights.get(aid));
    if (myLoadId !== loadIdRef.current) return;
  }, [articleId]);

  const applyHighlightsToIframe = React.useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc || !doc.body) return;

    const cssId = "osler-hl-style";
    if (!doc.getElementById(cssId)) {
      const style = doc.createElement("style");
      style.id = cssId;
      style.textContent = `
        .${HL_CLASS} {
          border-radius: 3px;
          padding: 0 1px;
          cursor: pointer;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
          transition: filter 0.15s, box-shadow 0.15s;
        }
        .${HL_CLASS}:hover { filter: brightness(0.92); }
        .osler-hl-eraser .${HL_CLASS} {
          box-shadow: 0 0 0 1.5px color-mix(in oklch, currentColor 35%, transparent);
        }
      `;
      doc.head.appendChild(style);
    }

    const existing = doc.querySelectorAll(`.${HL_CLASS}`);
    existing.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });

    if (!highlights.length) return;

    const collect = (): { node: Text; start: number; end: number }[] => {
      const nodes: { node: Text; start: number; end: number }[] = [];
      let offset = 0;
      const filter: NodeFilter = {
        acceptNode: (n: Node) => {
          const p = n.parentElement;
          if (p && (p.tagName === "SCRIPT" || p.tagName === "STYLE")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      };
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, filter);
      while (walker.nextNode()) {
        const n = walker.currentNode as Text;
        const len = n.textContent?.length ?? 0;
        nodes.push({ node: n, start: offset, end: offset + len });
        offset += len;
      }
      return nodes;
    };

    let textNodes = collect();
    const fullText = textNodes.map((n) => n.node.textContent ?? "").join("");

    const resolved: { start: number; end: number; color: string; id: string }[] = [];
    for (const hl of highlights) {
      const rng = hl.ranges?.[0];
      let s = -1, e = -1;
      if (rng && typeof rng.start === "number" && typeof rng.end === "number" && rng.end > rng.start) {
        const sliced = fullText.slice(rng.start, rng.end);
        if (sliced === hl.text) { s = rng.start; e = rng.end; }
      }
      if (s < 0) {
        const needle = hl.text.toLowerCase();
        if (!needle) continue;
        const idx = fullText.toLowerCase().indexOf(needle);
        if (idx < 0) continue;
        s = idx; e = idx + hl.text.length;
      }
      resolved.push({ start: s, end: e, color: hl.color, id: hl.id });
    }

    resolved.sort((a, b) => b.start - a.start);
    for (const hl of resolved) {
      textNodes = collect();
      for (let i = textNodes.length - 1; i >= 0; i--) {
        const n = textNodes[i];
        const oStart = Math.max(hl.start, n.start);
        const oEnd = Math.min(hl.end, n.end);
        if (oStart >= oEnd) continue;
        const rng = doc.createRange();
        rng.setStart(n.node, oStart - n.start);
        rng.setEnd(n.node, oEnd - n.start);
        const span = doc.createElement("span");
        span.className = HL_CLASS;
        span.style.backgroundColor = resolveHighlightColor(hl.color);
        span.setAttribute(HL_DATA_ATTR, hl.id);
        try { rng.surroundContents(span); } catch {
          const frag = rng.extractContents();
          span.appendChild(frag);
          rng.insertNode(span);
        }
      }
    }

    doc.body.classList.toggle("osler-hl-eraser", toolRef.current === ERASER_TOOL);

    doc.querySelectorAll(`.${HL_CLASS}`).forEach((span) => {
      (span as HTMLElement).addEventListener("click", (e) => {
        if (toolRef.current !== ERASER_TOOL) return;
        e.preventDefault();
        e.stopPropagation();
        const id = (span as HTMLElement).getAttribute(HL_DATA_ATTR);
        if (id) onRemoveRef.current?.(id);
      });
    });
  }, [highlights, theme]);

  const onRemoveRef = React.useRef<(id: string) => void>(() => {});
  const onRemove = React.useCallback((id: string) => {
    if (articleId == null) return;
    const aid = String(articleId);
    setHighlights((prev) => {
      const next = prev.filter((h) => h.id !== id);
      articleHighlights.save(aid, next);
      return next;
    });
  }, [articleId]);
  onRemoveRef.current = onRemove;

  const onAdd = React.useCallback((text: string, color: string, ranges?: ArticleHighlightItem["ranges"]) => {
    if (articleId == null) return;
    const aid = String(articleId);
    const newItem: ArticleHighlightItem = {
      id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      color,
      text,
      target: "body",
      ranges: ranges ?? [],
      createdAt: new Date().toISOString(),
    };
    setHighlights((prev) => {
      const next = [...prev, newItem];
      articleHighlights.save(aid, next);
      return next;
    });
  }, [articleId]);

  const attachIframeListeners = React.useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    if (attachedRef.current === doc) return;
    attachedRef.current = doc;

    const applySelection = () => {
      const t = toolRef.current;
      if (!t || t === ERASER_TOOL) return;
      const aid = articleIdRef.current;
      if (aid == null) return;

      const sel = doc.getSelection?.();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0).cloneRange();
      const text = range.toString().trim();
      if (!text) return;

      let absStart = -1, absEnd = -1;
      try {
        const startRange = range.cloneRange();
        startRange.collapse(true);
        const headRange = doc.createRange();
        headRange.selectNodeContents(doc.body);
        headRange.setEnd(startRange.startContainer, startRange.startOffset);
        absStart = headRange.toString().length;
        absEnd = absStart + text.length;
      } catch {}

      const c = t;
      const ranges = absStart >= 0 ? [{ start: absStart, end: absEnd }] : [];

      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: ArticleHighlightItem = {
        id: tempId,
        color: c,
        text,
        target: "body",
        ranges,
        createdAt: new Date().toISOString(),
      };
      setHighlights((prev) => {
        const next = [...prev, optimistic];
        articleHighlights.save(String(aid), next);
        return next;
      });

      doc.getSelection()?.removeAllRanges();
    };

    const onMouseUp = () => applySelection();
    const onTouchEnd = () => applySelection();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && toolRef.current !== null) {
        setTool(null);
      }
    };

    doc.addEventListener("mouseup", onMouseUp);
    doc.addEventListener("touchend", onTouchEnd);
    doc.addEventListener("keydown", onKeyDown);

    (doc as any).__oslerHlCleanup = () => {
      doc.removeEventListener("mouseup", onMouseUp);
      doc.removeEventListener("touchend", onTouchEnd);
      doc.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      attachIframeListeners();
      setTimeout(applyHighlightsToIframe, 0);
    };

    iframe.addEventListener("load", handleLoad);
    if (iframe.contentDocument?.readyState === "complete") {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener("load", handleLoad);
      const doc = iframe.contentDocument;
      const cleanup = (doc as any)?.__oslerHlCleanup;
      if (typeof cleanup === "function") cleanup();
      attachedRef.current = null;
    };
  }, [attachIframeListeners, applyHighlightsToIframe, articleId]);

  React.useEffect(() => {
    applyHighlightsToIframe();
  }, [applyHighlightsToIframe]);

  const onColorPick = React.useCallback((c?: string) => {
    if (c) {
      setColor(c);
      setTool(c);
    }
  }, []);

  // Derived legacy-compatible API (used by article-modal / library)
  const highlightMode = tool !== null && tool !== ERASER_TOOL;
  const setHighlightMode = React.useCallback((v: boolean) => {
    setTool(v ? colorRef.current || HIGHLIGHT_COLOR_KEYS[0] : null);
  }, []);
  const highlightColor = tool !== null && tool !== ERASER_TOOL ? tool : color;
  const setHighlightColor = React.useCallback((c: string) => {
    setColor(c);
    setTool(c);
  }, []);

  const clearAll = React.useCallback(() => {
    if (articleId == null) return;
    const aid = String(articleId);
    setHighlights([]);
    articleHighlights.clear(aid);
  }, [articleId]);

  const refresh = React.useCallback(() => {
    applyHighlightsToIframe();
  }, [applyHighlightsToIframe]);

  React.useEffect(() => {
    if (!enabled && tool !== null) setTool(null);
  }, [enabled, tool]);

  return {
    tool,
    setTool,
    color,
    setColor,
    highlightMode,
    setHighlightMode,
    highlightColor,
    setHighlightColor,
    highlights,
    iframeRef,
    refresh,
    onColorPick,
    onAdd,
    onRemove,
    clearAll,
  };
}
