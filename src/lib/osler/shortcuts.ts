import type { StringKey } from "@/lib/osler/i18n";

export type ShortcutScope = "global" | "qbank" | "flashcard" | "reader" | "videos";

export interface ShortcutAction {
  id: string;
  labelKey: StringKey;
  descriptionKey: StringKey;
  scope: ShortcutScope;
  defaultBinding: string;
}

export interface ShortcutBinding {
  actionId: string;
  binding: string;
}

function action(id: string, scope: ShortcutScope, defaultBinding: string): ShortcutAction {
  return {
    id,
    labelKey: `settings.shortcuts.action.${id}` as StringKey,
    descriptionKey: `settings.shortcuts.action.${id}.desc` as StringKey,
    scope,
    defaultBinding,
  };
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  action("global.search", "global", "mod+k"),
  action("global.theme", "global", "mod+j"),
  action("global.dashboard", "global", "g d"),
  action("global.library", "global", "g l"),
  action("global.qbank", "global", "g q"),
  action("global.flashcards", "global", "g f"),
  action("global.settings", "global", "g s"),
  action("global.profile", "global", "g p"),
  action("qbank.next", "qbank", "arrowright"),
  action("qbank.prev", "qbank", "arrowleft"),
  action("qbank.submit", "qbank", "mod+enter"),
  action("qbank.flag", "qbank", "f"),
  action("qbank.retry", "qbank", "r"),
  action("qbank.answer1", "qbank", "1"),
  action("qbank.answer2", "qbank", "2"),
  action("qbank.answer3", "qbank", "3"),
  action("qbank.answer4", "qbank", "4"),
  action("qbank.answer5", "qbank", "5"),
  action("qbank.calculator", "qbank", "mod+b"),
  action("qbank.labValues", "qbank", "mod+l"),
  action("qbank.aiAssistant", "qbank", "a"),
  action("qbank.notes", "qbank", "n"),
  action("qbank.highlight", "qbank", "h"),
  action("qbank.eraser", "qbank", "e"),
  action("qbank.quizSettings", "qbank", ","),
  action("qbank.shortcutsHelp", "qbank", "shift+/"),
  action("qbank.pause", "qbank", "space"),
  action("qbank.endTest", "qbank", "mod+shift+e"),
  action("qbank.goHome", "qbank", "escape"),
  action("flashcard.flip", "flashcard", "space"),
  action("flashcard.again", "flashcard", "1"),
  action("flashcard.hard", "flashcard", "2"),
  action("flashcard.good", "flashcard", "3"),
  action("flashcard.easy", "flashcard", "4"),
  action("flashcard.next", "flashcard", "arrowright"),
  action("flashcard.prev", "flashcard", "arrowleft"),
  action("flashcard.exit", "flashcard", "escape"),
  action("flashcard.restart", "flashcard", "r"),
  action("reader.close", "reader", "escape"),
  action("reader.bookmark", "reader", "mod+d"),
  action("reader.zoomIn", "reader", "mod+="),
  action("reader.zoomOut", "reader", "mod+-"),
  action("reader.zoomReset", "reader", "mod+0"),
  action("videos.next", "videos", "n"),
  action("videos.prev", "videos", "p"),
  action("videos.fullscreen", "videos", "f"),
  action("videos.mute", "videos", "m"),
  action("videos.exit", "videos", "escape"),
];

const STORAGE_KEY = "osler_shortcuts_v1";

export function defaultBindings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of SHORTCUT_ACTIONS) out[a.id] = a.defaultBinding;
  return out;
}

export function loadBindings(): Record<string, string> {
  if (typeof window === "undefined") return defaultBindings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBindings();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged = defaultBindings();
    for (const a of SHORTCUT_ACTIONS) {
      const v = parsed[a.id];
      if (typeof v === "string") merged[a.id] = v;
    }
    return merged;
  } catch {
    return defaultBindings();
  }
}

export function saveBindings(bindings: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    window.dispatchEvent(new CustomEvent("osler:shortcuts-changed"));
  } catch {}
}

export function resetBindings(): Record<string, string> {
  const d = defaultBindings();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("osler:shortcuts-changed"));
    } catch {}
  }
  return d;
}

