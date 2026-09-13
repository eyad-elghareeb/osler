import { resolveHighlightColor } from "@/lib/osler/highlight-palette";

export const HL_CLASS = "osler-hl";

export type ArticleSource = "amboss" | "uptodate" | "library";

export interface ArticleHighlightRange {
  start: number;
  end: number;
}

export interface ArticleHighlightItem {
  id: string;
  color: string;
  text: string;
  target?: string;
  ranges?: ArticleHighlightRange[];
  createdAt?: string;
}

export const ARTICLE_HIGHLIGHT_COLORS = [
  "#fef08a",
  "#86efac",
  "#93c5fd",
  "#fbcfe8",
  "#c4b5fd",
  "#fdba74",
];

/**
 * Find the occurrence of `needle` nearest to `hintStart`. Without a hint
 * this is the first occurrence; with one (the stored range that failed to
 * verify, e.g. legacy offsets measured against a wider container) it is
 * the closest match — so a repeated word like "The" paints where the user
 * selected it, not at its first appearance in the paragraph.
 */
export function findNearestOccurrence(
  hay: string,
  needle: string,
  hintStart: number | null
): number {
  if (!needle) return -1;
  if (hintStart == null || !(hintStart >= 0)) return hay.indexOf(needle);
  if (hay.slice(hintStart, hintStart + needle.length) === needle) return hintStart;
  let best = -1;
  let bestDist = Infinity;
  let from = 0;
  while (from < hay.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    const dist = Math.abs(idx - hintStart);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
    if (idx === hintStart) break;
    from = idx + 1;
  }
  return best;
}

export function applyHighlightsToHtml(
  html: string,
  highlights: ArticleHighlightItem[],
  target?: string
): string {
  if (!highlights.length || !html || typeof document === "undefined") return html;
  const doc = new DOMParser().parseFromString(
    `<div id="__hl_root">${html}</div>`,
    "text/html"
  );
  const root = doc.getElementById("__hl_root");
  if (!root) return html;

  // QBank scopes highlights per region (stem / choice-N / explanation).
  // When a target filter is supplied, skip highlights recorded against
  // another region — otherwise identical text bleeds across the stem,
  // every matching choice, and the explanation.
  if (target) {
    highlights = highlights.filter((hl) => !hl.target || hl.target === target);
  }

  const collect = (): { node: Text; start: number; end: number }[] => {
    const nodes: { node: Text; start: number; end: number }[] = [];
    let offset = 0;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
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
      if (!hl.text) continue;
      const hint = rng && typeof rng.start === "number" && rng.start >= 0 ? rng.start : null;
      // Prefer an exact-case match nearest the hint ("The" at a sentence
      // start beats a mid-sentence "the"); fall back to case-insensitive.
      let idx = findNearestOccurrence(fullText, hl.text, hint);
      if (idx < 0) {
        idx = findNearestOccurrence(fullText.toLowerCase(), hl.text.toLowerCase(), hint);
      }
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
      span.setAttribute("data-osler-hl-id", hl.id);
      try { rng.surroundContents(span); } catch {
        const frag = rng.extractContents();
        span.appendChild(frag);
        rng.insertNode(span);
      }
    }
  }

  return root.innerHTML;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function applyHighlightsToText(
  text: string,
  highlights: ArticleHighlightItem[],
  target?: string
): string {
  const html = escapeHtml(text);
  return applyHighlightsToHtml(html, highlights, target);
}
