# Lib Modules API Reference

Osler V2's `src/lib/` directory contains 21 modules. This page is a
per-module API reference. For implementation details, read the source
files.

## `analytics.js`

V20 analytics taxonomy. Validates and sends events to Firebase Analytics.

### API

```javascript
import { analytics } from '../lib/analytics.js';

analytics.track('quiz_answer', {
  contentType: 'quiz',          // required, must be in V20 enum
  contentUid: 'cardio-001',     // required
  questionId: 'q1',             // optional
  outcome: 'correct',           // required, must be in V20 enum
  timeSpentMs: 12500,           // optional
});

analytics.setUserProperty('cohort', 'med-student-2026');

analytics.reset();  // clear user (on sign-out)
```

### V20 taxonomy

- `contentType`: `quiz` | `bank` | `flashcard` | `written` | `osce`
- `outcome`: `correct` | `wrong` | `skipped` | `rating_1` | `rating_2` |
  `rating_3` | `rating_4` | `null`

Unknown values trigger a `console.warn` and the event is sent with
`outcome: null` (so we can detect bad data in Firebase Analytics).

## `anki.js`

Anki CSV import/export. Converts between Anki's plain-text deck format
and Osler's flashcard JSON.

### API

```javascript
import { anki } from '../lib/anki.js';

// Import: Anki CSV → Osler flashcard JSON
const flashcardJson = anki.importFromCsv(csvText, {
  frontColumn: 0,
  backColumn: 1,
  tagsColumn: 2,
  deckTitle: 'Imported from Anki',
});

// Export: Osler flashcard JSON → Anki CSV
const csvText = anki.exportToCsv(flashcardJson, {
  includeTags: true,
});
```

CSV format expected: tab-separated, one card per line, with columns for
front, back, and (optionally) tags.

## `auth.js`

Firebase Authentication wrapper. Guest → Google → GitHub, with account
linking.

### API

```javascript
import { auth } from '../lib/auth.js';

// Sign-in methods
await auth.signInAnonymously();      // guest mode
await auth.signInWithGoogle();       // OAuth
await auth.signInWithGitHub();       // OAuth

// Account linking (preserves guest data on OAuth upgrade)
await auth.linkGoogleAccount();
await auth.linkGitHubAccount();

// State
const user = auth.currentUser;       // null if signed out
const isGuest = auth.isGuest();      // true if anonymous

// Sign out
await auth.signOut();                // returns to guest mode

// Listener
auth.onAuthStateChanged((user) => {
  console.log('Auth state changed:', user);
});
```

Account linking is automatic on OAuth sign-in from a guest account. The
`link()` API preserves the guest's tracker data under the new permanent
UID.

## `content-gen.js`

3-stage Gemini AI content generation pipeline.

### API

```javascript
import { contentGen, DAILY_CAP, MONTHLY_CAP } from '../lib/content-gen.js';

const result = await contentGen.generate({
  topic: 'cardiac arrhythmias',
  type: 'quiz',
  count: 20,
  difficulty: 'medium',
  language: 'en',
  additionalContext: 'Focus on ECG interpretation.',
});

// result: { items: [...], cost: 0.015, stages: [...] }
```

### Exports

- `DAILY_CAP = 20` — USD per day
- `MONTHLY_CAP = 200` — USD per month
- `contentGen.generate(opts)` — async, returns the generated items
- `contentGen.estimateCost(opts)` — sync, returns estimated cost before
  generation
- `contentGen.getTodaysSpend()` — sync, returns today's USD total
- `contentGen.getMonthlySpend()` — sync, returns this month's USD total

See [Admin Dashboard → AI Content Generation](../admin-dashboard/content-generation.md)
for the full pipeline description.

## `content-loader.js`

Fetches and caches content JSON files.

### API

```javascript
import { contentLoader } from '../lib/content-loader.js';

const quiz = await contentLoader.load('quiz', 'cardio-arrhythmias-001');
// Returns the parsed JSON, or throws on failure.

const manifest = await contentLoader.loadManifest();
// Returns the parsed manifest.json.

contentLoader.prefetch(['quiz', 'cardio-arrhythmias-001']);
// Pre-fetches and caches a content item.
```

The loader uses the service worker's Cache Storage API for offline
access. If the network fails and the content is cached, the cached
version is returned.

## `dom.js`

DOM helpers. Used to avoid the verbosity of `document.querySelector`.

### API

