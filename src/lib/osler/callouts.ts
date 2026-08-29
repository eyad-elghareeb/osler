/**
 * Callout registry — Obsidian-style `> [!type] Title` admonitions for
 * articles and notes.
 *
 * A callout is a blockquote whose first line starts with `[!type]`
 * (optionally followed by a custom title). The markdown pipeline
 * (articles.ts) upgrades those blockquotes to
 * `<blockquote class="osler-callout osler-callout--warning" data-callout="warning">`
 * and the Milkdown editor paints the same classes via decorations, so both
 * surfaces share one CSS implementation in globals.css.
 *
 * This module is intentionally React-free: it is imported by the article
 * markdown pipeline, the editor decoration plugin, and (transitively) the
 * authoring docs.
 */

export interface CalloutTypeDef {
  /** Canonical id — CSS modifier + data-callout value. */
  id: string;
  /** Obsidian-compatible aliases accepted in the `[!type]` marker. */
  aliases: string[];
}

/**
 * Canonical callout types. The first alias is the canonical id; the rest
 * are accepted spellings (mirroring Obsidian's built-in set, plus three
 * medical-study extras used by Osler content).
 */
export const CALLOUTS: CalloutTypeDef[] = [
  { id: "note", aliases: ["note"] },
  { id: "abstract", aliases: ["abstract", "summary", "tldr"] },
  { id: "info", aliases: ["info"] },
  { id: "tip", aliases: ["tip", "hint", "important"] },
  { id: "success", aliases: ["success", "check", "done"] },
  { id: "question", aliases: ["question", "help", "faq"] },
  { id: "warning", aliases: ["warning", "caution", "attention"] },
  { id: "danger", aliases: ["danger", "error"] },
  { id: "failure", aliases: ["failure", "fail", "missing"] },
  { id: "bug", aliases: ["bug"] },
  { id: "example", aliases: ["example"] },
  { id: "quote", aliases: ["quote", "cite"] },
  // Medical-study extensions (Osler-specific).
  { id: "clinical-pearl", aliases: ["clinical-pearl", "pearl"] },
  { id: "exam-alert", aliases: ["exam-alert", "exam"] },
  { id: "mnemonic", aliases: ["mnemonic"] },
];

/** Canonical callout id → default (English) title used when none given. */
export const CALLOUT_DEFAULT_TITLES: Record<string, string> = {
  note: "Note",
  abstract: "Abstract",
  info: "Info",
  tip: "Tip",
  success: "Success",
  question: "Question",
  warning: "Warning",
  danger: "Danger",
  failure: "Failure",
  bug: "Bug",
  example: "Example",
  quote: "Quote",
  "clinical-pearl": "Clinical Pearl",
  "exam-alert": "Exam Alert",
  mnemonic: "Mnemonic",
};

const ALIAS_MAP: ReadonlyMap<string, string> = new Map(
  CALLOUTS.flatMap((def) => def.aliases.map((alias) => [alias, def.id] as const)),
);

/** Map any accepted alias to its canonical callout id (null when unknown). */
export function canonicalCalloutType(alias: string): string | null {
  return ALIAS_MAP.get(alias.trim().toLowerCase()) ?? null;
}

export interface ParsedCallout {
  /** Canonical callout id (e.g. "warning"). */
  type: string;
  /** Custom title from the marker line, if the author wrote one. */
  title: string | null;
}

const MARKER_RE = /^\[!([a-zA-Z-]+)\]([+-]?)[ \t]*(.*)$/;

/**
 * Parse a blockquote's first-line text as a callout marker.
 * Accepts `[!type]`, `[!type]+` (foldable), `[!type]-` (folded) and an
 * optional title after the marker, mirroring Obsidian's grammar (the
 * foldable flags are accepted and ignored — rendering is always expanded).
 * Only the FIRST line is examined: Milkdown paragraphs carry lazy
 * blockquote continuations inline (`Title\nbody…`), and `.` never matches
 * `\n`, so running the regex across the whole text would reject every
 * callout whose body shares its paragraph.
 * Returns null when the text is not a callout marker.
 */
export function parseCalloutMarker(text: string | null | undefined): ParsedCallout | null {
  if (!text) return null;
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  if (!firstLine) return null;
  const match = MARKER_RE.exec(firstLine);
  if (!match) return null;
  const type = canonicalCalloutType(match[1]);
  if (!type) return null;
  const title = match[3].trim();
  return { type, title: title || null };
}
