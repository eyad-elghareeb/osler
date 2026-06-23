/* ================================================================
   engine-shared.js  —  Shared utilities for all QuizTool engines.
   Load this BEFORE the individual engine file.
   Auto-detects its own base URL so it works at any folder depth.
   ================================================================ */
(function () {
  'use strict';

  var _cs = document.currentScript;
  var ENGINE_BASE = _cs ? _cs.src.replace(/[^\/]*$/, '') : '';
  var ROOT_BASE = ENGINE_BASE.replace(/[^\/]+\/$/, '');

  /* ── CSS variables (injected inline so they're available synchronously) ── */
  var CSS_VARS = `:root {
  --bg:         #0d1117;
  --surface:    #161b22;
  --surface2:   #1c2330;
  --border:     #30363d;
  --text:       #e6edf3;
  --text-muted: #8b949e;
  --accent:     #f0a500;
  --accent-dim: rgba(240,165,0,0.12);
  --correct:    #2ea043;
  --correct-bg: rgba(46,160,67,0.12);
  --wrong:      #da3633;
  --wrong-bg:   rgba(218,54,51,0.12);
  --flagged:    #58a6ff;
  --flagged-bg: rgba(88,166,255,0.12);
  --skip:       #6e7681;
  --radius:     12px;
  --shadow:     0 4px 24px rgba(0,0,0,0.4);
  --transition: 0.2s ease-out;
  --transition-fast: 0.12s ease-out;
  --transition-slow: 0.35s ease-out;
  --nav-size:   280px;
}
[data-theme="light"] {
  --bg:         #f3f0eb;
  --surface:    #ffffff;
  --surface2:   #f8f6f1;
  --border:     #d0ccc5;
  --text:       #1c1917;
  --text-muted: #78716c;
  --accent:     #c27803;
  --accent-dim: rgba(194,120,3,0.10);
  --correct:    #16a34a;
  --correct-bg: rgba(22,163,74,0.10);
  --wrong:      #dc2626;
  --wrong-bg:   rgba(220,38,38,0.10);
  --flagged:    #2563eb;
  --flagged-bg: rgba(37,99,235,0.10);
  --shadow:     0 4px 24px rgba(0,0,0,0.10);
}`;

  /* ── Initialise theme before any engine code runs ── */
  var savedTheme = localStorage.getItem('quiz-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.body.style.background = savedTheme === 'light' ? '#f3f0eb' : '#0d1117';
  document.body.style.color = savedTheme === 'light' ? '#1c1917' : '#e6edf3';
  document.body.style.overflow = 'hidden';

  /* ── Inject CSS variables ── */
  (function() {
    var s = document.createElement('style');
    s.textContent = CSS_VARS;
    document.head.appendChild(s);
  })();

  /* ── Exposed module ── */
  window.EngineShared = {
    ENGINE_BASE: ENGINE_BASE,

    /* ── Head asset helpers ──────────────────────────────── */
    _addLink: function(rel, href, extra) {
      var el = document.createElement('link');
      el.rel = rel; el.href = href;
      if (extra) Object.assign(el, extra);
      document.head.appendChild(el);
    },

    _addMeta: function(name, content) {
      var m = document.createElement('meta');
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
    },

    _addStyle: function(css) {
      var s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    },

    /* ── Theme colour meta + shared CSS + PWA assets ──────── */
    initHead: function() {
      var root = ENGINE_BASE + '../';
      EngineShared._addMeta('theme-color', '#0d1117');
      EngineShared._addLink('stylesheet', ENGINE_BASE + 'engine-shared.css');
      EngineShared._addLink('preconnect', 'https://fonts.googleapis.com');
      EngineShared._addLink('preconnect', 'https://fonts.gstatic.com', {crossOrigin: ''});
      EngineShared._addLink('stylesheet', 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
      EngineShared._addLink('manifest',   root + 'manifest.webmanifest');
      EngineShared._addLink('icon',       root + 'favicon.svg', {type: 'image/svg+xml'});
      EngineShared._addLink('apple-touch-icon', root + 'favicon.svg');
    },

    /* ── HTML escaping ────────────────────────────────────── */
    escHtml: function(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    /* ── Theme toggle ──────────────────────────────────────── */
    toggleTheme: function() {
      var html = document.documentElement;
      var isDark = html.getAttribute('data-theme') === 'dark';
      var newTheme = isDark ? 'light' : 'dark';
      html.setAttribute('data-theme', newTheme);
      document.body.style.background = '';
      document.body.style.color = '';
      var themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) themeMeta.content = newTheme === 'light' ? '#f3f0eb' : '#0d1117';
      localStorage.setItem('quiz-theme', newTheme);
      EngineShared.updateThemeIcon();
    },

    updateThemeIcon: function() {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.querySelectorAll('.theme-toggle-btn').forEach(function(btn) {
        btn.textContent = isDark ? '\u2600' : '\u263E';
      });
    },

    /* ── Toast / notification ──────────────────────────────── */
    _toastTimer: null,

    showToast: function(msg, actions) {
      if (actions === undefined) actions = [];
      var t = document.getElementById('toast');
      t.innerHTML = '';
      var msgSpan = document.createElement('span');
      msgSpan.textContent = msg;
      msgSpan.style.flex = '1';
      t.appendChild(msgSpan);
      if (actions.length > 0) {
        var container = document.createElement('div');
        container.style.cssText = 'display:flex;gap:0.5rem;margin-left:0.75rem;';
        actions.forEach(function(action) {
          var btn = document.createElement('button');
          btn.textContent = action.label;
          btn.style.cssText = 'padding:0.35rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:' + (action.primary ? 'var(--accent)' : 'var(--surface2)') + ';color:' + (action.primary ? '#000' : 'var(--text)') + ';font-size:0.75rem;font-weight:600;cursor:pointer;transition:all var(--transition);';
          btn.onclick = function() { action.onClick(); t.classList.remove('show'); };
          btn.onmouseenter = function() {
            if (!action.primary) { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; }
          };
          btn.onmouseleave = function() {
            if (!action.primary) { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--text)'; }
          };
          container.appendChild(btn);
        });
        t.appendChild(container);
      }
      t.classList.add('show');
      clearTimeout(EngineShared._toastTimer);
      if (actions.length === 0) {
        EngineShared._toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2200);
      }
    },

    /* ── Navigation ────────────────────────────────────────── */
    navigateToIndex: function(event) {
      if (event) event.preventDefault();
      window.location.href = 'index.html';
    },

    /* ── Time formatting ───────────────────────────────────── */
    formatTime: function(seconds) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },

    /* ── Debounced save ────────────────────────────────────── */
    _saveTimeout: null,
    debounceSave: function(fn, ms) {
      if (EngineShared._saveTimeout) clearTimeout(EngineShared._saveTimeout);
      EngineShared._saveTimeout = setTimeout(fn, ms || 500);
    },

    /* ── AI assistant lazy loader ──────────────────────────── */
    ensureAiAssistant: function(cb) {
      if (window.AiAssistant) { if (cb) cb(); return; }
      var s = document.createElement('script');
      s.src = ENGINE_BASE + 'ai-assistant-engine.js';
      s.onload = cb || null;
      s.onerror = function() { EngineShared.showToast('AI Assistant requires internet connection'); };
      document.body.appendChild(s);
    },

    /* ── Gemini AI transport ──────────────────────────────── */
  AIR_OK: [0x71, 0x75, 0x69, 0x7A, 0x74, 0x6F, 0x6F, 0x6C],

  airObfuscate: function(str) {
    var ok = EngineShared.AIR_OK, out = [];
    for (var i = 0; i < str.length; i++)
      out.push(str.charCodeAt(i) ^ ok[i % ok.length]);
    return btoa(String.fromCharCode.apply(null, out));
  },

  airDeobfuscate: function(encoded) {
    try {
      var ok = EngineShared.AIR_OK, raw = atob(encoded);
      var out = [];
      for (var i = 0; i < raw.length; i++)
        out.push(raw.charCodeAt(i) ^ ok[i % ok.length]);
      return String.fromCharCode.apply(null, out);
    } catch (e) { return ''; }
  },

  airReadGeminiKey: function() {
    var r = localStorage.getItem('gemini_api_key');
    if (!r) return '';
    return EngineShared.airDeobfuscate(r) || r;
  },

  airWriteGeminiKey: function(plain) {
    if (plain) {
      localStorage.setItem('gemini_api_key', EngineShared.airObfuscate(plain));
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  },

  airHasGeminiKey: function() { return !!EngineShared.airReadGeminiKey(); },

  airExtractGeminiText: function(payload) {
    if (!payload || !payload.candidates || !payload.candidates[0]) {
      var reason = payload && payload.candidates && payload.candidates[0] ? payload.candidates[0].finishReason || 'UNKNOWN' : 'UNKNOWN';
      throw new Error('Gemini response missing content. finishReason=' + reason);
    }
    var parts = payload.candidates[0].content && payload.candidates[0].content.parts;
    if (!parts || parts.length === 0) throw new Error('Gemini returned no parts. finishReason=' + (payload.candidates[0].finishReason || 'UNKNOWN'));
    return parts.map(function(p) { return p.text || ''; }).join('').trim();
  },

  airFriendlyError: function(err) {
    return (err && err.message ? err.message : String(err || 'Unknown AI error')).replace(/\s+/g, ' ').trim();
  },

  airBuildAttempts: function(model, models, retryLevel) {
    var fallback = models && models[0] && models[0][0];
    var attempts = [{ model: model }];
    if (fallback && fallback !== model) attempts.push({ model: fallback });
    if (retryLevel === 'fast') return attempts.slice(0, 1);
    if (retryLevel === 'thorough') return attempts;
    return attempts.slice(0, 2);
  },

  airRequestGemini: function(systemPrompt, contents, apiKey, model, cancelSignal, temperature, maxWaitMs) {
    if (temperature === undefined) temperature = 0.4;
    var controller = maxWaitMs > 0 ? new AbortController() : null;
    var timeoutId = null;
    var cancelCleanup = null;
    if (controller) {
      timeoutId = setTimeout(function () { controller.abort(); }, maxWaitMs);
    }
    if (cancelSignal) {
      cancelCleanup = function () {
        if (timeoutId) clearTimeout(timeoutId);
        if (controller) controller.abort();
      };
      cancelSignal.addEventListener('abort', cancelCleanup);
    }
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    var body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: contents,
      generationConfig: { temperature: temperature }
    });
    var reqSignal = controller ? controller.signal : (cancelSignal || null);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: body,
      signal: reqSignal
    }).then(function(r) {
      return r.text().then(function(text) {
        if (!r.ok) {
          try { var pe = JSON.parse(text); if (pe && pe.error && pe.error.message) throw new Error(pe.error.message); } catch (e) { if (e.message) throw e; }
          throw new Error('Gemini API error ' + r.status);
        }
        var payload = JSON.parse(text);
        return EngineShared.airExtractGeminiText(payload);
      });
    }).finally(function () {
      if (timeoutId) clearTimeout(timeoutId);
      if (cancelCleanup && cancelSignal) cancelSignal.removeEventListener('abort', cancelCleanup);
    });
  },

  airTryRequests: function(systemPrompt, contents, apiKey, attempts, cancelSignal, temperature, maxWaitMs) {
    if (!attempts || attempts.length === 0) return Promise.reject(new Error('No Gemini models available'));
    var idx = 0;
    var next = function() {
      if (idx >= attempts.length) return Promise.reject(new Error('All Gemini models exhausted'));
      var att = attempts[idx++];
      return EngineShared.airRequestGemini(systemPrompt, contents, apiKey, att.model, cancelSignal, temperature, maxWaitMs)
        .catch(function(err) {
          if (idx < attempts.length) {
            if (typeof EngineShared.showToast === 'function') EngineShared.showToast('Falling back to ' + attempts[idx].model);
            return next();
          }
          throw err;
        });
    };
    return next();
  },

  /* ── Keyboard shortcuts ────────────────────────────────── */
    _kbHandler: null,
    setupShortcuts: function(handlers) {
      if (EngineShared._kbHandler) {
        document.removeEventListener('keydown', EngineShared._kbHandler);
      }
      EngineShared._kbHandler = function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (handlers.isActive && !handlers.isActive()) return;
        switch (e.key) {
          case 'ArrowLeft':
            if (handlers.onPrev) { e.preventDefault(); handlers.onPrev(); }
            break;
          case 'ArrowRight':
            if (handlers.onNext) { e.preventDefault(); handlers.onNext(); }
            break;
          case '1': case '2': case '3': case '4':
            if (handlers.onSelect) { e.preventDefault(); handlers.onSelect(parseInt(e.key)); }
            break;
          case 'f': case 'F':
            if (handlers.onFlag && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); handlers.onFlag(); }
            break;
          case 'h': case 'H':
            if (handlers.onToggleHighlighter && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); handlers.onToggleHighlighter(); }
            break;
          case 's': case 'S':
            if (handlers.onStrikethrough && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); handlers.onStrikethrough(); }
            break;
          case 'Enter':
            if (handlers.onSubmit) { e.preventDefault(); handlers.onSubmit(); }
            break;
          case '/':
            if (handlers.onHelp) { e.preventDefault(); handlers.onHelp(); }
            break;
          case 'Escape':
            if (handlers.onEscape) { e.preventDefault(); handlers.onEscape(); }
            break;
        }
      };
      document.addEventListener('keydown', EngineShared._kbHandler);
    }
  };

  /* ── Run initHead by default ──────────────────────────── */
  EngineShared.initHead();
})();
