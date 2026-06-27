# RTL Layout Guide

Arabic is a right-to-left (RTL) language. When the UI language switches to
Arabic, the entire layout flips: text reads right-to-left, navigation
moves to the opposite side, and directional spacing (margins, padding)
mirrors.

This page describes how to write CSS that works in both LTR and RTL
without per-rule overrides.

## The fundamental rule: use logical properties

CSS has both **physical** and **logical** properties. Physical properties
(`margin-left`, `padding-right`, `left`, `right`) refer to fixed directions.
Logical properties (`margin-inline-start`, `padding-inline-end`,
`inset-inline-start`, `inset-inline-end`) refer to the direction of text
flow — they automatically flip in RTL.

| Physical (avoid) | Logical (use) |
|------------------|---------------|
| `margin-left` | `margin-inline-start` |
| `margin-right` | `margin-inline-end` |
| `padding-left` | `padding-inline-start` |
| `padding-right` | `padding-inline-end` |
| `border-left` | `border-inline-start` |
| `border-right` | `border-inline-end` |
| `left` | `inset-inline-start` |
| `right` | `inset-inline-end` |
| `text-align: left` | `text-align: start` |
| `text-align: right` | `text-align: end` |
| `float: left` | `float: inline-start` |
| `float: right` | `float: inline-end` |

### Example

```css
/* WRONG — breaks in RTL */
.card {
  margin-left: 16px;
  padding-right: 24px;
  text-align: left;
}

/* CORRECT — works in both LTR and RTL */
.card {
  margin-inline-start: 16px;
  padding-inline-end: 24px;
  text-align: start;
}
```

When the `dir="rtl"` attribute is on `<html>`, the browser automatically
flips:

- `margin-inline-start` → right side (instead of left)
- `padding-inline-end` → left side (instead of right)
- `text-align: start` → right-aligned (instead of left)

## The `dir` attribute

The PWA sets `document.documentElement.dir = 'rtl'` (or `'ltr'`) on
language switch. This is the only thing that triggers RTL — there's no
RTL-specific CSS class.

```html
<!-- English -->
<html lang="en" dir="ltr">
  <!-- layout is LTR -->
</html>

<!-- Arabic -->
<html lang="ar" dir="rtl">
  <!-- layout is RTL -->
</html>
```

## Block-level layout

Block-level layout (flexbox, grid) usually works in RTL without changes —
the browser handles direction. But there are gotchas.

### Flexbox

Flexbox respects `dir` for `flex-direction: row`:

```css
.row {
  display: flex;
  flex-direction: row;  /* LTR: left-to-right. RTL: right-to-left. */
  gap: 16px;
}
```

In LTR, the first child appears on the left. In RTL, the first child
appears on the right. This is usually what you want.

If you explicitly want a fixed direction regardless of UI language (rare —
e.g. a progress bar that always fills left-to-right):

```css
.progress {
  display: flex;
  flex-direction: row;  /* always LTR */
  direction: ltr;       /* override inherited RTL */
}
```

Use this sparingly — overriding direction is confusing for RTL users.

### Grid

CSS Grid respects `dir` for column order:

```css
.grid {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
}
```

In LTR, the first column is on the left. In RTL, the first column is on
the right. This is usually correct.

### Positioning

Avoid absolute positioning where possible. When needed, use logical
properties:

```css
/* WRONG */
.badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

/* CORRECT */
.badge {
  position: absolute;
  top: 8px;
  inset-inline-end: 8px;
}
```

## Icons

Icons are the trickiest part of RTL. Some icons are directional (e.g.
"back arrow", "next arrow") and need to flip in RTL. Others are
non-directional (e.g. "trash", "settings") and should NOT flip.

### Directional icons — flip in RTL

The "back" arrow (← in LTR) should become (→) in RTL, because in RTL the
"back" direction is right-to-left.

Two ways to flip:

1. **CSS transform** — apply `transform: scaleX(-1)` in RTL:

   ```css
   .icon-back {
     /* LTR: arrow pointing left */
   }

   [dir="rtl"] .icon-back {
     transform: scaleX(-1);  /* flip horizontally */
   }
   ```

2. **Different icon** — use a different SVG in RTL:

   ```html
   <svg class="icon-back-ltr" ...><!-- ← arrow --></svg>
   <svg class="icon-back-rtl" ...><!-- → arrow --></svg>
   ```

   ```css
   .icon-back-rtl { display: none; }
   [dir="rtl"] .icon-back-ltr { display: none; }
   [dir="rtl"] .icon-back-rtl { display: block; }
   ```

The first approach (CSS transform) is simpler and preferred for icons
that are simple shapes. The second approach is needed for icons with
asymmetric details.

### Non-directional icons — don't flip

Icons like "trash", "settings", "search", "user" should NOT flip — they're
meaningful in both directions. Use them as-is.

### Osler's icon convention

