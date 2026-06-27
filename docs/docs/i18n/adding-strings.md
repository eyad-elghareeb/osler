# Adding i18n Strings

This page describes how to add a new UI string to the PWA or admin
dashboard, in both English and Arabic.

## Step 1 — Pick a key

Keys are namespaced by feature. Use the existing namespaces (hub, quiz,
bank, flashcard, written, osce, aiTutor, common, settings) or add a new
one if your feature is genuinely new.

Key naming conventions:

- `camelCase` for individual keys.
- Dot notation for nesting: `quiz.results.score`.
- Use descriptive names: `quiz.results.score` not `quiz.results.s`.
- Avoid abbreviations: `flashcard.dueIn` not `fc.di`.

Bad examples:

- `"q.start"` — too short, ambiguous
- `"Start Quiz"` — using the English text as the key (brittle if the text
  changes)
- `"button1"` — meaningless

Good examples:

- `"quiz.start"`
- `"flashcard.dueIn"`
- `"common.cancel"`
- `"settings.theme.dark"`

## Step 2 — Add the English string

Edit `src/i18n/en.json`. Add the key in the appropriate namespace:

```json
{
  "quiz": {
    "start": "Start quiz",
    "newField": "Your new string here"
  }
}
```

Guidelines for English strings:

- Use sentence case (not Title Case) for buttons and labels.
- Keep strings short — UI space is limited, especially in RTL.
- Avoid embedding HTML — use placeholders for dynamic values.
- Avoid concatenation in code (don't do `t('common.hello') + ' ' + name` —
  use `t('common.greeting', { name })` with `"greeting": "Hello, {{name}}"`).

## Step 3 — Add the Arabic string

Edit `src/i18n/ar.json`. Add the same key with the Arabic translation:

```json
{
  "quiz": {
    "start": "ابدأ الاختبار",
    "newField": "النص الجديد هنا"
  }
}
```

Guidelines for Arabic strings:

- Use Modern Standard Arabic (MSA) — not dialects.
- Match the tone of the English (formal / informal).
- For medical terms, prefer the Arabic medical term if it's commonly used
  (e.g. "أمراض القلب" for cardiology). If the English term is more common
  in Arabic medical education (e.g. "STEMI"), keep it in English.
- Keep the same number of placeholders ({{...}}) as the English string.
- RTL layout may need more or less space than English — test both layouts.

If you don't know Arabic, mark the string for translation in a GitHub
Issue with the `i18n-translation-needed` label. A native Arabic speaker
will fill it in. Until then, the Arabic bundle can fall back to English
(i18next's `fallbackLng: 'en'` is configured).

## Step 4 — Use the string in code

In PWA code:

```javascript
import { t } from '../lib/i18n.js';

const button = document.createElement('button');
button.textContent = t('quiz.start');
```

Or via the engine-shared bridge (inside an engine):

```javascript
const { t } = window.OslerI18n;
button.textContent = t('quiz.start');
```

In the admin dashboard frontend (HTML / JS):

```javascript
const { t } = window.OslerI18n;  // admin also loads the bridge
button.textContent = t('quiz.start');
```

## Step 5 — Use placeholders for dynamic values

If the string has dynamic values, use placeholders:

```json
{
  "quiz": {
    "results": {
      "score": "You scored {{score}} out of {{total}}"
    }
  }
}
```

```javascript
t('quiz.results.score', { score: 8, total: 10 });
// → "You scored 8 out of 10"
```

In Arabic:

```json
{
  "quiz": {
    "results": {
      "score": "حصلت على {{score}} من {{total}}"
    }
  }
}
```

```javascript
t('quiz.results.score', { score: 8, total: 10 });
// → "حصلت على 8 من 10"
```

## Step 6 — Handle plurals (if needed)

i18next supports pluralization. For English:

```json
{
  "common": {
    "items": "{{count}} item",
    "items_other": "{{count}} items"
  }
}
```

For Arabic (which has 6 plural forms):

```json
{
  "common": {
    "items_0": "لا توجد عناصر",
    "items_1": "عنصر واحد",
    "items_2": "عنصران",
    "items_few": "{{count}} عناصر",
    "items_many": "{{count}} عنصرًا",
    "items_other": "{{count}} عنصر"
  }
}
```

```javascript
t('common.items', { count: 0 });  // "لا توجد عناصر"
t('common.items', { count: 1 });  // "عنصر واحد"
t('common.items', { count: 2 });  // "عنصران"
t('common.items', { count: 5 });  // "5 عناصر"
```

Most strings don't need plurals. Use them only when the count is dynamic
and the singular/plural distinction matters.

## Step 7 — Test

1. Run `npm run build`.
2. Open the PWA in a browser.
3. Switch the language to English — verify your string renders.
4. Switch to Arabic — verify the Arabic string renders (or the English
   fallback if no translation yet).
5. Verify RTL layout doesn't break (see [RTL Guide](rtl-guide.md)).

For the admin dashboard:

1. `cd tauri-admin && cargo run`
2. Switch language in the topbar.
3. Verify the string renders in both languages.

## Step 8 — Add to the test fixture

`tests/fixtures/i18n-strings.json` lists every key that must have both EN
and AR translations. The CI test `tests/unit/lib/i18n.test.js` verifies
that every key in `en.json` also exists in `ar.json` (and vice versa).

When you add a key, add it to the fixture:

```json
{
  "requiredKeys": [
    "hub.title",
    "hub.search",
    "quiz.start",
    "quiz.newField"
  ]
}
```

If you don't have an Arabic translation yet, add the key with the value
`null` in `ar.json` — the test allows null values (treating them as
"translation needed") but fails on missing keys.

## Common pitfalls

### Hardcoded English in code

```javascript
// WRONG
button.textContent = 'Start quiz';
```

Code review rejects this. Use `t('quiz.start')` instead.

### Hardcoded English in HTML

```html
<!-- WRONG -->
<button>Start quiz</button>
```

The admin dashboard's HTML uses template literals that call `t()`:

```html
<button data-i18n="quiz.start"></button>
```

And a small loader on page load sets `textContent` from `t()`:

```javascript
document.querySelectorAll('[data-i18n]').forEach(el => {
  el.textContent = t(el.dataset.i18n);
});
```

### Concatenation

```javascript
// WRONG
toast.textContent = 'Score: ' + score + '/' + total;
```

This breaks i18n — different languages have different word orders. Use a
placeholder:

```javascript
toast.textContent = t('quiz.results.score', { score, total });
```

### Embedding HTML in strings

```json
{
  "quiz": {
    "explanation": "See <a href='{{url}}'>this reference</a> for more."
  }
}
```

This is fragile (the HTML structure is hardcoded in the string). Instead,
split into two strings and build the HTML in code:

```json
{
  "quiz": {
    "explanationPrefix": "See ",
    "explanationLink": "this reference",
    "explanationSuffix": " for more."
  }
}
```

```javascript
const html = `${t('quiz.explanationPrefix')}<a href='${url}'>${t('quiz.explanationLink')}</a>${t('quiz.explanationSuffix')}`;
```

(Or use a markdown renderer — see [Content Authoring → Content Types](../content-authoring/content-types.md#markdown-support).)

### Forgetting the engine-shared bridge

```javascript
// WRONG (won't work — engines don't have direct access to src/lib/)
import { t } from '../lib/i18n.js';
```

Inside an engine, use the bridge:

```javascript
const { t } = window.OslerI18n;
```

## What's next

- [Overview](overview.md) — i18n architecture.
- [RTL Guide](rtl-guide.md) — writing CSS that works in both directions.
