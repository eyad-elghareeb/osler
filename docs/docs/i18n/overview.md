# Internationalization (i18n) Overview

Osler V2 ships with bilingual UI support (English + Arabic) and full RTL
(right-to-left) layout. This page is the entry point for i18n work. For
specific tasks, see [Adding Strings](adding-strings.md) and
[RTL Guide](rtl-guide.md).

## Scope

V2 i18n covers:

- **UI strings** — every text label, button, toast, error message, and
  tooltip in the PWA and admin dashboard.
- **RTL layout** — every engine, the hub, search, settings, and the admin
  dashboard.
- **Content metadata** — `meta.lang` declares the language of each content
  item. Used for filtering and font loading.
- **AR webfont** — Noto Naskh Arabic, lazy-loaded when needed.

V2 i18n does NOT cover:

- **Content translation** — authors write content in whatever language they
  want. No auto-translation. (V2 anti-goal §5.7)
- **TTS audio** — no audio generation, no audio playback. (V2 anti-goal §5.8)
- **Languages beyond EN + AR** — the infrastructure is extensible, but only
  EN and AR bundles ship in V2.
- **Translation review queue** — there are no AI translations to review.

## Architecture

```mermaid
flowchart LR
    U[User opens PWA] --> D[Language Detection]
    D -->|browser lang| P[i18n.js\ninit]
    P --> B[Load bundle\nen.json or ar.json]
    B --> H[Apply to UI\nt() function]
    H --> R[Set dir attribute\nltr or rtl]
    R --> F[Load font\nInter or Noto Naskh Arabic]
```

The i18n layer is implemented in `src/lib/i18n.js` (V2 — Phase 11), which
wraps i18next:

- **Language detection** — checks (in order):
  1. `localStorage.osler_lang` (if set by the user via the language switcher)
  2. Firebase user's `displayName` language preference (if signed in)
  3. `navigator.language` (browser default)
  4. Fallback: `en`
- **Bundle loading** — fetches `src/i18n/{lang}.json` (or the bundled
  version from `i18n/{lang}.json` in the generated site).
- **String lookup** — exposes `t(key, opts)` for components to translate
  strings.
- **Direction** — sets `document.documentElement.dir` to `ltr` or `rtl`.
- **Font loading** — adds a `lang="{lang}"` attribute to `<html>` which
  triggers the CSS font-family fallback chain.

## The string bundles

UI strings live in `src/i18n/en.json` and `src/i18n/ar.json`. The
structure mirrors the component hierarchy:

```json
{
  "hub": {
    "title": "Osler",
    "search": "Search content...",
    "filterByTag": "Filter by tag",
    "noResults": "No content matches your search."
  },
  "quiz": {
    "start": "Start quiz",
    "next": "Next",
    "previous": "Previous",
    "submit": "Submit",
    "correct": "Correct!",
    "wrong": "Incorrect",
    "explanation": "Explanation",
    "results": {
      "title": "Quiz Results",
      "score": "You scored {{score}} out of {{total}}",
      "time": "Time: {{time}}",
      "pass": "Pass",
      "fail": "Fail"
    }
  },
  "aiTutor": {
    "title": "AI Tutor",
    "placeholder": "Ask a question about this item...",
    "send": "Send",
    "thinking": "Thinking...",
    "error": "Sorry, I couldn't get a response. Please try again."
  }
}
```

Keys are namespaced by feature (hub, quiz, bank, flashcard, written, osce,
aiTutor, common, settings, etc.). Nested objects are accessed via dot
notation: `t('quiz.results.score', { score: 8, total: 10 })`.

Placeholders use double-curly braces: `{{score}}`. The `opts` argument to
`t()` provides the values.

## The language switcher

Every page has a language switcher in the topbar:

- Hub: top-right corner, a globe icon with the current language code
  (`EN` or `AR`).
- Engine pages: top-right corner, same icon.
- Admin dashboard: top-right corner, same icon.

Clicking the switcher opens a dropdown with the two supported languages.
Selecting one:

1. Saves the choice to `localStorage.osler_lang`.
2. Reloads the page (the i18n layer re-initializes on load).
3. The `dir` attribute flips, layout reflows to RTL or LTR.
4. The font swaps (Inter → Noto Naskh Arabic or vice versa).

The reload is intentional — fully reactive i18n without a reload would
require a frontend framework, which V2 explicitly avoids (anti-goal §5.1).

## Content language filtering

The hub can filter content by language. A toggle in the hub settings:

> ☑ Only show content in my language

When enabled, the hub filters `items` where `meta.lang` matches the current
UI language. Items with `meta.lang === "mixed"` always show. Items with
`meta.lang === "other"` are filtered out (unless the toggle is off).

This is opt-in — the default is to show all content regardless of language.

## AR webfont

V2 uses Noto Naskh Arabic for Arabic text. It's chosen for:

- **Medical readability** — Naskh is the traditional script style for
  medical and scientific texts in Arabic.
- **Unicode coverage** — covers all Arabic characters used in medical
  terminology, including diacritics.
- **Free and open** — Google Fonts, OFL license.

Alternatives considered (see v2 plan open question §7.5):

- IBM Plex Arabic — modern, but less traditional.
- Cairo — geometric, less readable for long-form text.

The font is lazy-loaded: only when the UI language is set to Arabic (or
when an Arabic content item is rendered). This avoids the ~250 KB font
download for English-only users.

The font is precached in the service worker (so it's available offline
after the first load). The CSS uses `font-display: swap` to avoid FOIT
(flash of invisible text) — text renders in the fallback font first,
swaps to Noto Naskh when loaded.

## Engine-shared bridge

`engines/engine-shared.js` exposes the i18n layer to engines via
`window.OslerI18n`:

```javascript
// Inside an engine
const { t } = window.OslerI18n;
const title = t('quiz.start');
```

Engines should use `t()` for all user-facing strings, not hardcoded text.
Code review rejects PRs with hardcoded English strings in engines.

## Anti-goals

V2 i18n does NOT:

- **Auto-translate content** — authors write content in whatever language
  they want. The V1 3-stage AI pipeline can generate Arabic content if the
  prompt is in Arabic, but there's no auto-translation of existing content.
- **Provide TTS** — no audio generation, no audio playback, no audio cache.
  Authors who want audio narration must record it themselves (and there's
  no schema field for it in V2).
- **Support languages beyond EN + AR** — the i18n infrastructure (i18next,
  bundles, RTL) is extensible. Adding a new language is a matter of
  creating a new bundle file and adding the language code to the switcher.
  But V2 only ships EN and AR bundles.
- **Sync language preference across devices** — `localStorage.osler_lang`
  is per-device. The user might prefer English on their work laptop and
  Arabic on their personal phone. (V3 may sync via Firebase user profile.)

## What's next

- [Adding Strings](adding-strings.md) — how to add a new UI string.
- [RTL Guide](rtl-guide.md) — how to write CSS that works in both LTR and RTL.
