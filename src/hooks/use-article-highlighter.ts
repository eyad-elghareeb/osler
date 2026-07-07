"use client";

import * as React from "react";
import {
  type ArticleSource,
  type ArticleHighlightItem,
  ARTICLE_HIGHLIGHT_COLORS,
} from "@/lib/osler/article-highlights";
import { articleHighlights } from "@/lib/osler/storage";

interface UseArticleHighlighterOptions {
  source: ArticleSource;
  articleId: string | number | null;
  enabled?: boolean;
}

export interface UseArticleHighlighterReturn {
  highlightMode: boolean;
  setHighlightMode: (v: boolean) => void;
  highlightColor: string;
  setHighlightColor: (c: string) => void;
  highlights: ArticleHighlightItem[];
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  refresh: () => void;
  onColorPick: (color?: string) => void;
  onRemove: (id: string) => void;
  clearAll: () => void;
}

const HL_CLASS = "osler-article-highlight";
const HL_DATA_ATTR = "data-osler-hl-id";

export function useArticleHighlighter(
  opts: UseArticleHighlighterOptions
): UseArticleHighlighterReturn {
  const { source: _source, articleId, enabled = true } = opts;

  const [highlightMode, setHighlightMode] = React.useState(false);
  const [highlightColor, setHighlightColor] = React.useState(
    ARTICLE_HIGHLIGHT_COLORS[0]
  );
  const [highlights, setHighlights] = React.useState<ArticleHighlightItem[]>([]);

  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const attachedRef = React.useRef<HTMLDocument | null>(null);
  const loadIdRef = React.useRef(0);

  const highlightModeRef = React.useRef(highlightMode);
  highlightModeRef.current = highlightMode;
  const highlightColorRef = React.useRef(highlightColor);
  highlightColorRef.current = highlightColor;
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
          border-radius: 2px;
          padding: 0 1px;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .${HL_CLASS}:hover { opacity: 0.7; }
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
        span.style.backgroundColor = hl.color;
        span.setAttribute(HL_DATA_ATTR, hl.id);
        try { rng.surroundContents(span); } catch {
          const frag = rng.extractContents();
          span.appendChild(frag);
          rng.insertNode(span);
        }
      }
    }

    doc.querySelectorAll(`.${HL_CLASS}`).forEach((span) => {
      (span as HTMLElement).addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = (span as HTMLElement).getAttribute(HL_DATA_ATTR);
        if (id) onRemoveRef.current?.(id);
      });
    });
  }, [highlights]);

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

  const attachIframeListeners = React.useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    if (attachedRef.current === doc) return;
    attachedRef.current = doc;

    const onMouseUp = () => {
      if (!highlightModeRef.current) return;
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

      const c = highlightColorRef.current;
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

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && highlightModeRef.current) {
        setHighlightMode(false);
      }
    };

    doc.addEventListener("mouseup", onMouseUp);
    doc.addEventListener("keydown", onKeyDown);

    (doc as any).__oslerHlCleanup = () => {
      doc.removeEventListener("mouseup", onMouseUp);
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

  const onColorPick = React.useCallback((color?: string) => {
    if (color) setHighlightColor(color);
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
    if (!enabled && highlightMode) setHighlightMode(false);
  }, [enabled, highlightMode]);

  return {
    highlightMode,
    setHighlightMode,
    highlightColor,
    setHighlightColor,
    highlights,
    iframeRef,
    refresh,
    onColorPick,
    onRemove,
    clearAll,
  };
}
