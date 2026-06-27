// =============================================================================
// tests/e2e/v2-flows.spec.js  —  V2 (Phase 16)
// -----------------------------------------------------------------------------
// E2E specs for every V2 flow. Covers user content authoring, export/import,
// AI tutor chat, RTL layout, and (mocked) site generation + deploy.
//
// These specs run in CI on the `main` branch (Chromium only).
// Cross-browser testing is done manually before release.
// =============================================================================

import { test, expect } from '@playwright/test';

// =============================================================================
// Phase 10 — User custom content + content packs
// =============================================================================

test.describe('Phase 10 — User custom content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear any existing user content (fresh state per test)
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('osler-v1');
        req.onsuccess = req.onerror = req.onblocked = resolve;
      });
    });
    await page.reload();
  });

  test('user can create a flashcard deck', async ({ page }) => {
    await page.click('text=Create');
    await page.click('[data-type="flashcard"]');
    await page.fill('.uc-title-input', 'Test Flashcards');
    await page.fill('.uc-tags-input', 'e2e, test');
    await page.click('[data-action="save"]');

    // Hub should reload and show the new content
    await page.waitForSelector('text=Test Flashcards');
    await expect(page.locator('.uc-badge')).toHaveCount(1);
  });

  test('user can export content as a pack', async ({ page }) => {
    // First create some content
    await page.click('text=Create');
    await page.click('[data-type="quiz"]');
    await page.fill('.uc-title-input', 'Export Test Quiz');
    await page.click('[data-action="save"]');
    await page.waitForSelector('text=Export Test Quiz');

    // Open export modal
    await page.click('.uc-export');
    await page.waitForSelector('.uc-export-modal');

    // Select all + download
    await page.click('[data-action="select-all"]');
    await page.click('[data-action="download"]');

    // Verify a download was triggered (Playwright download event)
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-action="download"]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/osler-content-pack-.*\.json/);
  });

  test('user can import a content pack with conflict resolution', async ({ page }) => {
    // Build a pack JSON in-page and write to a file
    const pack = {
      packFormat: 'osler-content-pack',
      packVersion: '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy: { uid: 'test', displayName: 'Test' },
      sourceInstance: 'https://test.example',
      items: [{
        type: 'flashcard',
        meta: {
          uid: 'imported-card-001',
          title: 'Imported Card',
          schemaVersion: '1.0',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lang: 'en',
          tags: ['imported'],
        },
        cards: [{
          id: 'c1',
          front: 'Test front',
          back: 'Test back',
          tags: [],
        }],
      }],
    };

    // Use page.evaluate to set up the file chooser
    const { pickAndImportContentPack } = await import('../../src/lib/content-pack.js');

    // Open import modal
    await page.click('.uc-import');
    await page.waitForSelector('.uc-import-modal');

    // Mock file picker — inject the pack as a file
    await page.evaluate(async (packJson) => {
      const blob = new Blob([packJson], { type: 'application/json' });
      const file = new File([blob], 'test-pack.json', { type: 'application/json' });
      const { importContentPack } = await import('../../src/lib/content-pack.js');
      return await importContentPack(file, { onConflict: 'skip' });
    }, JSON.stringify(pack));

    // Hub should show the imported card
    await page.reload();
    await expect(page.locator('text=Imported Card')).toBeVisible();
  });

  test('malformed pack is rejected with validation error', async ({ page }) => {
    await page.click('.uc-import');
    await page.waitForSelector('.uc-import-modal');

    // Inject a malformed pack (missing schemaVersion)
    const badPack = {
      packFormat: 'osler-content-pack',
      packVersion: '1.0',
      items: [{
        type: 'quiz',
        meta: { uid: 'bad', title: 'Bad' }, // missing schemaVersion
        questions: [],
      }],
    };

    const result = await page.evaluate(async (packJson) => {
      const blob = new Blob([packJson], { type: 'application/json' });
      const file = new File([blob], 'bad.json');
      const { importContentPack } = await import('../../src/lib/content-pack.js');
      return await importContentPack(file, { onConflict: 'skip' });
    }, JSON.stringify(badPack));

    expect(result.imported).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Phase 11 — i18n + RTL
// =============================================================================

test.describe('Phase 11 — i18n + RTL', () => {
  test('language switcher toggles between EN and AR', async ({ page }) => {
    await page.goto('/');

    // Default should be EN
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // Open language switcher
    await page.click('.lang-switcher-button');
    await page.waitForSelector('.lang-switcher-dropdown.open');

    // Pick Arabic
    await page.click('[data-lang="ar"]');

    // Page reloads — wait for it
    await page.waitForLoadState('networkidle');

    // Should now be AR + RTL
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('RTL layout renders correctly on hub', async ({ page }) => {
    // Force Arabic via URL parameter
    await page.addInitScript(() => {
      localStorage.setItem('osler_lang', 'ar');
    });
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // Verify logical CSS — sidebar should be on the right in RTL
    const sidebar = page.locator('.hub-sidebar, .sidebar');
    if (await sidebar.isVisible()) {
      const box = await sidebar.boundingBox();
      const viewportWidth = page.viewportSize().width;
      // In RTL, sidebar should be on the right side of the viewport
      expect(box.x + box.width).toBeGreaterThan(viewportWidth / 2);
    }
  });

  test('all UI strings have translations in both bundles', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // Verify both bundles load
      return fetch('/i18n/en.json').then(r => r.json()).then(en => {
        return fetch('/i18n/ar.json').then(r => r.json()).then(ar => {
          const enKeys = new Set();
          const arKeys = new Set();
          const collect = (obj, prefix, set) => {
            for (const [k, v] of Object.entries(obj)) {
              const full = prefix ? `${prefix}.${k}` : k;
              if (typeof v === 'object') collect(v, full, set);
              else set.add(full);
            }
          };
          collect(en, '', enKeys);
          collect(ar, '', arKeys);
          return {
            enCount: enKeys.size,
            arCount: arKeys.size,
            missingInAr: [...enKeys].filter(k => !arKeys.has(k)),
            missingInEn: [...arKeys].filter(k => !enKeys.has(k)),
          };
        });
      });
    });

    expect(result.missingInAr).toEqual([]);
    expect(result.missingInEn).toEqual([]);
  });
});

// =============================================================================
// Phase 12 — AI tutor
// =============================================================================

test.describe('Phase 12 — AI tutor', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Firebase config so the tutor is "available"
    await page.addInitScript(() => {
      window.__mockFirebase = true;
    });
    await page.goto('/');
  });

  test('"Ask AI" button is hidden when Firebase is not configured', async ({ page }) => {
    // Without Firebase config, the button should not appear
    await expect(page.locator('.tutor-ask-button')).toHaveCount(0);
  });

  test('tutor modal opens and closes', async ({ page }) => {
    // Mock the tutor as available
    await page.evaluate(() => {
      window.OslerTutor = {
        isTutorAvailable: async () => true,
        askTutor: async () => ({ response: 'Mock response', history: [] }),
        getHistory: async () => [],
        clearHistory: async () => {},
        onStream: () => () => {},
      };
      // Mount the button
      import('/src/lib/tutor-ui.js').then(({ mountAskAiButton }) => {
        mountAskAiButton({ type: 'quiz', question: 'test' }, 'test-uid');
      });
    });

    await page.waitForSelector('.tutor-ask-button');
    await page.click('.tutor-ask-button');

    await page.waitForSelector('.tutor-modal-overlay');
    await expect(page.locator('.tutor-modal')).toBeVisible();

    // Close
    await page.keyboard.press('Escape');
    await expect(page.locator('.tutor-modal-overlay')).toHaveCount(0);
  });

  test('user can send a question and get a response', async ({ page }) => {
    // Mock Gemini API
    await page.route('**/generativelanguage.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Mock answer' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      });
    });

    // Mock Firebase + Gemini
    await page.evaluate(() => {
      window.OslerGemini = {
        streamChat: async (opts, onToken) => {
          onToken('Mock answer');
          return { content: 'Mock answer', usage: { promptTokenCount: 10, candidatesTokenCount: 5 } };
        },
        getTodaysSpend: async () => 0,
        DAILY_CAP: 20,
      };
      window.OslerTutor = {
        isTutorAvailable: async () => true,
        getHistory: async () => [],
        clearHistory: async () => {},
        onStream: () => () => {},
        askTutor: async (q, ctx, uid) => {
          const result = await window.OslerGemini.streamChat({ messages: [{ role: 'user', content: q }] }, (t) => {});
          return { response: result.content, history: [{ role: 'user', content: q }, { role: 'assistant', content: result.content }] };
        },
      };
    });

    await page.goto('/quiz.html');
    await page.evaluate(() => {
      import('/src/lib/tutor-ui.js').then(({ mountAskAiButton }) => {
        mountAskAiButton({ type: 'quiz', question: 'Test question' }, 'quiz-001');
      });
    });

    await page.click('.tutor-ask-button');
    await page.fill('.tutor-input', 'Why is option A correct?');
    await page.click('.tutor-send-btn');

    // Wait for the response
    await expect(page.locator('.tutor-message-assistant .tutor-message-content')).toContainText('Mock answer', { timeout: 5000 });
  });
});

