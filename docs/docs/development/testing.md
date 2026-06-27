# Testing

Osler V2 has four test layers. Each layer catches a different class of bug,
and CI runs them in order — earlier layers are faster and fail sooner.

## The four layers

| Layer | Runner | What it catches | Speed | CI gate |
|-------|--------|-----------------|-------|---------|
| Build | `node src/build.js` (esbuild) | Syntax errors, missing imports, broken bundler config | ~3s | Always |
| Unit + integration | Vitest | Logic bugs in `src/lib/*`, sync merge strategies, storage adapter | ~10s | Always |
| Content validation | `node scripts/validate-content.js` (ajv) | Schema violations in `content/*.json` | ~1s | Always |
| Schema validation | `node scripts/validate-schemas.js` (ajv meta) | Malformed JSON Schema files in `src/schemas/` | ~1s | Always |
| E2E | Playwright (Chromium) | Full user flows — auth, study session, CMS, bundle push | ~5 min | On `main` only |

## Running tests locally

### One-shot check

```bash
npm run check
```

Runs build + unit/integration + content validation + schema validation. Use
this before every commit.

### Individual layers

```bash
npm run build              # 1. Build
npm test                   # 2. Unit + integration (Vitest, run mode)
npm run test:watch         # 2b. Vitest watch mode (for TDD)
npm run validate           # 3. Content validation
npm run validate-schemas   # 4. Schema validation
npm run test:e2e           # 5. E2E (Playwright, Chromium only by default)
```

### E2E cross-browser

By default E2E runs on Chromium only. To run on Firefox and WebKit:

```bash
npx playwright install firefox webkit
npx playwright test --project=firefox --project=webkit
```

Cross-browser E2E is not run in CI (cost + flakiness). Run it locally before
release.

## Vitest configuration

`vitest.config.js` configures the test environment:

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.js'],
    },
  },
});
```

`tests/setup.js` installs:

- `fake-indexeddb` — in-memory IndexedDB mock for storage tests
- `happy-dom` — DOM implementation (faster than jsdom, sufficient for our needs)
- `localStorage` / `caches` / `fetch` polyfills as needed

## Unit tests

Unit tests live in `tests/unit/lib/` (one `.test.js` file per `src/lib/`
module) and `tests/unit/sync/` (sync-specific tests). Each test file imports
the module under test and exercises its public API.

Example structure (from `tests/unit/lib/sm2.test.js`):

```javascript
import { describe, it, expect } from 'vitest';
import { sm2 } from '../../../src/lib/sm2.js';

