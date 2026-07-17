/**
 * Osler rich-text helpers for content authored as a markdown subset.
 *
 * Used by the QBank / Bank / Written engines to render question stems,
 * choices, explanations, and passages. The renderer is intentionally a
 * narrow, safe subset (bold / italic / inline-code / links / line-breaks /
 * inline `![alt](src)` images) so authored content stays trustworthy
 * without pulling the full article markdown pipeline into the quiz bundle.
 *
 * Images resolve relative to the content pack folder. A bare filename
 * (e.g. `ecg.png`) is looked up in the pack's `images/` subfolder — the
 * location convention for content assets. Absolute URLs, `data:` URIs, and
 * paths starting with `/` are returned untouched.
 */

/** Resolve an asset (image) src against a content pack folder. */
export function resolveContentAsset(
  src: string,
  category: string,
  packPath: string,
): string {
  if (!src) return src;
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:") || src.startsWith("/")) {
    return src;
  }
  // Bare filename → resolve against the pack's images/ subfolder.
  const base = src.includes("/") ? src : `images/${src}`;
  return `/osler-content/${category}/${packPath}${base}`;
}

/**
 * Render a small, safe markdown subset to HTML. Escapes first, then applies
 * bold / italic / inline-code / links / line-breaks. Inline images
 * `![alt](src)` are extracted before escaping so their markup survives, then
 * resolved against the pack folder.
 */
export function renderRichText(
  text: string,
  category: string,
  packPath: string,
): string {
  if (!text) return "";
  // Pull inline images out first so the escaping pass doesn't mangle them.
  const imgTokens: string[] = [];
  const src = text.replace(
    /!\[([^\]]*)\]\(([^\s)]+)\)/g,
    (_full, alt: string, url: string) => {
      const resolved = resolveContentAsset(url, category, packPath);
      const altAttr = (alt ?? "").replace(/"/g, "&quot;");
      const titleAttr = url.includes(' "')
        ? ""
        : "";
      imgTokens.push(
        `<img src="${resolved}" alt="${altAttr}"${titleAttr}>`,
      );
      return `\u0000IMG${imgTokens.length - 1}\u0000`;
    },
  );

  let h = src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // Inline code (before other inline rules so its content isn't re-processed).
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold, then italic.
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  // Markdown links [label](url).
  h = h.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  h = h.replace(/\n/g, "<br>");
  // Restore the image tokens.
  h = h.replace(/\u0000IMG(\d+)\u0000/g, (_m, i: string) => imgTokens[Number(i)] ?? "");
  return h;
}
