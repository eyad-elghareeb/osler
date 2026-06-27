/* ================================================================
   tour.js  —  V2 (Phase 14)
   ----------------------------------------------------------------
   In-app interactive tour using shepherd.js (V2 plan K12).

   Two tours:
     - adminTour   — 5-step tour for first-time admin dashboard users
     - pwaTour     — 5-step tour for first-time PWA users

   The tour is shown on first run (detected via localStorage flag)
   and can be re-triggered from Settings → Help → Replay tour.

   shepherd.js is loaded lazily (dynamic import) so it doesn't bloat
   the initial bundle for users who skip the tour.
   ================================================================ */

import { t } from './i18n.js';

const TOUR_SEEN_KEY = 'osler_tour_seen';
const TOUR_VERSION = 'v2'; // bump when tour content changes — re-shows to existing users

// ─────────────────────────────────────────────────────────────────────────────
// Tour definitions
// ─────────────────────────────────────────────────────────────────────────────

const PWA_TOUR_STEPS = [
  {
    element: '.hub-title, .hub-header, h1',
    title: t('tour.step1Title', null, 'Browse content'),
    text: t('tour.step1Desc', null, 'Pick a quiz, flashcard deck, or other content from the hub.'),
    buttons: ['next'],
  },
  {
    element: '.content-card, .quiz-card, [data-content-card]',
    title: t('tour.step2Title', null, 'Study'),
    text: t('tour.step2Desc', null, 'Answer questions, rate flashcards, or take notes. Your progress is saved automatically.'),
    buttons: ['back', 'next'],
  },
  {
    element: '.user-content-toolbar, [data-action="create"]',
    title: t('tour.step3Title', null, 'Create your own'),
    text: t('tour.step3Desc', null, 'Click Create to author your own quizzes and flashcards.'),
    buttons: ['back', 'next'],
  },
  {
    element: '[data-lang-switcher], .auth-area, .topbar-auth',
    title: t('tour.step4Title', null, 'Sync across devices'),
    text: t('tour.step4Desc', null, 'Sign in to sync your progress and custom content across devices.'),
    buttons: ['back', 'next'],
  },
  {
    element: '.tutor-ask-button, .tutor-button',
    title: t('tour.step5Title', null, 'Ask the AI tutor'),
    text: t('tour.step5Desc', null, 'Click Ask AI on any item to get a contextual explanation.'),
    buttons: ['back', 'done'],
  },
];

