/* ================================================================
   engine-shared.js  —  Shared utilities for all Osler engines.
   Load this BEFORE the individual engine file.
   Auto-detects its own base URL so it works at any folder depth.
   ================================================================ */
(function () {
  'use strict';

  var _cs = document.currentScript;
  var ENGINE_BASE = _cs ? _cs.src.replace(/[^\/]*$/, '') : '';
  var ROOT_BASE = (function(base) {
    try {
      var u = new URL(base);
      var pathParts = u.pathname.replace(/\/$/, '').split('/');
      if (pathParts.length <= 1) return base;
      pathParts.pop();
      return u.origin + pathParts.join('/') + '/';
    } catch(e) {
      return base;
    }
  })(ENGINE_BASE);

  /* ── CSS variables (injected inline so they're available synchronously) ──
     Phase 6.5 fix #25 (partial): the inline CSS_VARS block previously
     REDEFINED `--transition`, `--transition-fast`, and `--transition-slow`
     to different values than `src/css/shared.css` defines, breaking the
     P4.3 CSS token contract (engine inline CSS overrode shared.css tokens,
     so any token "extraction" in shared.css was invisible to engine-styled
     elements).

     The fix: align the inline values with shared.css so they no longer
     conflict. The full extraction (removing the inline block entirely and
     loading shared.css via <link>) is deferred to a Phase 7 prep session
     because every engine embeds its own copy of the easing/transition
     tokens and removing them all at once risks visual regressions.

     Values now match src/css/shared.css:
       --transition:       0.22s cubic-bezier(0.16, 1, 0.3, 1)
       --transition-fast:  150ms ease
       --transition-slow:  350ms cubic-bezier(0.16, 1, 0.3, 1)
     (cubic-bezier easing is also exposed as --ease-out for engine-internal
     animation styles that already reference it.) */
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
  --ease-out:         cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-in-out:      cubic-bezier(0.65, 0, 0.35, 1);
  --transition:       0.22s cubic-bezier(0.16, 1, 0.3, 1);
  --transition-fast:  150ms ease;
  --transition-slow:  350ms cubic-bezier(0.16, 1, 0.3, 1);
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
      EngineShared._addLink('stylesheet', ENGINE_BASE + 'shared.css');
      EngineShared._addLink('preconnect', 'https://fonts.googleapis.com');
      EngineShared._addLink('preconnect', 'https://fonts.gstatic.com', {crossOrigin: ''});
      EngineShared._addLink('stylesheet', 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
      EngineShared._addLink('manifest',   root + 'manifest.webmanifest');
      EngineShared._addLink('icon',       root + 'assets/favicon.svg', {type: 'image/svg+xml'});
      EngineShared._addLink('apple-touch-icon', root + 'assets/favicon.svg');
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
      msgSpan.innerHTML = msg;
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

  /* ── PDF export (vector text, direct download via pdfmake) ─── */
    _pdfmakeLoaded: false,
    _pdfmakeQueue: [],

    _loadPdfmake: function(cb) {
      if (typeof pdfmake !== 'undefined') { cb(); return; }
      EngineShared._pdfmakeQueue.push(cb);
      if (EngineShared._pdfmakeLoaded) return;
      EngineShared._pdfmakeLoaded = true;
      // Load pdfmake.min.js first, then vfs_fonts.js — sequential to avoid race
      var _loadNext = function(urls, idx, onDone) {
        if (idx >= urls.length) { onDone(); return; }
        var s = document.createElement('script');
        s.src = urls[idx];
        s.onload = function() { _loadNext(urls, idx + 1, onDone); };
        s.onerror = function() {
          console.warn('[engine-shared] pdfmake script failed to load:', urls[idx]);
          _loadNext(urls, idx + 1, onDone);
        };
        document.head.appendChild(s);
      };
      _loadNext([
        'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.js'
      ], 0, function() {
        // Retry up to 15s (150 × 100ms) to let pdfmake finish deferred init
        var retries = 0;
        (function attempPdf() {
          if (typeof pdfmake !== 'undefined') {
            EngineShared._pdfmakeQueue.splice(0).forEach(function(f) { try { f(); } catch(e) {} });
          } else if (retries < 150) {
            retries++;
            setTimeout(attempPdf, 100);
          } else {
            console.warn('[engine-shared] pdfmake failed to load after 15s');
            EngineShared._pdfmakeQueue.splice(0);
          }
        })();
      });
    },

    _htmlToPdfContent: function(html) {
      var stack = [];
      var div = document.createElement('div');
      div.innerHTML = html;
      function walk(el) {
        for (var i = 0; i < el.childNodes.length; i++) {
          var node = el.childNodes[i];
          if (node.nodeType === 3) {
            var t = node.textContent.replace(/\s+/g, ' ').trim();
            if (t) stack.push(t);
          } else if (node.nodeType === 1) {
            var tag = node.tagName.toLowerCase();
            if (tag === 'br') { stack.push({}); continue; }
            if (tag === 'h2' || tag === 'h3') {
              var str = node.textContent.replace(/\s+/g, ' ').trim();
              if (str) stack.push({ text: str, bold: true, margin: [0, tag==='h2'?10:6, 0, 4] });
              continue;
            }
            if (tag === 'strong' || tag === 'b') {
              var str2 = node.textContent.replace(/\s+/g, ' ').trim();
              if (str2) stack.push({ text: str2, bold: true });
              continue;
            }
            walk(node);
          }
        }
      }
      walk(div);
      return stack;
    },

    exportToPDF: function(containerOrHtml, filename) {
      var container = typeof containerOrHtml === 'string' ? null : containerOrHtml;
      var dd = {
        pageSize: 'A4',
        pageMargins: [15, 15, 15, 15],
        content: [],
        defaultStyle: { font: 'Helvetica', fontSize: 9, lineHeight: 1.4 }
      };
      if (container) {
        var chunks = Array.from(container.children);
        chunks.forEach(function(chunk, ci) {
          if (ci > 0) dd.content.push({ text: '', pageBreak: 'before' });
          var items = EngineShared._htmlToPdfContent(chunk.innerHTML);
          items.forEach(function(item) {
            if (typeof item === 'object' && Object.keys(item).length === 0) {
              dd.content.push({ text: '', margin: [0, 2, 0, 0] });
            } else if (typeof item === 'string') {
              dd.content.push({ text: item, margin: [0, 1, 0, 0] });
            } else {
              dd.content.push(item);
            }
          });
        });
      } else {
        dd.content.push({ text: typeof containerOrHtml === 'string' ? EngineShared._stripHtml(containerOrHtml) : '', margin: [0, 10, 0, 0] });
      }
      EngineShared._loadPdfmake(function() {
        try { pdfmake.createPdf(dd).download(filename || 'export'); }
        catch(e) { console.error('[PDF] create failed:', e); EngineShared.showToast('PDF generation failed. Try the export again.'); }
      });
    },

    _stripHtml: function(html) {
      var d = document.createElement('div');
      d.innerHTML = html;
      return d.textContent.replace(/\s+/g, ' ').trim();
    },

    /* ── Keyboard shortcuts ──────────────────────────────────
     Phase 6.5 fix #22: the duplicated 40-line setupShortcuts implementation
     is removed. The bridge below dynamically imports keyboard.js and replaces
     EngineShared.setupShortcuts with the canonical implementation. If the
     bridge hasn't loaded yet when an engine calls setupShortcuts, we queue
     the handlers and apply them once keyboard.js arrives. */
    _kbHandler: null,
    _pendingShortcuts: [],
    setupShortcuts: function(handlers) {
      if (EngineShared._kbHandler) {
        document.removeEventListener('keydown', EngineShared._kbHandler);
        EngineShared._kbHandler = null;
      }
      // If keyboard.js has loaded and replaced this function, we wouldn't be
      // here. Queue the handlers so they can be applied when the bridge loads.
      EngineShared._pendingShortcuts.push(handlers);
      // Defensive: if 5s pass and the bridge still hasn't loaded, fall back
      // to a minimal inline impl so basic nav keys still work.
      if (!EngineShared._kbFallbackTimer) {
        EngineShared._kbFallbackTimer = setTimeout(function() {
          if (typeof EngineShared.setupShortcuts._replaced === 'undefined' &&
              EngineShared._pendingShortcuts.length > 0) {
            console.warn('[engine-shared] keyboard.js bridge did not load within 5s; applying minimal inline keyboard handler fallback.');
            _applyInlineKbFallback();
          }
        }, 5000);
      }
    }
  };

  // Minimal inline fallback used only if the keyboard.js bridge fails to load.
  // Mirrors the original behavior but lives in a single function so we don't
  // duplicate the implementation across the bridge boundary.
  function _applyInlineKbFallback() {
    while (EngineShared._pendingShortcuts.length > 0) {
      var handlers = EngineShared._pendingShortcuts.shift();
      if (EngineShared._kbHandler) {
        document.removeEventListener('keydown', EngineShared._kbHandler);
      }
      EngineShared._kbHandler = function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (handlers.isActive && !handlers.isActive()) return;
        switch (e.key) {
          case 'ArrowLeft':  if (handlers.onPrev)  { e.preventDefault(); handlers.onPrev();  } break;
          case 'ArrowRight': if (handlers.onNext)  { e.preventDefault(); handlers.onNext();  } break;
          case '1': case '2': case '3': case '4':
            if (handlers.onSelect) { e.preventDefault(); handlers.onSelect(parseInt(e.key)); } break;
          case 'f': case 'F':
            if (handlers.onFlag && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); handlers.onFlag(); } break;
          case 'h': case 'H':
            if (handlers.onToggleHighlighter && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); handlers.onToggleHighlighter(); } break;
          case 's': case 'S':
            if (handlers.onStrikethrough && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); handlers.onStrikethrough(); } break;
          case 'Enter':
            if (handlers.onSubmit) { e.preventDefault(); handlers.onSubmit(); } break;
          case '/':
            if (handlers.onHelp) { e.preventDefault(); handlers.onHelp(); } break;
          case 'Escape':
            if (handlers.onEscape) { e.preventDefault(); handlers.onEscape(); } break;
        }
      };
      document.addEventListener('keydown', EngineShared._kbHandler);
    }
  }

  /* ── Run initHead by default ──────────────────────────── */
  EngineShared.initHead();

  /* ── Icon bridge (Phase 4) ──────────────────────────────────────
     Synchronous fallback: returns empty SVG until async import loads.
     Engines call EngineShared.icon('name', size) to get SVG strings.

     Phase 6.5 fix #23: previously, icons rendered before the lib loaded
     stayed as empty SVGs forever because no engine listened for the
     `osler:icons-loaded` event. Now EngineShared.icon tags each empty
     fallback SVG with `data-osler-icon="<name>"` and `data-osler-icon-size="<size>"`;
     when icons.js loads, we walk the DOM and replace every tagged SVG with
     the real icon. This way engines don't need to listen for the event. */
  var _iconsCache = null;
  EngineShared.icon = function(n, s) {
    if (_iconsCache) return _iconsCache.icon(n, s);
    // Fallback: emit a tagged empty SVG that the loader will swap.
    return '<svg data-osler-icon="' + (n || '') + '" data-osler-icon-size="' + (s || 16) + '" width="' + (s||16) + '" height="' + (s||16) + '"></svg>';
  };

  // Walk the DOM and replace every tagged placeholder SVG with the real icon.
  function _hydratePendingIcons() {
    if (!_iconsCache) return;
    var placeholders = document.querySelectorAll('svg[data-osler-icon]');
    for (var i = 0; i < placeholders.length; i++) {
      var el = placeholders[i];
      var name = el.getAttribute('data-osler-icon');
      var size = parseInt(el.getAttribute('data-osler-icon-size') || '16', 10);
      var realSvg = _iconsCache.icon(name, size);
      if (realSvg) {
        // Replace the placeholder with the real SVG markup.
        var tmp = document.createElement('span');
        tmp.innerHTML = realSvg;
        var real = tmp.firstChild;
        if (real) el.parentNode.replaceChild(real, el);
      }
    }
  }

  /* ── Lib module bridge (Phase 0) ─────────────────────────────────
     Dynamically imports the ES modules in src/lib/ and wires them onto
     EngineShared / window.OslerTracker / window.OslerAnalytics /
     window.OslerAnki so engines transparently use the extracted lib code.

     B3 fix: robust path resolution. The old `ENGINE_BASE.replace(/dist\/$/, 'src/lib/')`
     only worked when ENGINE_BASE literally ended in "dist/". In production
     (served from dist/), ENGINE_BASE ends in "/" so the regex didn't match
     and imports became "./tracker.js" (404). The new approach:
       1. Try ROOT_BASE + 'src/lib/' (covers both dev and dist layouts,
          since src/lib/ is copied to dist/src/lib/ by build.js).
       2. Fall back to ENGINE_BASE + 'src/lib/' if that fails.

     B3 fix: every import failure is logged to console.warn — no more
     .catch(function(){}) silent swallowing.

     B3 fix: bridge coverage expanded — gemini.js, keyboard.js, ui.js,
     anki.js now bridged too. setupShortcuts delegates to keyboard.js
     instead of duplicating the implementation. */
  function _resolveLibPath(filename) {
    // ROOT_BASE is one level up from ENGINE_BASE — i.e. the project root
    // whether we're in dist/ or engines/. src/lib/ lives at the project root.
    var candidates = [
      ROOT_BASE + 'src/lib/' + filename,
      ENGINE_BASE + 'src/lib/' + filename,
      ENGINE_BASE + filename, // last-ditch: file sitting next to engine
    ];
    return candidates;
  }

  function _importLib(filename, label, wireFn) {
    var candidates = _resolveLibPath(filename);
    var idx = 0;
    function tryNext() {
      if (idx >= candidates.length) {
        console.warn('[engine-shared] Failed to load ' + label + ' from any candidate path:', candidates);
        return;
      }
      var url = candidates[idx++];
      import(url).then(function(m) {
        wireFn(m);
      }).catch(function(e) {
        if (idx < candidates.length) {
          tryNext();
        } else {
          console.warn('[engine-shared] ' + label + ' import failed (' + url + '):', e);
        }
      });
    }
    tryNext();
  }

  _importLib('theme.js', 'theme.js', function(m) {
    if (typeof m.toggleTheme === 'function') EngineShared.toggleTheme = m.toggleTheme;
    if (typeof m.updateThemeIcons === 'function') EngineShared.updateThemeIcon = m.updateThemeIcons;
    if (typeof m.getTheme === 'function') EngineShared.getTheme = m.getTheme;
  });

  _importLib('toast.js', 'toast.js', function(m) {
    if (typeof m.showToast === 'function') EngineShared.showToast = m.showToast;
  });

  _importLib('dom.js', 'dom.js', function(m) {
    if (typeof m.escHtml === 'function') EngineShared.escHtml = m.escHtml;
    if (typeof m.createElement === 'function') EngineShared.createElement = m.createElement;
    if (typeof m.h === 'function') EngineShared.h = m.h;
  });

  _importLib('tracker.js', 'tracker.js', function(m) {
    // Expose the FULL tracker API (was only 6 of 11 methods — H20 fix).
    window.OslerTracker = {
      getQuizProgress: m.getQuizProgress,
      recordQuizAnswer: m.recordQuizAnswer,
      flagQuizItem: m.flagQuizItem,
      getQuizStats: m.getQuizStats,
      getFlashcardState: m.getFlashcardState,
      rateFlashcard: m.rateFlashcard,
      getDueFlashcards: m.getDueFlashcards,
      getWrittenProgress: m.getWrittenProgress,
      recordWrittenAnswer: m.recordWrittenAnswer,
      getOsceProgress: m.getOsceProgress,
      recordOsceAnswer: m.recordOsceAnswer,
    };
  });

  _importLib('analytics.js', 'analytics.js', function(m) {
    window.OslerAnalytics = {
      track: m.track,
      trackStudyStart: m.trackStudyStart,
      trackAnswer: m.trackAnswer,
      trackFlag: m.trackFlag,
      trackComplete: m.trackComplete,
      trackExport: m.trackExport,
    };
  });

  _importLib('icons.js', 'icons.js', function(m) {
    _iconsCache = m;
    // Phase 6.5 fix #23: hydrate any placeholder SVGs that were rendered
    // before icons.js loaded. Also dispatch the event for any engine that
    // still wants to listen for it (e.g. to re-render canvas-based UIs).
    try { _hydratePendingIcons(); } catch (e) { console.warn('[engine-shared] icon hydration failed:', e); }
    try {
      document.dispatchEvent(new CustomEvent('osler:icons-loaded'));
    } catch (e) { /* old IE */ }
  });

  _importLib('anki.js', 'anki.js', function(m) {
    window.OslerAnki = {
      exportToTSV: m.exportToTSV,
      importFromTSV: m.importFromTSV,
      detectCloze: m.detectCloze,
      downloadTSV: m.downloadTSV,
    };
  });

  _importLib('keyboard.js', 'keyboard.js', function(m) {
    // Phase 6.5 fix #22: replace the placeholder setupShortcuts with the
    // canonical implementation from keyboard.js, and flush any pending
    // handlers that were queued before the bridge loaded.
    if (typeof m.setupShortcuts === 'function') {
      EngineShared.setupShortcuts = m.setupShortcuts;
      EngineShared.setupShortcuts._replaced = true;
      // Cancel the fallback timer since the bridge loaded successfully.
      if (EngineShared._kbFallbackTimer) {
        clearTimeout(EngineShared._kbFallbackTimer);
        EngineShared._kbFallbackTimer = null;
      }
      // Flush pending handlers.
      while (EngineShared._pendingShortcuts.length > 0) {
        try { m.setupShortcuts(EngineShared._pendingShortcuts.shift()); }
        catch (e) { console.warn('[engine-shared] keyboard.js setupShortcuts flush failed:', e); }
      }
    }
    if (typeof m.teardownShortcuts === 'function') {
      EngineShared.teardownShortcuts = m.teardownShortcuts;
    }
  });

  _importLib('ui.js', 'ui.js', function(m) {
    window.OslerUI = {
      Card: m.Card,
      Button: m.Button,
      Modal: m.Modal,
      InstallPrompt: m.InstallPrompt,
      CmdKPalette: m.CmdKPalette,
    };
  });

  _importLib('gemini.js', 'gemini.js', function(m) {
    window.OslerGemini = m; // ai-assistant-engine.js can delegate to this
  });

  // H8 fix: expose sync.js + auth.js bridges so engines can trigger sync
  // without going through the deleted legacy sync-engine.js.
  _importLib('sync.js', 'sync.js', function(m) {
    window.OslerSync = {
      syncPush: m.syncPush,
      syncPull: m.syncPull,
      syncFull: m.syncFull,
      initAutoSync: m.initAutoSync,
    };
  });

  _importLib('auth.js', 'auth.js', function(m) {
    window.OslerAuth = {
      currentUser: m.currentUser,
      subscribe: m.subscribe,
      signInAsGuest: m.signInAsGuest,
      signInWithGoogle: m.signInWithGoogle,
      signInWithGitHub: m.signInWithGitHub,
      signOut: m.signOut,
      upgradeAccount: m.upgradeAccount,
      initAuth: m.initAuth,
    };
  });

})();