```javascript
import { $, $$, create, on, delegate } from '../lib/dom.js';

const button = $('.save-button');          // querySelector
const items = $$('.item');                  // querySelectorAll

const el = create('button', {
  class: 'btn btn-primary',
  textContent: 'Save',
  onClick: () => save(),
});

on(document, 'click', '.item', (e) => {
  console.log('Item clicked:', e.target);
});  // event delegation
```

## `firebase.js`

Firebase app initialization. Auth + Firestore + Storage + Analytics.

### API

```javascript
// Internal — initialized at app startup
import { firebaseApp, auth, db, storage, analytics } from '../lib/firebase.js';
```

The init reads from `import.meta.env.VITE_FIREBASE_*` (web app) or
`config.json` (deployed site). If Firebase config is missing, the modules
return null and Firebase-dependent features are disabled.

## `gemini.js`

Gemini API client. Used by both content-gen and the AI tutor.

### API

```javascript
import { gemini } from '../lib/gemini.js';

// Single call
const response = await gemini.chat({
  model: 'flash-lite',
  system: 'You are a medical tutor.',
  messages: [
    { role: 'user', content: 'Why is option B wrong?' }
  ],
});
// response: { content: '...', usage: { prompt_tokens, completion_tokens }, cost: 0.001 }

// Streaming
await gemini.streamChat({
  model: 'flash-lite',
  system: '...',
  messages: [...],
}, (chunk) => {
  console.log('Chunk:', chunk);
});

// Cost tracking
gemini.getTodaysSpend();
gemini.getMonthlySpend();
```

The client handles:

- Cost cap enforcement (refuses calls that would exceed caps).
- Retry with exponential backoff on 429 / 5xx.
- Error mapping (network / auth / quota / unknown).
- Cost computation (based on usage + per-model rates).

## `i18n.js`

i18next wrapper. Language detection, bundle loading, RTL toggle. (V2 —
Phase 11)

### API

```javascript
import { t, setLanguage, getCurrentLanguage } from '../lib/i18n.js';

t('quiz.start');                                    // "Start quiz" / "ابدأ الاختبار"
t('quiz.results.score', { score: 8, total: 10 });   // "You scored 8 out of 10"

await setLanguage('ar');                            // sets localStorage, reloads
const lang = getCurrentLanguage();                  // 'en' or 'ar'
```

## `icons.js`

SVG icon library. Inline icons, no external icon font.

### API

```javascript
import { icons } from '../lib/icons.js';

const svg = icons.render('back', { size: 24, class: 'icon' });
// Returns an SVG string.

document.body.insertAdjacentHTML('beforeend', svg);
```

Each icon has a `directional: true` flag — directional icons are
auto-flipped in RTL via `transform: scaleX(-1)`.

## `install-prompt.js`

PWA install prompt handler.

### API

```javascript
import { installPrompt } from '../lib/install-prompt.js';

installPrompt.onAvailable(() => {
  // Show "Install" button
});

installPrompt.onDismissed(() => {
  // Hide "Install" button
});

await installPrompt.prompt();  // shows the browser's install prompt
```

## `keyboard.js`

Keyboard shortcut registration.

### API

```javascript
import { keyboard } from '../lib/keyboard.js';

keyboard.on('Ctrl+S', () => save());
keyboard.on('1-5', (e, num) => selectOption(num));
keyboard.on('Escape', () => closeModal());
```

Shortcuts are scoped to the active element (or document if no element is
focused).

## `migration.js`

V0 → V1 storage migration. One-time, idempotent.

### API

```javascript
import { migration } from '../lib/migration.js';

await migration.runIfNeeded();
// Returns immediately if already migrated.
```

The migration reads `localStorage.osler_migrated_v1`. If `true`, no-op.
Otherwise, runs the migration (updates IndexedDB schema, moves data) and
sets the flag.

Errors are logged to `localStorage.osler_migration_errors_v1` (for
debugging) and to the console.

## `quota.js`

IndexedDB quota management.

### API

```javascript
import { quota } from '../lib/quota.js';

const usage = await quota.estimate();
// { usage: 50000000, quota: 1000000000 } — bytes

const isNearLimit = quota.isNearLimit();   // true if usage > 80% of quota
```

When `isNearLimit`, the PWA shows a warning toast: "Storage almost full.
Export your data to free up space."

## `sm2.js`

SM-2 spaced repetition algorithm.

### API

