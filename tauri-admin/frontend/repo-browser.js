(function () {
  'use strict';

  function initRepoBrowser() {
    const searchInput = document.getElementById('file-search');
    if (!searchInput) return;

    const browserKey = 'repo-browser-mode';
    const isBrowser = localStorage.getItem(browserKey) === 'true';

    const toggle = document.createElement('button');
    toggle.className = 'mini-btn';
    toggle.textContent = isBrowser ? 'Tree View' : 'GitHub View';
    toggle.title = 'Toggle between file tree and GitHub-style browser';
    toggle.style.cssText = 'position:absolute;right:0.35rem;top:0.35rem;z-index:2;';
    toggle.onclick = function () {
      const newMode = !isBrowser;
      localStorage.setItem(browserKey, newMode ? 'true' : 'false');
      window.location.reload();
    };

    const searchWrap = searchInput.closest('.search-wrap') || searchInput.parentElement;
    if (searchWrap) {
      searchWrap.style.position = 'relative';
      searchWrap.appendChild(toggle);
      const reviewFilter = document.createElement('button');
      reviewFilter.className = 'mini-btn';
      reviewFilter.textContent = 'Needs Review';
      reviewFilter.title = 'Filter files flagged as needing review';
      reviewFilter.style.cssText = 'position:absolute;right:6.5rem;top:0.35rem;z-index:2;font-size:0.72rem;';
      reviewFilter.onclick = async function () {
        const rows = document.querySelectorAll('.tree-row');
        let found = 0;
        reviewFilter.textContent = 'Scanning…';
        // Phase 6.5 fix #7: previously this filter grepped `row.dataset.path`
        // for the literal strings 'aiQualityAlert' / 'Needs Review' — which
        // never appear in filesystem paths, so the filter always returned 0.
        // Now we open each JSON file, parse it, and inspect `meta.aiQualityAlert`
        // / `meta.aiQualityScore` — the actual fields set by content-gen.js.
        for (const row of rows) {
          const path = row.dataset.path || '';
          // Only check JSON files (skip HTML / folders / dotfiles).
          if (!path.endsWith('.json')) {
            row.style.display = 'none';
            continue;
          }
          let isNeedsReview = false;
          try {
            const content = await window.__TAURI__.core.invoke('load_file', { path });
            const parsed = JSON.parse(content);
            const alert = parsed?.meta?.aiQualityAlert;
            const score = parsed?.meta?.aiQualityScore;
            if (alert === 'Needs Review' || (typeof score === 'number' && score < 0.7)) {
              isNeedsReview = true;
            }
          } catch (e) {
            // File isn't valid JSON or load_file failed — skip silently.
            // Don't hide the row, just don't mark it as needing review.
          }
          if (isNeedsReview) {
            row.style.display = 'flex';
            row.style.background = 'rgba(218,54,51,0.08)';
            found++;
          } else {
            row.style.display = 'none';
          }
        }
        reviewFilter.textContent = found > 0 ? found + ' need review' : 'Needs Review';
        if (found === 0) {
          setTimeout(function () { reviewFilter.textContent = 'Needs Review'; }, 1500);
        }
      };
      searchWrap.appendChild(reviewFilter);
    }

    if (isBrowser) {
      enhanceFileTree();
    }
  }

  function enhanceFileTree() {
    const treeRoot = document.getElementById('file-tree-root');
    if (!treeRoot) return;
    const obs = new MutationObserver(function () {
      const folders = treeRoot.querySelectorAll('.folder-area');
      folders.forEach(function (folder) {
        if (folder.dataset.browsed) return;
        folder.dataset.browsed = '1';
        const nameEl = folder.querySelector('.tree-name');
        if (!nameEl) return;
        const countEl = document.createElement('span');
        countEl.className = 'badge';
        countEl.style.cssText = 'font-size:0.65rem;margin-left:0.35rem;flex-shrink:0;';
        const items = folder.closest('li') ? folder.closest('li').querySelectorAll(':scope > ul .tree-row').length : 0;
        countEl.textContent = items + ' items';
        nameEl.parentNode.insertBefore(countEl, nameEl.nextSibling);
        nameEl.style.fontWeight = '600';
      });
      const files = treeRoot.querySelectorAll('.tree-row:not(.folder-area)');
      files.forEach(function (file) {
        if (file.dataset.browsed) return;
        file.dataset.browsed = '1';
        const badge = file.querySelector('.tree-type-dot');
        if (badge) {
          const typeLabel = document.createElement('span');
          typeLabel.className = 'badge';
          typeLabel.style.cssText = 'font-size:0.6rem;margin-left:0.25rem;flex-shrink:0;';
          const cls = badge.className;
          if (cls.includes('type-quiz')) typeLabel.textContent = 'quiz';
          else if (cls.includes('type-bank')) typeLabel.textContent = 'bank';
          else if (cls.includes('type-flashcard')) typeLabel.textContent = 'flash';
          else if (cls.includes('type-written')) typeLabel.textContent = 'written';
          else if (cls.includes('type-osce')) typeLabel.textContent = 'osce';
          else if (cls.includes('type-index')) typeLabel.textContent = 'index';
          else typeLabel.textContent = 'html';
          file.appendChild(typeLabel);
        }
      });
    });
    obs.observe(treeRoot, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRepoBrowser);
  } else {
    initRepoBrowser();
  }
})();
