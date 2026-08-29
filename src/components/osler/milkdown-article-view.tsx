"use client";

/**
 * MilkdownArticleView — read-only article renderer built on Milkdown Crepe.
 *
 * Replaces the `mdToHtml` + dangerouslySetInnerHTML article body so articles
 * look identical everywhere the Milkdown toolchain is used (notes, answers,
 * admin editors). Also unifies the callout treatment (decorations share the
 * same CSS as the markdown pipeline) and keeps the article-highlighter
 * feature working:
 *
 *   • Highlights are painted as inline ProseMirror decorations derived from
 *     DOM text offsets — the same absolute-offset model `Range.toString()`
 *     capture produces, so stored highlights render without conversion.
 *   • `contentRef` exposes the wrapper element so parents can keep their
 *     selection-capture / eraser / lightbox listeners unchanged.
 *   • Obsidian callout markers (`[!type]`) are hidden; the custom title
 *     renders as the callout title row (editors keep the marker visible).
 */

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { $prose } from "@milkdown/kit/utils";
import { Plugin as ProseMirrorPlugin } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { parseCalloutMarker } from "@/lib/osler/callouts";
import { resolveArticleAsset } from "@/lib/osler/articles";
import {
  HL_CLASS,
  type ArticleHighlightItem,
} from "@/lib/osler/article-highlights";
import { resolveHighlightColor } from "@/lib/osler/highlight-palette";
import { renderMermaidToSvg } from "@/components/osler/admin/editors/mermaid-editor";
import { MermaidModal } from "./mermaid-modal";

/* ── Markdown prep ────────────────────────────────────────────────────── */

/**
 * Resolve relative image sources in the raw markdown against the article's
 * own folder (Milkdown parses markdown directly — the old HTML pipeline's
 * rehype image rewrite no longer runs). Only `![alt](src)` nodes are
 * touched; link targets and code fences pass through untouched.
 */
function resolveMarkdownImages(markdown: string, articleDir: string): string {
  if (!markdown.includes("](")) return markdown;
  return markdown.replace(
    /(!\[[^\]]*\]\()(\s*)([^)\s]+)((?:\s+"[^"]*")?\s*\))/g,
    (full, head: string, sp: string, src: string, tail: string) => {
      if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return full;
      return `${head}${sp}${resolveArticleAsset(src, articleDir)}${tail}`;
    },
  );
}

/** Directory part of an article file path ("" when the file is root-level). */
export function articleDirOf(filePath: string): string {
  return filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
    : "";
}

/* ── Decorations: callouts + highlights ───────────────────────────────── */

/** Per-segment DOM text lookup shared by the offset model. */
interface DomTextSegment {
  node: Text;
  start: number;
  end: number;
}

function collectDomTextSegments(root: Node): DomTextSegment[] {
  const segments: DomTextSegment[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.data.length;
    segments.push({ node, start: offset, end: offset + len });
    offset += len;
  }
  return segments;
}

/**
 * Resolve a highlight to absolute DOM text offsets. Prefers the stored
 * range (verified against the text, as the HTML pipeline does) and falls
 * back to a case-insensitive text search.
 */
function resolveHighlightOffsets(
  hl: ArticleHighlightItem,
  fullText: string,
): { start: number; end: number } | null {
  const rng = hl.ranges?.[0];
  if (rng && typeof rng.start === "number" && typeof rng.end === "number" && rng.end > rng.start) {
    if (fullText.slice(rng.start, rng.end) === hl.text) {
      return { start: rng.start, end: rng.end };
    }
  }
  const needle = hl.text.toLowerCase();
  if (!needle) return null;
  const idx = fullText.toLowerCase().indexOf(needle);
  if (idx < 0) return null;
  return { start: idx, end: idx + hl.text.length };
}

const MARKER_PREFIX_RE = /^(\[![a-zA-Z-]+\][+-]?\s*)/;

/**
 * Build the article-view decoration set:
 *   • callout blockquotes (`.osler-callout` + title row, marker hidden)
 *   • saved highlights (`.osler-hl` spans with data-osler-hl-id)
 * Offsets are derived from the rendered DOM's text nodes — the same
 * concatenation `Range.toString()` capture uses — so stored highlights map
 * 1:1 without conversion.
 */
