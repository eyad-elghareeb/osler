// constants.js — Shared constants extracted from wizard.js / instance.js / config.js
//
// Single source of truth for the canonical engine-plugin list and the
// built-in theme presets. Previously these were copy-pasted into three view
// files; they now live here so a change only needs to be made once.

(function () {
  "use strict";

  /**
   * Canonical engine-plugin list — kept in sync with ENGINE_PLUGIN_IDS in
   * src/lib/osler/config.ts and the Rust backend. Each entry carries every
   * field any view has ever needed (label, defaultLabel/defaultColor/defaultIcon
   * for the config editor, desc + icon path for the wizard).
   */
  const ENGINES = [
    { id: "quiz",      label: "Quiz",           defaultLabel: "Quiz",           defaultColor: "oklch(0.62 0.16 250)", defaultIcon: "clipboard",
      desc: "Standard MCQ quizzes with 5 choices",                                          icon: "M9 11l3 3 8-8M4 14l3 3 8-8M4 6l3 3 8-8" },
    { id: "bank",      label: "Question Bank",  defaultLabel: "Question Bank",  defaultColor: "oklch(0.58 0.14 245)", defaultIcon: "book",
      desc: "Passage-based questions with shared context",                                  icon: "M4 4h16v16H4zM4 9h16M9 4v16" },
    { id: "written",   label: "Written",        defaultLabel: "Written",        defaultColor: "oklch(0.78 0.16 80)",  defaultIcon: "pen-tool",
      desc: "Free-text prompts with rubric review",                                         icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" },
    { id: "flashcard", label: "Flashcards",     defaultLabel: "Flashcards",     defaultColor: "oklch(0.7 0.18 145)", defaultIcon: "layers",
      desc: "Spaced-repetition decks with subdecks",                                        icon: "M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-3H4a1 1 0 0 0-1 1z" },
    { id: "osce",      label: "OSCE",           defaultLabel: "OSCE",           defaultColor: "oklch(0.7 0.2 16)",   defaultIcon: "activity",
      desc: "Clinical exam simulator with AI voice",                                        icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
    { id: "library",   label: "Library",        defaultLabel: "Library",        defaultColor: "oklch(0.65 0.15 280)", defaultIcon: "book-open",
      desc: "Markdown article reader with highlighting",                                    icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" },
    { id: "video",     label: "Videos",         defaultLabel: "Videos",         defaultColor: "oklch(0.68 0.18 195)", defaultIcon: "video",
      desc: "Video library with YouTube / mp4 / HLS",                                       icon: "m22 8-6 4 6 4V8zM2 6h12v12H2z" },
  ];

  /** Built-in theme presets offered by the wizard + instance generator. */
  const THEME_PRESETS = [
    { id: "dark",          name: "Dark",          variant: "dark"  },
    { id: "light",         name: "Light",         variant: "light" },
    { id: "navy-clinic",   name: "Navy Clinic",   variant: "dark"  },
    { id: "forest-rounds", name: "Forest Rounds", variant: "dark"  },
    { id: "cream-journal", name: "Cream Journal", variant: "light" },
    { id: "crimson-ed",    name: "Crimson ED",    variant: "dark"  },
  ];

  /** Content categories that ship with a manifest.json. */
  const MANIFEST_CATEGORIES = ["qbank", "library", "flashcard", "osce", "videos"];

  window.OslerConstants = { ENGINES, THEME_PRESETS, MANIFEST_CATEGORIES };
})();