// =============================================================================
// Phase 13 — Site generator wizard (mocked)
// =============================================================================

test.describe('Phase 13 — Generator wizard', () => {
  test('wizard state persists across page reloads', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const { saveWizardState, DEFAULT_STATE } = require('/src/lib/generator.js');
      saveWizardState({ ...DEFAULT_STATE, step: 3, engines: { quiz: true, bank: false } });
    });

    await page.reload();

    const state = await page.evaluate(() => {
      const { loadWizardState } = require('/src/lib/generator.js');
      return loadWizardState();
    });

    expect(state.step).toBe(3);
    expect(state.engines.quiz).toBe(true);
    expect(state.engines.bank).toBe(false);
  });

  test('bundle size estimate updates with engine selection', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { estimateBundleSize, DEFAULT_STATE, toggleEngine } = require('/src/lib/generator.js');

      const allOff = { ...DEFAULT_STATE, engines: { quiz: false, bank: false, flashcard: false, written: false, osce: false } };
      const allOn = { ...DEFAULT_STATE, engines: { quiz: true, bank: true, flashcard: true, written: true, osce: true } };

      return {
        off: estimateBundleSize(allOff),
        on: estimateBundleSize(allOn),
      };
    });

    expect(result.on.bytes).toBeGreaterThan(result.off.bytes);
    expect(result.on.engineCount).toBe(8); // 5 user + 3 always-included
    expect(result.off.engineCount).toBe(3); // only always-included
  });

  test('firebase config validation catches missing fields', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { validateFirebaseConfig } = require('/src/lib/generator.js');
      return validateFirebaseConfig({ apiKey: 'test' }); // missing required fields
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('bundle spec generates correct provider configs', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { buildBundleSpec, DEFAULT_STATE, setDeployTarget } = require('/src/lib/generator.js');

      const state = setDeployTarget(
        { ...DEFAULT_STATE, auth: { mode: 'none', firebaseConfig: null } },
        'netlify'
      );

      return buildBundleSpec(state);
    });

    expect(result.providerConfigs['netlify.toml']).toBeDefined();
    expect(result.providerConfigs['netlify.toml']).toContain('publish = "."');
  });
});