export interface ParsedChord {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseBinding(binding: string): ParsedChord[] {
  if (!binding || !binding.trim()) return [];
  return binding
    .trim()
    .split(/\s+/)
    .map((chordStr) => {
      const parts = chordStr.split("+").map((p) => p.trim().toLowerCase());
      const key = parts[parts.length - 1] || "";
      const mods = parts.slice(0, -1);
      return {
        mod: mods.includes("mod"),
        shift: mods.includes("shift"),
        alt: mods.includes("alt"),
        key,
      };
    });
}

const PLATFORM_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

export function chordMatches(e: KeyboardEvent, chord: ParsedChord): boolean {
  const key = normalizeKey(e.key);
  if (!key) return false;
  const isMac = PLATFORM_MAC;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (chord.mod !== mod) return false;
  if (chord.shift !== e.shiftKey) return false;
  if (chord.alt !== e.altKey) return false;
  if (chord.key !== key) return false;
  return true;
}

function normalizeKey(k: string): string {
  if (!k) return "";
  const lower = k.toLowerCase();
  if (lower === "esc") return "escape";
  if (lower === "del") return "delete";
  if (lower === " ") return "space";
  if (lower === "spacebar") return "space";
  if (lower === "ctrl") return "control";
  if (lower === "cmd") return "meta";
  if (lower === "command") return "meta";
  if (lower === "opt") return "alt";
  if (lower === "option") return "alt";
  if (lower === "plus" || lower === "+") return "+";
  if (lower === "minus" || lower === "-") return "-";
  if (lower === "=" || lower === "equal") return "=";
  if (lower === "?") return "/";
  if (lower.startsWith("arrow")) return lower;
  return lower;
}

export function captureChord(e: KeyboardEvent): string | null {
  const k = e.key.toLowerCase();
  if (k === "control" || k === "ctrl" || k === "shift" || k === "alt" ||
    k === "meta" || k === "cmd" || k === "command" || k === "option" || k === "opt" ||
    k === "fn" || k === "capslock" || k === "tab") {
    return null;
  }
  const isMac = PLATFORM_MAC;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(normalizeKey(e.key));
  return parts.join("+");
}

export function describeBinding(binding: string): string {
  if (!binding || !binding.trim()) return "Disabled";
  const isMac = PLATFORM_MAC;
  const chords = parseBinding(binding);
  return chords
    .map((chord) => {
      const parts: string[] = [];
      if (chord.mod) parts.push(isMac ? "⌘" : "Ctrl");
      if (chord.shift) parts.push(isMac ? "⇧" : "Shift");
      if (chord.alt) parts.push(isMac ? "⌥" : "Alt");
      parts.push(prettyKey(chord.key));
      return parts.join(isMac ? "" : "+");
    })
    .join(isMac ? " " : " then ");
}

function prettyKey(k: string): string {
  if (!k) return "";
  const map: Record<string, string> = {
    arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→",
    escape: "Esc", enter: "Enter", backspace: "⌫", delete: "Del",
    space: "Space", home: "Home", end: "End", pageup: "PgUp", pagedown: "PgDn",
    "+": "+", "-": "-", "=": "=",
  };
  if (map[k]) return map[k];
  if (k.length === 1) return k.toUpperCase();
  return k;
}

export type ShortcutListener = (bindings: Record<string, string>) => void;

export function subscribeShortcuts(listener: ShortcutListener): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadBindings());
  window.addEventListener("osler:shortcuts-changed", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("osler:shortcuts-changed", handler);
    window.removeEventListener("storage", handler);
  };
}

export interface ShortcutMatchOptions {
  ignoreInputs?: boolean;
  allowRepeat?: boolean;
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input") {
    const t = (target as HTMLInputElement).type.toLowerCase();
    return t !== "checkbox" && t !== "radio" && t !== "button" && t !== "submit" && t !== "reset";
  }
  if (tag === "textarea") return true;
  if (target.isContentEditable) return true;
  if (tag === "iframe") return false;
  return false;
}

/**
 * Shortcuts that may fire while the user is typing in a text field or
 * contenteditable (e.g. the Markdown editor). All other modifier shortcuts
 * are suppressed in inputs — Ctrl+B / Ctrl+I / Ctrl+K / Ctrl+L etc. are
 * editor bindings (bold / italic / insert link / insert image), not app
 * chrome, and must not hijack the keystroke. Ctrl+Enter ("qbank.submit")
 * is the exception: it submits the current answer and never collides with
 * a text-editing binding.
 */
const TYPING_SAFE_ACTIONS: ReadonlySet<string> = new Set(["qbank.submit"]);

