export type ArticleSource = "amboss" | "uworld-library" | "uptodate" | "library";

export interface ArticleHighlightRange {
  start: number;
  end: number;
}

export interface ArticleHighlightItem {
  id: string;
  color: string;
  text: string;
  target: string;
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

export function applyHighlightsToHtml(
  html: string,
  highlights: ArticleHighlightItem[]
): string {
  if (!highlights.length || !html || typeof document === "undefined") return html;
  const doc = new DOMParser().parseFromString(
    `<div id="__hl_root">${html}</div>`,
    "text/html"
  );
  const root = doc.getElementById("__hl_root");
  if (!root) return html;

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
      span.style.backgroundColor = hl.color;
      span.style.borderRadius = "2px";
      span.style.padding = "0 1px";
      span.setAttribute("data-highlight-id", hl.id);
      try { rng.surroundContents(span); } catch {
        const frag = rng.extractContents();
        span.appendChild(frag);
        rng.insertNode(span);
      }
    }
  }

  return root.innerHTML;
}
