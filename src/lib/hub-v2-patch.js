/* ================================================================
   hub-v2-patch.js  —  V2 (Phase 10/11/12/14 integration)
   ----------------------------------------------------------------
   Patches the V1 hub (engines/index-engine.js) to add V2 features:
     - User content toolbar (Create / Export / Import buttons)
     - User content badges on item cards
     - Language switcher
     - First-run wizard + tour

   This file is loaded by index-engine.js AFTER V1 initialization.
   It calls into the V2 lib modules (which coexist with V1 libs).

   In a full V2 codebase, these features would be merged directly
   into index-engine.js. This patch file makes the V2 additions
   explicit and reviewable.
   ================================================================ */

import { renderHubToolbar, renderUserContentBadge } from './user-content-ui.js';
import { mountLanguageSwitcher } from './language-switcher.js';
import { maybeStartFirstRun } from './tour.js';
import { init as i18nInit, applyTranslations } from './i18n.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hub init — called by index-engine.js on hub load
// ─────────────────────────────────────────────────────────────────────────────

export function initV2Hub() {
  // 1. Initialize i18n (sets <html lang> + dir from localStorage)
  i18nInit();

  // 2. Mount the user content toolbar (Create / Export / Import)
  const hubHeader = document.querySelector('.hub-header, .hub-title, header');
  if (hubHeader) {
    renderHubToolbar(hubHeader);
  }

  // 3. Mount the language switcher
  mountLanguageSwitcher();

  // 4. Apply translations to all [data-i18n] elements
  applyTranslations();

  // 5. Add "Mine" badges to user content cards
  document.querySelectorAll('[data-content-card], .content-card').forEach(async (card) => {
    const uid = card.dataset.contentUid || card.dataset.uid;
    if (uid) {
      await renderUserContentBadge(card, uid);
    }
  });

  // 6. First-run wizard + tour
  maybeStartFirstRun();
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine init — called by each engine's init function
//
// Mounts the "Ask AI" button on every engine page (Phase 12).
// ─────────────────────────────────────────────────────────────────────────────

export async function initV2Engine(itemContext, itemUid) {
  // Lazy-load tutor-ui to keep the engine bundle small
  try {
    const { mountAskAiButton } = await import('./tutor-ui.js');
    await mountAskAiButton(itemContext, itemUid);
  } catch (e) {
    console.warn('[hub-v2-patch] tutor-ui mount failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine cleanup — called on engine unload
// ─────────────────────────────────────────────────────────────────────────────

export function cleanupV2Engine() {
  try {
    // Lazy-load + unmount
    import('./tutor-ui.js').then(({ unmountAskAiButton }) => {
      unmountAskAiButton();
    });
  } catch (e) {
    // Silent — engine unload shouldn't fail
  }
}