function buildArticleDecorations(
  view: EditorView,
  highlights: ArticleHighlightItem[],
): DecorationSet {
  const decorations: Decoration[] = [];

  // 1. Callout blockquotes — node decoration + title-run styling.
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "blockquote") return;
    const first = node.firstChild;
    if (!first || first.type.name !== "paragraph") return;
    const parsed = parseCalloutMarker(first.textContent);
    if (!parsed) return;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `osler-callout osler-callout--${parsed.type}`,
      }),
    );
    // Style only the title RUN (marker + title text before the first
    // hard break). Lazy-continuation lines share this paragraph, so a
    // paragraph-level decoration would wrap the whole body in the title's
    // uppercase accent styling and lay it out beside the title.
    const paragraphStart = pos + 1;
    let titleEnd = paragraphStart + first.content.size;
    let breakAt = -1;
    first.forEach((child, offset) => {
      if (breakAt < 0 && child.type.name === "hardbreak") {
        breakAt = offset;
        titleEnd = paragraphStart + offset;
      }
    });
    decorations.push(
      Decoration.inline(paragraphStart, titleEnd, { class: "osler-callout-title" }),
    );
    // The break that ends the title line disappears under the block-level
    // title span — keep it, or the body starts with a blank line.
    if (breakAt >= 0) {
      decorations.push(
        Decoration.inline(titleEnd, titleEnd + 1, { class: "osler-callout-title-break" }),
      );
    }
    // Hide the raw `[!type]` marker (first text child of the paragraph).
    const markerLen = MARKER_PREFIX_RE.exec(first.textContent ?? "")?.[1].length;
    if (markerLen) {
      decorations.push(
        Decoration.inline(paragraphStart, paragraphStart + markerLen, {
          class: "osler-callout-marker",
        }),
      );
    }
  });

  // 2. Highlights — inline spans over DOM text segments.
  if (highlights.length > 0) {
    const segments = collectDomTextSegments(view.dom);
    const fullText = segments.map((s) => s.node.data).join("");
    for (const hl of highlights) {
      const range = resolveHighlightOffsets(hl, fullText);
      if (!range) continue;
      for (const seg of segments) {
        const oStart = Math.max(range.start, seg.start);
        const oEnd = Math.min(range.end, seg.end);
        if (oStart >= oEnd) continue;
        try {
          const from = view.posAtDOM(seg.node, oStart - seg.start);
          const to = view.posAtDOM(seg.node, oEnd - seg.start);
          if (from === to) continue;
          decorations.push(
            Decoration.inline(from, to, {
              class: HL_CLASS,
              style: `background-color: ${resolveHighlightColor(hl.color)}`,
              "data-osler-hl-id": hl.id,
            }),
          );
        } catch {
          // posAtDOM can fail inside widget DOM (mermaid previews, code
          // editors) — skip that segment instead of dropping the highlight.
        }
      }
    }
  }

  return decorations.length > 0
    ? DecorationSet.create(view.state.doc, decorations)
    : DecorationSet.empty;
}

/* ── Inner view ───────────────────────────────────────────────────────── */

interface InnerArticleViewProps {
  markdown: string;
  highlights: ArticleHighlightItem[];
}