interface SequenceState {
  matched: ParsedChord[];
  candidates: Set<string>;
  deadline: number;
}

let seqState: SequenceState | null = null;
const SEQ_TIMEOUT_MS = 800;

function resetSequence(): void {
  seqState = null;
}

export function matchShortcut(
  e: KeyboardEvent,
  bindings: Record<string, string>,
  options: ShortcutMatchOptions = {},
): string | null {
  if (!bindings) return null;
  if (e.repeat && !options.allowRepeat) {
    if (!seqState) return null;
  }
  let typingSafe: ReadonlySet<string> | null = null;
  if (options.ignoreInputs !== false && isTextInput(e.target)) {
    const hasMod = PLATFORM_MAC ? e.metaKey : e.ctrlKey;
    if (!hasMod) return null;
    typingSafe = TYPING_SAFE_ACTIONS;
  }

  const now = Date.now();
  if (seqState && now > seqState.deadline) resetSequence();

  let candidates: Set<string>;
  let matchedSoFar: ParsedChord[];

  if (seqState) {
    candidates = seqState.candidates;
    matchedSoFar = seqState.matched;
  } else {
    candidates = new Set<string>();
    matchedSoFar = [];
    for (const actionId of Object.keys(bindings)) {
      const binding = bindings[actionId];
      if (!binding || !binding.trim()) continue;
      candidates.add(actionId);
    }
  }

  const stillAlive: Set<string> = new Set();
  let completed: string | null = null;

  for (const actionId of candidates) {
    if (typingSafe && !typingSafe.has(actionId)) continue;
    const binding = bindings[actionId];
    if (!binding) continue;
    const chords = parseBinding(binding);
    if (chords.length === 0) continue;
    const nextIdx = matchedSoFar.length;
    if (nextIdx >= chords.length) continue;
    const nextChord = chords[nextIdx];
    if (!chordMatches(e, nextChord)) continue;
    if (nextIdx + 1 === chords.length) {
      if (completed === null) completed = actionId;
    } else {
      stillAlive.add(actionId);
    }
  }

  if (completed) {
    resetSequence();
    return completed;
  }

  if (stillAlive.size > 0) {
    const nextChordMatched: ParsedChord = {
      mod: PLATFORM_MAC ? e.metaKey : e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      key: normalizeKey(e.key),
    };
    seqState = {
      matched: [...matchedSoFar, nextChordMatched],
      candidates: stillAlive,
      deadline: now + SEQ_TIMEOUT_MS,
    };
    return null;
  }

  resetSequence();
  return null;
}

/**
 * Find conflicts for a shortcut binding — but ONLY within the same scope.
 *
 * Shortcuts are scoped (global / qbank / flashcard / reader). The same key
 * combination can be used in different scopes without conflict — for example,
 * ArrowRight can be "next question" in qbank AND "next flashcard" in
 * flashcards, because only one scope is active at a time (the user is either
 * in a quiz OR studying flashcards, never both at once).
 *
 * The "global" scope is special: global shortcuts are available everywhere,
 * so a global binding conflicts with bindings in ALL scopes. Conversely, a
 * scoped binding conflicts with global bindings AND bindings in the same scope.
 */
export function findConflicts(
  bindings: Record<string, string>,
  actionId: string,
  newBinding: string,
): string[] {
  if (!newBinding || !newBinding.trim()) return [];
  const norm = (b: string) => parseBinding(b).map((c) => `${c.mod ? "mod+" : ""}${c.shift ? "shift+" : ""}${c.alt ? "alt+" : ""}${c.key}`).join(" ");
  const target = norm(newBinding);
  if (!target) return [];

  // Look up the scope of the action being changed
  const action = SHORTCUT_ACTIONS.find((a) => a.id === actionId);
  const actionScope = action?.scope;

  const conflicts: string[] = [];
  for (const id of Object.keys(bindings)) {
    if (id === actionId) continue;
    if (norm(bindings[id]) !== target) continue;

    const other = SHORTCUT_ACTIONS.find((a) => a.id === id);
    const otherScope = other?.scope;
    if (!otherScope) continue;

    // Conflict if:
    //   - same scope (e.g. two qbank actions with the same key)
    //   - either is global (global shortcuts are active in all scopes)
    if (actionScope === otherScope || actionScope === "global" || otherScope === "global") {
      conflicts.push(id);
    }
  }
  return conflicts;
}

export function clearShortcutSequence(): void {
  resetSequence();
}
