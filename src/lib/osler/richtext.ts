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

import { contentFileUrl } from "./content-url";

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
  return contentFileUrl(category, `${packPath}${base}`);
}

/** Escape a string for safe use inside a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Block dangerous URL schemes; anything not http(s)/mailto/data:image is dropped. */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp);/i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Render a small, safe markdown subset to HTML. Escapes first, then applies
 * bold / italic / inline-code / links / line-breaks. Inline images
 * `![alt](src)` are extracted before escaping so their markup survives, then
 * resolved against the pack folder. The resolved src is attribute-escaped and
 * scheme-checked so a hostile pack can't break out of the attribute or inject
 * markup through the unescaped URL path.
 *
 * `opts.imageSrc`, when provided, rewrites each resolved image URL right
 * before it is attribute-escaped — used by the Anki exporter to map resolved
 * URLs to bare media filenames.
 */
export function renderRichText(
  text: string,
  category: string,
  packPath: string,
  opts?: { imageSrc?: (url: string) => string },
): string {
  const imageSrc = opts?.imageSrc;
  if (!text) return "";
  // Pull inline images out first so the escaping pass doesn't mangle them.
  const imgTokens: string[] = [];
  const src = text.replace(
    /!\[([^\]]*)\]\(([^\s)]+)\)/g,
    (_full, alt: string, url: string) => {
      const checked = safeUrl(url);
      if (!checked) return "";
      const resolved = resolveContentAsset(checked, category, packPath);
      const finalSrc = escapeAttr(imageSrc ? imageSrc(resolved) : resolved);
      const altAttr = escapeAttr(alt ?? "");
      imgTokens.push(`<img src="${finalSrc}" alt="${altAttr}" loading="lazy">`);
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
  // Markdown links [label](url). The escaped text can't contain raw quotes,
  // but the URL itself is still scheme-checked before being href'd.
  h = h.replace(
    /\[([^\]]+)\]\((https?:&#47;&#47;[^\s)]+|https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) => {
      // The text was HTML-escaped above, so a plain "https://" may have
      // survived verbatim; entity-encoded slashes come from authored input.
      const candidate = url.replaceAll("&#47;", "/");
      return safeUrl(candidate)
        ? `<a href="${escapeAttr(candidate)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`
        : label;
    },
  );
  h = h.replace(/\n/g, "<br>");
  // Restore the image tokens.
  h = h.replace(/\u0000IMG(\d+)\u0000/g, (_m, i: string) => imgTokens[Number(i)] ?? "");
  return h;
}