const ADMIN_TOUR_STEPS = [
  {
    element: '.sidebar-content, [data-tab="content"]',
    title: 'Content tab',
    text: 'Author and manage admin-managed content (quizzes, flashcards, etc.) here.',
    buttons: ['next'],
  },
  {
    element: '.sidebar-generate, [data-tab="generate"]',
    title: 'Generate tab',
    text: 'Use the 3-stage Gemini pipeline to generate draft content from a topic.',
    buttons: ['back', 'next'],
  },
  {
    element: '.sidebar-sites, [data-tab="sites"]',
    title: 'Sites tab (V2)',
    text: 'Use the generator wizard to assemble a deployable site bundle.',
    buttons: ['back', 'next'],
  },
  {
    element: '.sidebar-deploy, [data-tab="deploy"]',
    title: 'Deploy tab (V2)',
    text: 'Deploy a generated bundle to GitHub Pages, Netlify, Vercel, or Cloudflare Pages.',
    buttons: ['back', 'next'],
  },
  {
    element: '.sidebar-settings, [data-tab="settings"]',
    title: 'Settings tab',
    text: 'Configure GitHub, Firebase, AI generation, deploy providers, and signing keys.',
    buttons: ['back', 'done'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// First-run detection
// ─────────────────────────────────────────────────────────────────────────────

export function hasSeenTour() {
  try {
    const seen = localStorage.getItem(TOUR_SEEN_KEY);
    return seen === TOUR_VERSION;
  } catch {
    return false;
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_VERSION);
  } catch (e) {
    console.warn('[tour] markTourSeen failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tour runner
//
// Loads shepherd.js lazily, then runs the tour. If shepherd.js fails to
// load (network issue, blocked), the tour silently skips — the user can
// still use the app without it.
// ─────────────────────────────────────────────────────────────────────────────

let _shepherdPromise = null;

async function loadShepherd() {
  if (_shepherdPromise) return _shepherdPromise;

  _shepherdPromise = (async () => {
    try {
      // Try CDN first (smaller bundle for the main app)
      const mod = await import('https://cdn.jsdelivr.net/npm/shepherd.js@11/dist/shepherd.esm.js');
      // Load CSS too
      if (typeof document !== 'undefined') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/shepherd.js@11/dist/css/shepherd.css';
        document.head.appendChild(link);
      }
      return mod.default || mod.Shepherd || mod;
    } catch (e) {
      console.warn('[tour] shepherd.js failed to load from CDN:', e);
      // Fallback to npm-installed version (admin dashboard bundles it)
      try {
        const mod = await import('shepherd.js');
        return mod.default || mod.Shepherd || mod;
      } catch (e2) {
        console.warn('[tour] shepherd.js fallback also failed:', e2);
        return null;
      }
    }
  })();

  return _shepherdPromise;
}

export async function startTour(tourType = 'pwa') {
  const Shepherd = await loadShepherd();
  if (!Shepherd) {
    console.warn('[tour] shepherd.js unavailable — skipping tour');
    return;
  }

  const steps = tourType === 'admin' ? ADMIN_TOUR_STEPS : PWA_TOUR_STEPS;

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      cancelIcon: { enabled: true },
      classes: 'osler-tour',
      scrollTo: { behavior: 'smooth', block: 'center' },
    },
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const buttons = [];

    if (step.buttons.includes('back')) {
      buttons.push({
        text: t('tour.next', null, 'Back'), // reuse translation
        action: tour.back,
        classes: 'shepherd-button-secondary',
      });
    }

    if (step.buttons.includes('next')) {
      buttons.push({
        text: t('tour.next', null, 'Next'),
        action: tour.next,
      });
    }

    if (step.buttons.includes('done')) {
      buttons.push({
        text: t('tour.done', null, 'Done'),
        action: tour.complete,
      });
    }

    // Skip button on every step
    buttons.push({
      text: t('tour.skip', null, 'Skip tour'),
      action: tour.cancel,
      classes: 'shepherd-button-secondary',
      secondary: true,
    });

    tour.addStep({
      id: `step-${i + 1}`,
      element: step.element,
      title: step.title,
      text: step.text,
      buttons,
      // If the element doesn't exist on the page, show the step centered
      // (no highlight) instead of crashing.
      ...(step.element ? {} : { attachTo: { element: 'body', on: 'center' } }),
    });
  }

  // Mark seen when the tour completes or is cancelled
  tour.on('complete', markTourSeen);
  tour.on('cancel', markTourSeen);

  tour.start();
}

/**
 * Start the PWA tour on first run.
 * Called by the hub on DOMContentLoaded.
 */
export function maybeStartPwaTour() {
  if (!hasSeenTour()) {
    // Slight delay so the page is fully rendered before the tour starts
    setTimeout(() => {
      startTour('pwa').catch(e => console.warn('[tour] startTour failed:', e));
    }, 800);
  }
}

/**
 * Start the admin tour on first run.
 * Called by the admin dashboard on first launch.
 */
export function maybeStartAdminTour() {
  if (!hasSeenTour()) {
    setTimeout(() => {
      startTour('admin').catch(e => console.warn('[tour] startTour failed:', e));
    }, 800);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// First-run wizard (PWA only)
//
// A 3-step onboarding modal shown on first launch:
//   1. Pick language (EN / AR)
//   2. Pick content (optional — link to a content pack to import)
//   3. Start studying (closes the wizard + starts the tour)
// ─────────────────────────────────────────────────────────────────────────────

const FIRST_RUN_KEY = 'osler_first_run_done';

export function hasDoneFirstRun() {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markFirstRunDone() {
  try {
    localStorage.setItem(FIRST_RUN_KEY, 'true');
  } catch (e) {
    console.warn('[tour] markFirstRunDone failed:', e);
  }
}

export function startFirstRunWizard() {
  if (hasDoneFirstRun()) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay first-run-overlay';
  overlay.innerHTML = `
    <div class="modal first-run-modal">
      <div class="modal-header">
        <h2>${t('tour.welcome', null, 'Welcome to Osler')}</h2>
      </div>
      <div class="modal-body">
        <p>${t('tour.welcomeDesc', null, 'Let\'s take a quick tour of the key features.')}</p>

        <div class="first-run-step" data-step="1">
          <h3>1. ${t('settings.language', null, 'Language')}</h3>
          <div class="first-run-lang-options">
            <button class="btn btn-primary" data-lang="en">English</button>
            <button class="btn btn-secondary" data-lang="ar">العربية</button>
          </div>
        </div>

        <div class="first-run-step" data-step="2">
          <h3>2. Import content (optional)</h3>
          <p>If you have a content pack (.json), import it now. Otherwise, you can do this later.</p>
          <button class="btn btn-secondary" data-action="import">Import pack...</button>
          <button class="btn btn-link" data-action="skip-import">Skip</button>
        </div>

        <div class="first-run-step" data-step="3">
          <h3>3. ${t('tour.done', null, 'Ready to study')}</h3>
          <button class="btn btn-primary" data-action="finish">Start studying</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Step 1: language
  overlay.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      // setLanguage reloads the page, so the rest of the wizard runs on reload
      try {
        const { setLanguage } = await import('./i18n.js');
        await setLanguage(lang);
      } catch (e) {
        console.warn('[first-run] setLanguage failed:', e);
      }
    });
  });

  // Step 2: import (lazy load content-pack.js)
  overlay.querySelector('[data-action="import"]').addEventListener('click', async () => {
    try {
      const { pickAndImportContentPack } = await import('./content-pack.js');
      const result = await pickAndImportContentPack({ onConflict: 'skip' });
      alert(`Imported ${result.imported} item(s).`);
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    }
  });

  overlay.querySelector('[data-action="skip-import"]').addEventListener('click', () => {
    // No-op — just continue
  });

  // Step 3: finish
  overlay.querySelector('[data-action="finish"]').addEventListener('click', () => {
    markFirstRunDone();
    overlay.remove();
    // Start the tour after the wizard closes
    setTimeout(() => startTour('pwa'), 500);
  });
}

/**
 * Run first-run setup if needed. Called on hub load.
 */
export function maybeStartFirstRun() {
  if (!hasDoneFirstRun()) {
    setTimeout(() => {
      startFirstRunWizard();
    }, 500);
  } else if (!hasSeenTour()) {
    // First run done but tour not seen — show tour
    maybeStartPwaTour();
  }
}