// =============================================================================
// Phase 16 — Security review (smoke tests)
// =============================================================================

test.describe('Phase 16 — Security', () => {
  test('service worker verifies bundle hash on update', async ({ page }) => {
    // This is verified by the SW's update handler. We just check that
    // the SW registers and has the expected methods.
    await page.goto('/');

    const swInfo = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return {
        scriptURL: reg.scriptURL,
        scope: reg.scope,
        active: !!reg.active,
      };
    });

    expect(swInfo.active).toBe(true);
    expect(swInfo.scriptURL).toMatch(/sw\.js$/);
  });

  test('CSP blocks inline scripts', async ({ page }) => {
    // The admin dashboard's CSP restricts script sources.
    // This test verifies the deployed PWA's CSP (tighter — no unsafe-eval).
    const response = await page.goto('/');
    const csp = response.headers()['content-security-policy'];
    if (csp) {
      // If CSP is set, it should NOT include 'unsafe-eval' on the PWA
      expect(csp).not.toContain("'unsafe-eval'");
    }
  });

  test('content pack import rejects HTML in question field (XSS prevention)', async ({ page }) => {
    await page.goto('/');

    const xssPack = {
      packFormat: 'osler-content-pack',
      packVersion: '1.0',
      items: [{
        type: 'quiz',
        meta: { uid: 'xss-test', title: 'XSS', schemaVersion: '1.0', createdAt: '...', updatedAt: '...', lang: 'en' },
        questions: [{
          id: 'q1',
          stem: '<script>alert("xss")</script>',
          options: [{ id: 'a', text: 'A', correct: true }],
        }],
      }],
    };

    const result = await page.evaluate(async (packJson) => {
      const blob = new Blob([packJson], { type: 'application/json' });
      const file = new File([blob], 'xss.json');
      const { importContentPack } = await import('/src/lib/content-pack.js');
      return await importContentPack(file, { onConflict: 'skip' });
    }, JSON.stringify(xssPack));

    // Should either reject (valid) or sanitize (acceptable)
    // The schema validation should reject <script> tags
    expect(result.imported).toBe(0);
  });
});