```javascript
import { sm2 } from '../lib/sm2.js';

const newState = sm2.schedule(
  { ease: 2.5, interval: 6, reps: 3, lapses: 0 },
  4   // rating: 1=Again, 2=Hard, 3=Good, 4=Easy
);
// newState: { ease: 2.65, interval: 20, reps: 4, lapses: 0, due: Date, lastReviewed: Date }

const isDue = sm2.isDue({ due: '2026-06-27T10:00:00Z' });
```

See [Engines → Flashcard → SM-2 algorithm details](../engines/flashcard.md#sm-2-algorithm-details)
for the full algorithm.

## `storage.js`

IndexedDB wrapper. Per-type tracker tables.

### API

```javascript
import { STORE_NAMES, storage } from '../lib/storage.js';

// STORE_NAMES is a frozen map:
// { quizTracker, bankTracker, flashcardTracker, writtenTracker, osceTracker, userContent, ... }

await storage.put(STORE_NAMES.quizTracker, { itemId: 'q1', outcome: 'correct' });
const record = await storage.get(STORE_NAMES.quizTracker, 'q1');
const all = await storage.getAll(STORE_NAMES.quizTracker);
await storage.delete(STORE_NAMES.quizTracker, 'q1');

const usage = await storage.estimate();
```

## `sync-utils.js`

Single source of truth for `getDeviceId()`.

### API

```javascript
import { getDeviceId } from '../lib/sync-utils.js';

const deviceId = getDeviceId();
// Reads from localStorage.osler_device_id (creates if missing).
```

Both `sync.js` and `analytics.js` use this. Do NOT duplicate the device
ID logic.

## `sync.js`

Firestore sync layer. 5 merge strategies.

### API

```javascript
import { sync } from '../lib/sync.js';

await sync.push();            // push local changes to Firestore
await sync.pull();            // pull remote changes to IndexedDB
await sync.forceSync();       // push + pull
sync.startAutoSync();         // sync every 60 seconds + on connectivity change
sync.stopAutoSync();

sync.onConflict((conflict) => {
  console.log('Conflict:', conflict);
});
```

See [Firebase → Sync Strategies](../firebase/sync-strategies.md) for the
merge strategies.

## `theme.js`

Light/dark/system theme toggle.

### API

```javascript
import { theme } from '../lib/theme.js';

theme.set('dark');              // 'light' / 'dark' / 'system'
theme.get();                    // current setting
theme.resolved();               // actual applied theme ('light' or 'dark')
theme.onChange((t) => { ... }); // listener
```

## `toast.js`

Toast notifications.

### API

```javascript
import { toast } from '../lib/toast.js';

toast.show('Saved', { type: 'success', duration: 3000 });
toast.show('Error', { type: 'error' });
toast.show('Warning', { type: 'warning' });
toast.show('Info', { type: 'info' });
```

Toasts use `aria-live="polite"` for accessibility. Only one toast shows
at a time; subsequent toasts queue.

## `tracker.js`

Per-type tracker (quiz/bank/flashcard/written/osce).

### API

```javascript
import { tracker } from '../lib/tracker.js';

await tracker.record('quiz', 'cardio-001', 'q1', { outcome: 'correct', timeSpentMs: 12500 });
const history = await tracker.getHistory('quiz', 'cardio-001', 'q1');
const summary = await tracker.getSummary('quiz', 'cardio-001');
// { correctCount: 5, wrongCount: 2, lastReviewed: Date }
```

## `ui.js`

Shared UI primitives.

### API

```javascript
import { ui } from '../lib/ui.js';

ui.toast('Saved', { type: 'success' });
ui.modal({ title: 'Confirm', content: '...', buttons: [...] });
ui.dropdown({ trigger: button, items: [...] });
ui.progress({ value: 0.5 });
ui.spinner();
```

## `validate.js`

JSON Schema validation.

### API

```javascript
import { validate, validatePack } from '../lib/validate.js';

const result = validate(contentJson);
// { valid: true } | { valid: false, errors: [...] }

const packResult = validatePack(packJson);
// { valid: true, items: [...] } | { valid: false, errors: [...], items: [...] }
```

See [Content Authoring → Validation](../content-authoring/validation.md)
for the validation contract.

## What's next

- [Project Structure](../development/project-structure.md) — where each
  module lives.
- [Coding Conventions](../development/coding-conventions.md) — the rules
  for working with these modules.
- [Tauri Commands](tauri-commands.md) — the admin's Rust-side commands.
