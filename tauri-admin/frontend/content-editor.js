(function () {
  'use strict';

  const STATE_KEY = 'content-editor-layout';

  function getPref(key) {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}')[key]; } catch { return null; }
  }
  function setPref(key, val) {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    s[key] = val;
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  }

  const threePaneEnabled = getPref('three-pane') || false;

  const THREE_PANE_CSS = `
    .ce-three-pane { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; height: 100%; min-height: 0; }
    .ce-three-pane .ce-editor-pane { display: flex; flex-direction: column; min-height: 0; }
    .ce-three-pane .ce-preview-pane { display: flex; flex-direction: column; min-height: 0; }
    .ce-three-pane #ce-json-editor { flex: 1; min-height: 200px; font-family: Consolas, 'Courier New', monospace; font-size: 0.85rem; line-height: 1.55; tab-size: 2; resize: none; }
    .ce-three-pane .ce-preview-frame { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-sm); background: #fff; width: 100%; min-height: 300px; }
    .ce-validation-badge { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.28rem 0.6rem; border-radius: 999px; font-size: 0.76rem; font-weight: 600; }
    .ce-validation-badge.valid { background: rgba(46,160,67,0.15); color: var(--correct); border: 1px solid rgba(46,160,67,0.3); }
    .ce-validation-badge.invalid { background: rgba(218,54,51,0.15); color: var(--wrong); border: 1px solid rgba(218,54,51,0.3); }
    .ce-validation-badge.pending { background: rgba(88,166,255,0.15); color: var(--blue); border: 1px solid rgba(88,166,255,0.3); }
    .ce-commit-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.75rem; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 0.75rem; flex-wrap: wrap; }
    .ce-commit-bar input { flex: 1; min-width: 120px; }
  `;

  let styleInjected = false;
  function injectStyles() {
    if (styleInjected) return;
    const s = document.createElement('style');
    s.textContent = THREE_PANE_CSS;
    document.head.appendChild(s);
    styleInjected = true;
  }

  function detectContentType(content) {
    try {
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      if (parsed.meta && parsed.meta.type) return parsed.meta.type;
      if (parsed.questions && Array.isArray(parsed.questions)) {
        if (parsed.questions[0] && parsed.questions[0].front) return 'flashcard';
        if (parsed.questions[0] && parsed.questions[0].children) return 'written';
        if (parsed.questions[0] && parsed.questions[0].stations) return 'osce';
        return 'quiz';
      }
      if (parsed.QUESTION_BANK) return 'bank';
      return null;
    } catch { return null; }
  }

  async function validateWithRust(contentType, contentJson) {
    try {
      const errors = await window.__TAURI__.core.invoke('validate_content', {
        content_type: contentType,
        content_json: typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson,
      });
      return { valid: errors.length === 0, errors };
    } catch (err) {
      return { valid: false, errors: [typeof err === 'string' ? err : err.message || 'Validation error'] };
    }
  }

  async function onValidateClick() {
    const badge = document.getElementById('ce-validation-badge');
    if (!badge) return;
    badge.className = 'ce-validation-badge pending';
    badge.textContent = 'Validating…';
    const raw = document.getElementById('ce-json-editor');
    if (!raw) return;
    const contentType = detectContentType(raw.value);
    if (!contentType) {
      badge.className = 'ce-validation-badge invalid';
      badge.textContent = 'Could not detect content type';
      return;
    }
    const result = await validateWithRust(contentType, raw.value);
    badge.className = 'ce-validation-badge ' + (result.valid ? 'valid' : 'invalid');
    badge.textContent = result.valid ? '✓ Valid' : result.errors.length + ' error(s)';
    const list = document.getElementById('ce-validation-list');
    if (list) {
      list.innerHTML = result.errors.map(e => `<div class="validation-item error">${escapeHtml(e)}</div>`).join('');
      list.style.display = result.errors.length ? 'block' : 'none';
    }
  }

  async function onCommitClick() {
    const msgInput = document.getElementById('ce-commit-message');
    const message = msgInput ? msgInput.value.trim() || 'Update content via admin' : 'Update content via admin';
    const btn = document.getElementById('ce-commit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Committing…'; }
    try {
      const result = await window.__TAURI__.core.invoke('git_commit', { message });
      if (btn) { btn.textContent = '✓ Committed'; btn.className = 'btn btn-primary'; }
      showToast('Commit successful', 'success');
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Commit'; }
      showToast('Commit failed: ' + (typeof err === 'string' ? err : err.message || 'Unknown error'), 'error');
    }
  }

  async function onPrClick() {
    const title = document.getElementById('ce-pr-title');
    const body = document.getElementById('ce-pr-body');
    const btn = document.getElementById('ce-pr-btn');
    if (!title || !body) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Creating PR…'; }
    try {
      const state = await window.__TAURI__.core.invoke('project_state');
      const remote = state.git && state.git.remote;
      const parsed = parseGithubRemote(remote || '');
      if (!parsed) {
        showToast('Could not determine GitHub remote. Push to GitHub first.', 'error');
        return;
      }
      const branch = state.git.branch || 'main';
      await window.__TAURI__.core.invoke('create_pr', {
        owner: parsed.owner,
        repo: parsed.repo,
        head: branch,
        base: 'main',
        title: title.value.trim() || 'Content update',
        body: body.value.trim() || 'Automated content update via Osler Admin',
        token: '',
      });
      if (btn) { btn.textContent = '✓ PR Created'; }
      showToast('Pull request created', 'success');
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Create PR'; }
      showToast('PR creation failed: ' + (typeof err === 'string' ? err : err.message || 'Unknown error'), 'error');
    }
  }

  function parseGithubRemote(remote) {
    const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
    if (m) return { owner: m[1], repo: m[2] };
    const m2 = remote.match(/https?:\/\/[^@/]+@github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
    if (m2) return { owner: m2[1], repo: m2[2] };
    return null;
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function showToast(message, tone) {
    const stack = document.getElementById('toast-stack') || (() => {
      const el = document.createElement('div');
      el.id = 'toast-stack';
      el.className = 'toast-stack';
      document.body.appendChild(el);
      return el;
    })();
    const t = document.createElement('div');
    t.className = 'toast ' + tone;
    t.textContent = message;
    stack.prepend(t);
    setTimeout(() => t.remove(), 3600);
  }

  async function onAnkiImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tsv,.csv,.txt';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const result = await window.__TAURI__.core.invoke('parse_json_questions', { content: text });
        if (result.questions && result.questions.length > 0) {
          const editor = document.getElementById('ce-json-editor');
          if (editor) {
            const current = JSON.parse(editor.value || '{}');
            if (!current.questions) current.questions = [];
            current.questions.push(...result.questions);
            editor.value = JSON.stringify(current, null, 2);
          }
          showToast('Imported ' + result.questions.length + ' questions from TSV', 'success');
        } else {
          showToast('No questions found in file. Try a standard TSV with front/back columns.', 'warn');
        }
      } catch (err) {
        showToast('Import failed: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
      }
    };
    input.click();
  }

  function toggleThreePane() {
    const newVal = !threePaneEnabled;
    setPref('three-pane', newVal);
    window.location.reload();
  }

  function renderCommitBar() {
    return `
      <div class="ce-commit-bar">
        <input id="ce-commit-message" class="text-input" type="text" placeholder="Commit message…" value="Update content via admin" style="flex:1;min-width:120px;">
        <button id="ce-commit-btn" class="btn btn-primary" onclick="(${onCommitClick.toString()})()">Commit</button>
        <button id="ce-pr-btn" class="btn" onclick="(${onPrClick.toString()})()">Create PR</button>
      </div>
    `;
  }

  function renderValidationStrip() {
    return `
      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
        <button class="mini-btn" onclick="(${onValidateClick.toString()})()">Validate</button>
        <span id="ce-validation-badge" class="ce-validation-badge pending">Not checked</span>
        <button class="mini-btn" onclick="(${onAnkiImport.toString()})()">Import Anki CSV</button>
        <button class="mini-btn" onclick="(${toggleThreePane.toString()})()">${threePaneEnabled ? 'Standard' : '3-Pane'} Layout</button>
      </div>
      <div id="ce-validation-list" style="display:none;"></div>
    `;
  }

  function injectEditorHooks() {
    injectStyles();
    const editorTab = document.querySelector('.tab-btn[onclick*="setTab(\'editor\'"]');
    if (editorTab) {
      const origSetTab = window.setTab;
      if (origSetTab) {
        const orig = origSetTab;
        window.setTab = function (tab) {
          orig.call(window, tab);
          if (tab === 'editor' && threePaneEnabled) {
            setTimeout(convertToThreePane, 50);
          }
        };
      }
    }
    const panel = document.getElementById('workspace-panel');
    if (panel) {
      const obs = new MutationObserver(() => {
        const textarea = document.getElementById('raw-html');
        if (textarea && document.querySelector('.ce-commit-bar') === null) {
          const commitBar = document.getElementById('ce-commit-bar');
          if (!commitBar) {
            const info = document.querySelector('.panel-header');
            if (info && info.nextElementSibling) {
              const div = document.createElement('div');
              div.innerHTML = renderCommitBar() + renderValidationStrip();
              info.parentNode.insertBefore(div.firstChild, info.nextSibling);
              info.parentNode.insertBefore(div.lastChild, info.nextSibling);
            }
          }
        }
      });
      obs.observe(panel, { childList: true, subtree: true });
    }
    const hash = window.location.hash;
    if (hash === '#content-editor' || hash === '#content-editor-3pane') {
      setTimeout(() => { if (threePaneEnabled) convertToThreePane(); }, 300);
    }
  }

  function convertToThreePane() {
    const panelBody = document.querySelector('.panel-body');
    if (!panelBody) return;
    const previewTab = document.querySelector('.tab-btn[onclick*="setTab(\'preview\'"]');
    if (previewTab) previewTab.click();
    setTimeout(() => {
      const previewContainer = document.getElementById('preview-frame-container');
      const editorContent = document.querySelector('.panel-body > textarea') || document.getElementById('raw-html');
      if (!previewContainer && !editorContent) return;
      const current = document.getElementById('raw-html') || document.querySelector('.panel-body textarea');
      if (!current) return;
      const rawContent = current.value;
      const wrapper = document.createElement('div');
      wrapper.className = 'ce-three-pane';
      wrapper.innerHTML = `
        <div class="ce-editor-pane">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:0.35rem;color:var(--text-muted);">JSON Editor</div>
          <textarea id="ce-json-editor" class="text-area code">${escapeHtml(rawContent)}</textarea>
        </div>
        <div class="ce-preview-pane">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:0.35rem;color:var(--text-muted);">Live Preview</div>
          <iframe class="ce-preview-frame" id="ce-preview-frame" src="${previewUrl(encodePath(state.currentFile))}?v=${Date.now()}"></iframe>
        </div>
      `;
      panelBody.innerHTML = '';
      panelBody.appendChild(wrapper);
      const editor = document.getElementById('ce-json-editor');
      if (editor) {
        editor.addEventListener('input', debounce(() => {
          const frame = document.getElementById('ce-preview-frame');
          if (frame) frame.src = frame.src;
        }, 1000));
      }
    }, 100);
  }

  function debounce(fn, ms) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  function encodePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }

  function previewUrl(filePath) {
    const port = window.__QUIZ_SERVER_PORT || 5500;
    return 'http://127.0.0.1:' + port + '/' + filePath;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectEditorHooks);
  } else {
    injectEditorHooks();
  }
})();