describe('sm2.schedule', () => {
  it('schedules a new card for tomorrow on first review', () => {
    const result = sm2.schedule({ ease: 2.5, interval: 0, reps: 0 }, 4);
    expect(result.interval).toBe(1);
    expect(result.reps).toBe(1);
    expect(result.due).toBeInstanceOf(Date);
  });

  it('multiplies interval by ease on correct review', () => {
    const result = sm2.schedule({ ease: 2.5, interval: 6, reps: 3 }, 4);
    expect(result.interval).toBe(15); // 6 * 2.5
  });

  // ... more tests
});
```

Aim for:

- One `describe` block per public function.
- At least one happy-path test, one edge-case test, one error-case test per
  function.
- No network calls (mock `fetch` if the module uses it).
- No real IndexedDB (use `fake-indexeddb` from setup).
- No real timers (use `vi.useFakeTimers()` if the module uses `setTimeout`).

## Integration tests

Integration tests live in `tests/integration/` and exercise multiple modules
together against a more realistic environment. Two notable suites:

- `storage.test.js` — IndexedDB end-to-end with `fake-indexeddb`, exercising
  the full storage adapter (open, put, get, getAll, delete, quota).
- `sync-adapter.test.js` — Firestore sync with a mock backend, exercising all
  5 merge strategies (appendOnly, fieldMergeByUpdatedAt, sm2Merge,
  lwwBodyKeepTitles, maxStreak).

Integration tests are slower than unit tests but still complete in <2 seconds.

## Content validation

`npm run validate` runs `node scripts/validate-content.js`, which:

1. Loads every schema in `src/schemas/` into an `ajv` instance.
2. Reads the schema registry from `src/schemas/_meta.json`.
3. For each file in `content/`:
   - Reads the file's `meta.schemaVersion`.
   - Looks up the corresponding schema in the registry.
   - Validates the file against that schema.
   - Reports any validation errors with file + path + message.

If any content file fails validation, the script exits non-zero and CI fails.

To validate a single file manually:

```bash
npx ajv validate -s src/schemas/quiz-v1.json -d content/sample-quiz.json
```

## Schema validation

`npm run validate-schemas` runs `node scripts/validate-schemas.js`, which
validates that every schema file in `src/schemas/` is itself a well-formed
JSON Schema (using ajv's meta-schema). This catches typos in schema definitions
before they break content validation.

## E2E tests

E2E tests live in `tests/e2e/` and use Playwright. They spin up a real browser
(Chromium by default) and exercise the full PWA against a local server. The
current E2E suite covers:

- `anki-csv.spec.js` — Anki CSV import flow
- `bank-session.spec.js` — Bank engine study session
- `content-gen.spec.js` — AI content generation (mocked Gemini)
- `firebase-auth.spec.js` — Firebase auth (guest → Google → GitHub, with
  mocked Firebase)
- `flashcard-study.spec.js` — Flashcard SM-2 study session
- `github-cms.spec.js` — Admin dashboard CMS workflow (mocked GitHub API)
- `osce-simulation.spec.js` — OSCE engine case walkthrough
- `player.spec.js` — Audio/video player (V1 legacy, kept for back-compat)
- `quiz-session.spec.js` — Quiz engine timed session
- `update-bundle.spec.js` — Bundle update flow (admin → instance)
- `update-push.spec.js` — Tier 2 update push (signed bundle)
- `written-assessment.spec.js` — Written engine assessment

V2 will add E2E specs for: generate site, deploy to each provider, author user
content, export/import content pack, AI tutor chat, RTL layout.

## Playwright configuration

`playwright.config.js`:

```javascript
module.exports = {
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:5500',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'python3 -m http.server 5500 --directory dist',
    port: 5500,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
};
```

The `webServer` config auto-starts a static server on port 5500 serving
`dist/`. In CI, `reuseExistingServer: false` ensures a fresh server per run.

## Writing a new E2E test

1. Identify the user flow you're testing.
2. Create `tests/e2e/{flow-name}.spec.js`.
3. Use `page.goto()`, `page.click()`, `page.fill()` to drive the browser.
4. Use `expect(page.locator(...)).toHaveText(...)` to assert.
5. Mock external APIs (`page.route()`) — never hit real Firebase, GitHub, or
   Gemini from E2E.
6. Run `npm run test:e2e -- --grep {flow-name}` to run just your test.

Example skeleton:

```javascript
import { test, expect } from '@playwright/test';

test.describe('Quiz session', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('text=Sample Quiz');
  });

  test('completes a 5-question quiz', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.click('[data-option-index="0"]');
      await page.click('text=Next');
    }
    await expect(page.locator('[data-results]')).toBeVisible();
  });
});
```

## Test fixtures

Shared fixtures live in `tests/fixtures/`. The most common is
`sample-quiz.json` — a minimal valid quiz used across multiple E2E specs.
Add new fixtures here, not inline in test files.

## Coverage

Vitest coverage is configured to report on `src/lib/**/*.js`. The current
coverage baseline (V1 ship):

- Statements: ~85%
- Branches: ~75%
- Functions: ~90%
- Lines: ~85%

V2 targets maintaining these numbers (no regression) — not increasing them.
Coverage is reported locally but not enforced in CI.

## What's next

- [Contributing](contributing.md) — branch model and PR checklist.
- [Troubleshooting → Common Issues](../troubleshooting/common-issues.md) —
  what to do when tests fail.
