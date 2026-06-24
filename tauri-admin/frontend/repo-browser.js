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
