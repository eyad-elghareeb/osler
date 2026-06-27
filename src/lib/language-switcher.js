/* ================================================================
   language-switcher.js  —  V2 (Phase 11)
   ----------------------------------------------------------------
   Language switcher component. Globe icon + dropdown with EN/AR.
   Mounts into the hub topbar and admin topbar.
   ================================================================ */

import { getCurrentLanguage, setLanguage, getSupportedLanguages, onChange } from './i18n.js';

const LANG_LABELS = {
  en: 'English',
  ar: 'العربية',
};

const LANG_CODES = {
  en: 'EN',
  ar: 'AR',
};

/**
 * Render a language switcher button.
 *
 * @param {HTMLElement} container — where to mount the switcher
 * @returns {void}
 */
export function renderLanguageSwitcher(container) {
  const switcher = document.createElement('div');
  switcher.className = 'lang-switcher';

  const button = document.createElement('button');
  button.className = 'lang-switcher-button';
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>
    <span class="lang-switcher-label">${LANG_CODES[getCurrentLanguage()] || 'EN'}</span>
  `;

  const dropdown = document.createElement('div');
  dropdown.className = 'lang-switcher-dropdown';
  dropdown.setAttribute('role', 'listbox');

  const langs = getSupportedLanguages();
  dropdown.innerHTML = langs.map(lang => `
    <button class="lang-switcher-option ${lang === getCurrentLanguage() ? 'active' : ''}"
            data-lang="${lang}"
            role="option"
            aria-selected="${lang === getCurrentLanguage()}">
      ${LANG_LABELS[lang] || lang}
    </button>
  `).join('');

  switcher.appendChild(button);
  switcher.appendChild(dropdown);
  container.appendChild(switcher);

  // Toggle dropdown
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!switcher.contains(e.target)) {
      dropdown.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    }
  });

  // Pick a language
  dropdown.querySelectorAll('.lang-switcher-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const lang = opt.dataset.lang;
      setLanguage(lang).catch(e => console.warn('[lang-switcher] setLanguage failed:', e));
    });
  });

  // Update on language change (defensive — setLanguage reloads the page,
  // so this listener fires only if reload is disabled in tests)
  onChange((newLang) => {
    button.querySelector('.lang-switcher-label').textContent = LANG_CODES[newLang] || 'EN';
    dropdown.querySelectorAll('.lang-switcher-option').forEach(opt => {
      const isActive = opt.dataset.lang === newLang;
      opt.classList.toggle('active', isActive);
      opt.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  });
}

/**
 * Mount the language switcher into the topbar.
 * Looks for an element with [data-lang-switcher] or .topbar-lang and
 * mounts there. Falls back to appending to document.body if no mount
 * point is found (useful for tests).
 */
export function mountLanguageSwitcher() {
  if (typeof document === 'undefined') return;

  const mount = document.querySelector('[data-lang-switcher], .topbar-lang');
  if (mount) {
    renderLanguageSwitcher(mount);
  } else {
    // Fallback: create a floating switcher in the top-right corner
    const fallback = document.createElement('div');
    fallback.style.position = 'fixed';
    fallback.style.top = '12px';
    fallback.style.insetInlineEnd = '12px';
    fallback.style.zIndex = '999';
    document.body.appendChild(fallback);
    renderLanguageSwitcher(fallback);
  }
}

// Auto-mount on DOMContentLoaded (browser only)
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountLanguageSwitcher);
  } else {
    mountLanguageSwitcher();
  }
}