function InnerArticleView({ markdown, highlights }: InnerArticleViewProps) {
  const { t } = useI18n();
  const highlightsRef = React.useRef(highlights);
  highlightsRef.current = highlights;
  const viewRef = React.useRef<EditorView | null>(null);

  // Decorations are a pure function of (doc, highlightsRef, DOM). ProseMirror
  // calls `decorations()` on every view update; the effect below forces an
  // update when highlights change without a document transaction.
  const decorationsPlugin = React.useMemo(
    () =>
      $prose(
        () =>
          new ProseMirrorPlugin({
            view(view) {
              viewRef.current = view;
              return {
                destroy() {
                  if (viewRef.current === view) viewRef.current = null;
                },
              };
            },
            props: {
              decorations(state) {
                const view = viewRef.current;
                if (!view || view.state !== state) return DecorationSet.empty;
                return buildArticleDecorations(view, highlightsRef.current);
              },
            },
          }),
      ),
    [],
  );

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.tr);
  }, [highlights]);

  useEditor((root) => {
    // Inline mermaid preview — same behavior as the notes editor (debounced,
    // sequence-guarded so rapid swaps cancel stale renders).
    let previewSeq = 0;
    let previewTimer: number | null = null;
    const renderMermaidPreview = (
      language: string,
      content: string,
      applyPreview: (value: null | string | HTMLElement) => void,
    ) => {
      if (language !== "mermaid" || !content.trim()) return null;
      const seq = ++previewSeq;
      if (previewTimer) window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        void renderMermaidToSvg(content)
          .then((svg) => {
            if (seq !== previewSeq) return;
            applyPreview(`<div class="osler-mermaid-render">${svg}</div>`);
          })
          .catch(() => {
            if (seq === previewSeq) applyPreview(null);
          });
      }, 200);
      return undefined;
    };

    const crepe = new Crepe({
      root,
      defaultValue: markdown,
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.ImageBlock]: true,
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.Cursor]: false,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.Placeholder]: false,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.Latex]: true,
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: {
          previewOnlyByDefault: true,
          renderPreview: renderMermaidPreview,
          previewLabel: t("editor.mermaid.previewLabel"),
          previewLoading: t("editor.mermaid.previewLoading"),
          previewToggleText: (previewOnlyMode: boolean) =>
            previewOnlyMode
              ? t("editor.mermaid.previewEdit")
              : t("editor.mermaid.previewHide"),
        },
      },
    });

    crepe.setReadonly(true);
    crepe.editor.use(decorationsPlugin);

    return crepe;
  }, [markdown]);

  return <Milkdown />;
}

/* ── Outer wrapper ────────────────────────────────────────────────────── */

export interface MilkdownArticleViewProps {
  /** Raw markdown body (frontmatter already stripped). */
  markdown: string;
  /** Article folder used to resolve relative image sources. */
  articleDir: string;
  /** Saved highlights painted as inline decorations. */
  highlights?: ArticleHighlightItem[];
  /** Ref receiving the content container (selection capture, eraser, lightbox). */
  contentRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  style?: React.CSSProperties;
  dir?: "ltr" | "rtl";
  lang?: string;
}

export function MilkdownArticleView({
  markdown,
  articleDir,
  highlights = [],
  contentRef,
  className,
  style,
  dir,
  lang,
}: MilkdownArticleViewProps) {
  const { t } = useI18n();
  const resolved = React.useMemo(
    () => resolveMarkdownImages(markdown, articleDir),
    [markdown, articleDir],
  );

  // Clicking a rendered mermaid diagram opens the fullscreen viewer
  // (zoom / pan / download). The SVG markup is captured straight from the
  // rendered preview so it's guaranteed to match what the user clicked.
  const [mermaidSvg, setMermaidSvg] = React.useState<string | null>(null);
  const handleMermaidClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const render = (e.target as HTMLElement).closest<HTMLElement>(".osler-mermaid-render");
    if (!render) return;
    const markup = render.querySelector("svg")?.outerHTML;
    if (!markup) return;
    e.stopPropagation();
    haptic("light");
    setMermaidSvg(markup);
  }, []);

  // The wrapper itself is the content container: every parent listener works
  // on DOM inside it (selection capture, eraser taps, image lightbox).
  const setContainer = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (contentRef) contentRef.current = el;
    },
    [contentRef],
  );

  return (
    <div
      ref={setContainer}
      className={cn("osler-milkdown-article", className)}
      style={style}
      dir={dir}
      lang={lang}
      onClick={handleMermaidClick}
    >
      <MilkdownProvider>
        <InnerArticleView markdown={resolved} highlights={highlights} />
      </MilkdownProvider>
      <AnimatePresence>
        {mermaidSvg && (
          <MermaidModal
            svg={mermaidSvg}
            title={t("library.mermaidTitle")}
            onClose={() => setMermaidSvg(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
