export type ShortcutScope = "global" | "qbank" | "flashcard" | "reader";

export interface ShortcutAction {
  id: string;
  label: string;
  description: string;
  scope: ShortcutScope;
  defaultBinding: string;
}

export interface ShortcutBinding {
  actionId: string;
  binding: string;
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  { id: "global.search", label: "Open search", description: "Toggle the global article / topic search palette.", scope: "global", defaultBinding: "mod+k" },
  { id: "global.theme", label: "Toggle theme", description: "Switch between light and dark mode.", scope: "global", defaultBinding: "mod+j" },
  { id: "global.dashboard", label: "Go to Dashboard", description: "Jump to the dashboard view.", scope: "global", defaultBinding: "g d" },
  { id: "global.library", label: "Go to Library", description: "Jump to the article library.", scope: "global", defaultBinding: "g l" },
  { id: "global.qbank", label: "Go to Q-Bank Studio", description: "Jump to the Q-Bank studio.", scope: "global", defaultBinding: "g q" },
  { id: "global.flashcards", label: "Go to Flashcards", description: "Jump to the flashcard decks.", scope: "global", defaultBinding: "g f" },
  { id: "global.settings", label: "Go to Settings", description: "Jump to the settings page.", scope: "global", defaultBinding: "g s" },
  { id: "global.profile", label: "Go to Profile", description: "Jump to the user profile page.", scope: "global", defaultBinding: "g p" },
  { id: "qbank.next", label: "Next question", description: "Move to the next question.", scope: "qbank", defaultBinding: "arrowright" },
  { id: "qbank.prev", label: "Previous question", description: "Move to the previous question.", scope: "qbank", defaultBinding: "arrowleft" },
  { id: "qbank.submit", label: "Submit answer", description: "Submit the currently selected answer (tutor mode).", scope: "qbank", defaultBinding: "mod+enter" },
  { id: "qbank.flag", label: "Flag / unflag", description: "Toggle the flag on the current question.", scope: "qbank", defaultBinding: "f" },
  { id: "qbank.retry", label: "Retry question", description: "Reset and retry the current question.", scope: "qbank", defaultBinding: "r" },
  { id: "qbank.answer1", label: "Select choice A", description: "Select answer choice 1 (A).", scope: "qbank", defaultBinding: "1" },
  { id: "qbank.answer2", label: "Select choice B", description: "Select answer choice 2 (B).", scope: "qbank", defaultBinding: "2" },
  { id: "qbank.answer3", label: "Select choice C", description: "Select answer choice 3 (C).", scope: "qbank", defaultBinding: "3" },
  { id: "qbank.answer4", label: "Select choice D", description: "Select answer choice 4 (D).", scope: "qbank", defaultBinding: "4" },
  { id: "qbank.answer5", label: "Select choice E", description: "Select answer choice 5 (E).", scope: "qbank", defaultBinding: "5" },
  { id: "qbank.calculator", label: "Toggle calculator", description: "Open or close the calculator panel.", scope: "qbank", defaultBinding: "mod+b" },
  { id: "qbank.labValues", label: "Toggle lab values", description: "Open or close the lab values sidebar.", scope: "qbank", defaultBinding: "mod+l" },
  { id: "qbank.aiAssistant", label: "Toggle AI assistant", description: "Open or close the AI study assistant.", scope: "qbank", defaultBinding: "mod+i" },
  { id: "qbank.pause", label: "Pause / resume timed test", description: "Pause or resume the timer.", scope: "qbank", defaultBinding: "space" },
  { id: "qbank.endTest", label: "End test early", description: "End the current test and go to results.", scope: "qbank", defaultBinding: "mod+shift+e" },
  { id: "qbank.goHome", label: "Back to QBank home", description: "Leave the current question and return home.", scope: "qbank", defaultBinding: "escape" },
  { id: "flashcard.flip", label: "Flip card", description: "Flip the current flashcard.", scope: "flashcard", defaultBinding: "space" },
  { id: "flashcard.again", label: "Rate Again", description: "Mark card as Again.", scope: "flashcard", defaultBinding: "1" },
  { id: "flashcard.hard", label: "Rate Hard", description: "Mark card as Hard.", scope: "flashcard", defaultBinding: "2" },
  { id: "flashcard.good", label: "Rate Good", description: "Mark card as Good.", scope: "flashcard", defaultBinding: "3" },
  { id: "flashcard.easy", label: "Rate Easy", description: "Mark card as Easy.", scope: "flashcard", defaultBinding: "4" },
  { id: "flashcard.next", label: "Next card", description: "Skip to next card without rating.", scope: "flashcard", defaultBinding: "arrowright" },
  { id: "flashcard.prev", label: "Previous card", description: "Go back to previous card.", scope: "flashcard", defaultBinding: "arrowleft" },
  { id: "flashcard.exit", label: "Exit study", description: "Exit the study session.", scope: "flashcard", defaultBinding: "escape" },
  { id: "flashcard.restart", label: "Restart deck", description: "Restart the current deck from the beginning.", scope: "flashcard", defaultBinding: "r" },
  { id: "reader.close", label: "Close article / modal", description: "Close the article modal.", scope: "reader", defaultBinding: "escape" },
  { id: "reader.bookmark", label: "Bookmark article", description: "Toggle the bookmark on the current article.", scope: "reader", defaultBinding: "mod+d" },
  { id: "reader.zoomIn", label: "Zoom in", description: "Increase article text zoom.", scope: "reader", defaultBinding: "mod+=" },
  { id: "reader.zoomOut", label: "Zoom out", description: "Decrease article text zoom.", scope: "reader", defaultBinding: "mod+-" },
  { id: "reader.zoomReset", label: "Reset zoom", description: "Reset article text zoom to 100%.", scope: "reader", defaultBinding: "mod+0" },
] as const;

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
  if (options.ignoreInputs !== false && isTextInput(e.target)) {
    const hasMod = PLATFORM_MAC ? e.metaKey : e.ctrlKey;
    if (!hasMod) return null;
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

export function findConflicts(
  bindings: Record<string, string>,
  actionId: string,
  newBinding: string,
): string[] {
  if (!newBinding || !newBinding.trim()) return [];
  const norm = (b: string) => parseBinding(b).map((c) => `${c.mod ? "mod+" : ""}${c.shift ? "shift+" : ""}${c.alt ? "alt+" : ""}${c.key}`).join(" ");
  const target = norm(newBinding);
  if (!target) return [];
  const conflicts: string[] = [];
  for (const id of Object.keys(bindings)) {
    if (id === actionId) continue;
    if (norm(bindings[id]) === target) conflicts.push(id);
  }
  return conflicts;
}

export function clearShortcutSequence(): void {
  resetSequence();
}