Osler's icon library (`src/lib/icons.js`) marks directional icons with a
`directional: true` flag. The icon renderer automatically flips these in
RTL via `transform: scaleX(-1)`.

```javascript
export const icons = {
  back: { svg: '...', directional: true },
  next: { svg: '...', directional: true },
  trash: { svg: '...', directional: false },
  settings: { svg: '...', directional: false },
};
```

## Numbers and dates

Numbers and dates in Arabic content are typically rendered in Western
Arabic numerals (0-9), not Eastern Arabic numerals (٠-٩). This matches
medical education convention — medical literature in Arabic uses Western
numerals.

Don't transform numbers in i18n. The number "8" should render as "8" in
both English and Arabic.

Dates should be formatted via `Intl.DateTimeFormat` with the appropriate
locale:

```javascript
new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(new Date());
// → "٢٧ يونيو ٢٠٢٦" (in some locales) or "27 يونيو 2026"
```

Osler uses `Intl.DateTimeFormat('ar-EG', ...)` for consistency (Egypt is
the largest Arabic medical education market).

## Fonts

The PWA loads different fonts for different languages:

```css
html[lang="en"] body {
  font-family: 'Inter', sans-serif;
}

html[lang="ar"] body {
  font-family: 'Noto Naskh Arabic', 'Inter', sans-serif;
}
```

The fallback chain is important — Noto Naskh Arabic doesn't include
Latin characters, so English text in Arabic content (e.g. acronyms like
"STEMI") falls back to Inter via per-glyph font fallback.

The AR font is lazy-loaded:

```css
@font-face {
  font-family: 'Noto Naskh Arabic';
  src: url('/assets/fonts/noto-naskh-arabic.woff2') format('woff2');
  font-display: swap;  /* text renders in fallback first, swaps when loaded */
}
```

The font URL is precached in the service worker so it's available offline
after the first load.

## Testing RTL

### Manual test

1. Open the PWA.
2. Switch the language to Arabic (topbar globe icon → AR).
3. The UI should flip to RTL.
4. Walk through every page:

   - Hub
   - Each engine (quiz, bank, flashcard, written, osce)
   - Search
   - Settings
   - AI tutor (Phase 12)
   - First-run tour

5. Look for:

   - Text overflowing containers (Arabic text may be wider or narrower
     than English).
   - Icons not flipping when they should (back/next arrows).
   - Icons flipping when they shouldn't (trash, settings).
   - Layout breaking (e.g. absolutely-positioned elements landing in the
     wrong place).
   - Misaligned text (e.g. `text-align: left` hardcoded instead of `start`).

### Automated test

Phase 11.2 will add a Playwright E2E spec that runs every existing test in
both LTR and RTL. Until then, run the existing E2E suite manually with
`?lang=ar` in the URL:

```bash
# Start the dev server
npm run build
python3 -m http.server 5500 --directory dist

# Run Playwright with Arabic locale
npx playwright test --base-url=http://127.0.0.1:5500/?lang=ar
```

## Common RTL bugs

### Bug: hardcoded `text-align: left`

```css
.title {
  text-align: left;  /* stays left even in RTL — looks wrong */
}
```

Fix: use `text-align: start`.

### Bug: hardcoded `margin-left` on icon

```css
.icon {
  margin-left: 8px;  /* wrong side in RTL */
}
```

Fix: use `margin-inline-end: 8px` (if the icon is at the start of a row,
the margin should be at the end — i.e. between the icon and the next
element).

### Bug: progress bar fills the wrong way

```css
.progress-fill {
  position: absolute;
  left: 0;  /* always starts from the left, even in RTL */
  width: 50%;
}
```

In RTL, the user expects the progress bar to fill from right to left.
Fix: use `inset-inline-start: 0`.

### Bug: dropdown menu opens on the wrong side

```css
.dropdown-menu {
  position: absolute;
  right: 0;  /* opens to the left of the trigger — wrong in RTL */
  top: 100%;
}
```

Fix: use `inset-inline-end: 0` — the menu opens on the "end" side of the
trigger, which flips in RTL.

### Bug: SVG icon doesn't flip

Directional SVG icons (back, next, previous, forward) need to flip in RTL.
Use `transform: scaleX(-1)` in a `[dir="rtl"]` selector.

### Bug: third-party library breaks

Libraries like CodeMirror (used in the admin content editor) may not fully
support RTL. Test thoroughly. If a library doesn't support RTL, either:

- Find an alternative that does.
- Wrap the library's container in `direction: ltr` (forcing LTR for that
  element only — only acceptable for code editors where the content is
  always LTR).
- File a bug with the library and wait for a fix.

## What's next

- [Overview](overview.md) — i18n architecture.
- [Adding Strings](adding-strings.md) — how to add new UI strings.
- [Coding Conventions → Logical CSS properties](../development/coding-conventions.md#14-logical-css-properties-for-rtl)
  — the rule that mandates logical properties.
