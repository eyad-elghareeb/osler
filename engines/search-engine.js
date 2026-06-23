/* ================================================================
   search-engine.js  —  Global search for index/hub pages.
   Lazy-loaded by index-engine.js on first user interaction.
   Requires: window.escHtml, window.cleanTitle (exposed by index-engine.js)
   ================================================================ */
(function () {
  'use strict';

  if (window.__searchEngineLoaded) return;
  window.__searchEngineLoaded = true;

  var _hasQUIZZES = typeof QUIZZES !== 'undefined' && Array.isArray(QUIZZES);
  var _escHtml = window.escHtml || function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var _cleanTitle = window.cleanTitle || function (raw) { return raw ? raw.replace(/^(?:QuizTool|MU61\s+Quiz|Mansoura\s+MCQ|Quiz\s+Site)\s*[-–—]\s*/i, '').trim() : ''; };

  /* ── Search CSS injection ──────────────────────────────────── */
  var _style = document.createElement('style');
  _style.textContent =
    '.search-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2000;display:none;align-items:flex-start;justify-content:center;padding:4rem 1rem 1rem;transform:translate3d(0,0,0)}' +
    '.search-overlay.open{display:flex}' +
    '.search-modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:640px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.5);animation:searchSlideIn 0.25s var(--ease-out) both;overflow:hidden}' +
    '@keyframes searchSlideIn{from{opacity:0;transform:translateY(-12px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}' +
    '.search-modal-header{display:flex;align-items:center;gap:0.6rem;padding:0.75rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0}' +
    '.search-modal-icon{font-size:1.05rem;color:var(--text-muted);flex-shrink:0}' +
    '.search-modal-input{flex:1;border:none;background:transparent;color:var(--text);font-size:0.95rem;font-family:\'Outfit\',sans-serif;outline:none}' +
    '.search-modal-input::placeholder{color:var(--text-muted)}' +
    '.search-modal-close{width:32px;height:32px;border-radius:7px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:1rem;cursor:pointer;flex-shrink:0}' +
    '.search-modal-close:hover{color:var(--text);border-color:var(--accent)}' +
    '.search-modal-body{flex:1;overflow-y:auto;padding:0.4rem 0;min-height:80px}' +
    '.search-modal-body::-webkit-scrollbar{width:6px}' +
    '.search-modal-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}' +
    '.search-hint,.search-empty{text-align:center;padding:2.5rem 1rem;color:var(--text-muted);font-size:0.88rem}' +
    '.search-loading{text-align:center;padding:1rem;color:var(--text-muted);font-size:0.82rem}' +
    '.search-result-item{display:flex;align-items:flex-start;gap:0.7rem;padding:0.65rem 1rem;cursor:pointer;transition:background 0.15s var(--ease-out);border-left:3px solid transparent}' +
    '.search-result-item:hover,.search-result-item.selected{background:var(--surface2);border-left-color:var(--accent)}' +
    '.search-result-icon{width:34px;height:34px;border-radius:8px;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:1.05rem;flex-shrink:0}' +
    '.search-result-info{flex:1;min-width:0}' +
    '.search-result-title{font-weight:600;font-size:0.9rem;color:var(--text);margin-bottom:0.1rem;line-height:1.3}' +
    '.search-result-title mark{background:var(--accent-dim);color:var(--accent);border-radius:3px;padding:0 2px}' +
    '.search-result-desc{font-size:0.76rem;color:var(--text-muted);margin-bottom:0.2rem;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.search-result-tags{display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:0.15rem}' +
    '.search-result-tag{font-size:0.63rem;padding:0.12rem 0.45rem;border-radius:4px;background:var(--surface2);border:1px solid var(--border);color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.03em}' +
    '.search-result-tag mark{background:var(--accent-dim);color:var(--accent);border-radius:2px}' +
    '.search-result-location{font-size:0.68rem;color:var(--text-muted);opacity:0.7;display:flex;align-items:center;gap:0.2rem;flex-wrap:wrap;margin-top:0.1rem}' +
    '.search-result-location .loc-sep{opacity:0.4;margin:0 0.1rem}' +
    '.search-modal-footer{display:flex;align-items:center;justify-content:space-between;padding:0.45rem 1rem;border-top:1px solid var(--border);flex-shrink:0;font-size:0.7rem;color:var(--text-muted)}' +
    '.search-content-toggle{display:flex;align-items:center;gap:0.5rem;padding:0.3rem 1rem;cursor:pointer;user-select:none;font-size:0.72rem;color:var(--text-muted);border-bottom:1px solid var(--border);background:var(--surface2);transition:background 0.2s var(--ease-out)}' +
    '.search-content-toggle:hover{background:var(--surface)}' +
    '.sct-track{width:28px;height:14px;border-radius:7px;background:var(--border);position:relative;transition:background 0.2s var(--ease-out);flex-shrink:0}' +
    '.sct-track.active{background:var(--accent)}' +
    '.sct-thumb{position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:var(--text-muted);transition:transform 0.2s var(--ease-out),background 0.2s var(--ease-out)}' +
    '.sct-track.active .sct-thumb{transform:translateX(14px);background:var(--text)}' +
    '.search-result-only-content{font-size:0.68rem;color:var(--accent);margin-top:0.15rem;display:flex;align-items:center;gap:0.25rem}';
  document.head.appendChild(_style);

  /* ── Inject search modal into body ─────────────────────────── */
  var _overlay = document.createElement('div');
  _overlay.id = 'search-overlay';
  _overlay.className = 'search-overlay';
  _overlay.innerHTML =
    '<div class="search-modal">' +
      '<div class="search-modal-header">' +
        '<span class="search-modal-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>' +
        '<input class="search-modal-input" id="search-modal-input" type="text" placeholder="Search quizzes..." autocomplete="off">' +
        '<button class="search-modal-close" onclick="window.__searchEngineClose()">\u2715</button>' +
      '</div>' +
      '<div class="search-content-toggle" id="search-content-toggle" onclick="window.__toggleContentSearch()">' +
        '<span class="sct-label"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:0.3rem;vertical-align:middle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Search questions</span>' +
        '<span class="sct-track" id="sct-track"><span class="sct-thumb"></span></span>' +
      '</div>' +
      '<div class="search-modal-body" id="search-modal-body">' +
        '<div class="search-hint">Start typing to search across all quizzes...</div>' +
      '</div>' +
      '<div class="search-modal-footer">' +
        '<span>\u2191\u2193 Navigate \u00B7 Enter Open \u00B7 Esc Close</span>' +
        '<span class="search-footer-count" id="search-footer-count"></span>' +
      '</div>' +
    '</div>';
  // Only inject if not already present (safety check)
  if (!document.getElementById('search-overlay')) {
    document.body.appendChild(_overlay);
  }

  /* ── Search state ──────────────────────────────────────────── */
  var _state = {
    open: false,
    query: '',
    results: [],
    selectedIdx: -1,
    deepCache: {},
    searchContent: false,
    contentCache: {}
  };
  window.__searchEngineState = _state;

  var _crawlSearchTimer;
  var _contentCrawlPending = false;

  /* ── URL resolution ────────────────────────────────────────── */
  function _resolveUrl(url) {
    if (!url) return '';
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
    if (url.indexOf('/') === 0) return location.origin + url;
    var base = location.href.replace(/[^/]*$/, '');
    return base + url;
  }

  /* ── Highlight matching text ───────────────────────────────── */
  function _highlightMatch(text, query) {
    if (!query || !text) return _escHtml(text || '');
    var escaped = _escHtml(text);
    try {
      var q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return escaped.replace(new RegExp('(' + q + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) { return escaped; }
  }

  /* ── Score relevance ───────────────────────────────────────── */
  function _scoreEntry(entry, qLower) {
    var score = 0;
    var title = (entry.title || '').toLowerCase();
    var desc = (entry.description || '').toLowerCase();
    var tags = (entry.tags || []).join(' ').toLowerCase();
    if (title === qLower) score += 100;
    else if (title.indexOf(qLower) === 0) score += 50;
    else if (title.indexOf(qLower) > 0) score += 30;
    if (desc.indexOf(qLower) >= 0) score += 10;
    if (tags.indexOf(qLower) >= 0) score += 15;
    return score;
  }

  /* ── Deep crawl a sub-folder ───────────────────────────────── */
  function _crawlFolder(folderUrl, breadcrumbs) {
    if (_state.deepCache[folderUrl]) return;
    _state.deepCache[folderUrl] = { loading: true };

    var absUrl = _resolveUrl(folderUrl);
    fetch(absUrl)
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) { _state.deepCache[folderUrl] = null; return; }
        var tMatch = html.match(/<title>([^<]+)<\/title>/i);
        var folderTitle = tMatch ? _cleanTitle(tMatch[1].trim()) : '';
        var newBc = breadcrumbs.slice();
        if (folderTitle) newBc.push(folderTitle);

        var qMatch = html.match(/const\s+QUIZZES\s*=\s*(\[[\s\S]*?\])\s*;/);
        if (!qMatch) { _state.deepCache[folderUrl] = { folderTitle: folderTitle, entries: [] }; return; }
        var quizzes;
        try { eval('quizzes = ' + qMatch[1] + ';'); }
        catch (e) {
          try { quizzes = JSON.parse(qMatch[1]); } catch (e2) { _state.deepCache[folderUrl] = { folderTitle: folderTitle, entries: [] }; return; }
        }
        if (!Array.isArray(quizzes)) { _state.deepCache[folderUrl] = { folderTitle: folderTitle, entries: [] }; return; }

        var folderDir = folderUrl.replace(/[^/]*$/, '');
        var entries = [];
        var childFolders = [];
        quizzes.forEach(function (q) {
          var isFolder = q.tags && q.tags.indexOf('Folder') !== -1;
          var e = {
            title: q.title || '',
            description: q.description || '',
            icon: q.icon || '',
            tags: q.tags || [],
            url: _resolveUrl(folderDir + (q.url || '')),
            breadcrumbs: newBc.slice(),
            isFolder: isFolder
          };
          entries.push(e);
          if (isFolder) childFolders.push(e);
        });

        _state.deepCache[folderUrl] = { folderTitle: folderTitle, entries: entries };

        if (_state.open && _state.query) {
          clearTimeout(_crawlSearchTimer);
          _crawlSearchTimer = setTimeout(function () { _performSearch(_state.query); }, 80);
        }

        childFolders.forEach(function (cf) {
          _crawlFolder(cf.url, newBc);
        });
        if (_state.searchContent && entries.length) _startContentCrawl();
      })
      .catch(function () { _state.deepCache[folderUrl] = null; });
  }

  /* ── Kick off deep crawl ───────────────────────────────────── */
  function _startDeepCrawl() {
    if (!_hasQUIZZES) return;
    QUIZZES.forEach(function (q) {
      if (q.tags && q.tags.indexOf('Folder') !== -1) {
        _crawlFolder(q.url, []);
      }
    });
  }

  /* ── Extract questions from quiz/bank HTML ─────────────────── */
  function _extractQuestions(html) {
    var m = html.match(/\/\*\s*\[QUESTIONS_START\]\s*\*\/[\s\S]*?const\s+QUESTIONS\s*=\s*(\[[\s\S]*?\])\s*;?\s*\/\*\s*\[QUESTIONS_END\]\s*\*\//i);
    if (m) { try { var q = JSON.parse(m[1]); if (Array.isArray(q)) return q; } catch (e) {} }
    m = html.match(/\/\*\s*\[QUESTION_BANK_START\]\s*\*\/[\s\S]*?const\s+QUESTION_BANK\s*=\s*(\[[\s\S]*?\])\s*;?\s*\/\*\s*\[QUESTION_BANK_END\]\s*\*\//i);
    if (m) { try { var b = JSON.parse(m[1]); if (Array.isArray(b)) return b; } catch (e) {} }
    return null;
  }

  /* ── Fetch + cache question text for a single URL ──────────── */
  function _crawlSingleContent(url) {
    if (_state.contentCache[url]) return Promise.resolve();
    _state.contentCache[url] = { loading: true, text: '', questions: [] };
    return fetch(url)
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (html) {
        if (!html) { _state.contentCache[url] = { loading: false, text: '', questions: [] }; return; }
        var raw = _extractQuestions(html);
        var questions = [];
        var texts = [];
        if (raw) {
          for (var i = 0; i < raw.length; i++) {
            var qt = (raw[i].question || '').toLowerCase();
            if (qt) {
              questions.push({ text: qt, index: i + 1 });
              texts.push(qt);
            }
          }
        }
        _state.contentCache[url] = { loading: false, text: texts.join(' '), questions: questions };
      })
      .catch(function () { _state.contentCache[url] = { loading: false, text: '', questions: [] }; });
  }

  var _contentBatchTimer;

  /* ── Batch-crawl all known quiz/bank files (concurrency: 4) ── */
  function _startContentCrawl() {
    if (_contentCrawlPending) return;
    _contentCrawlPending = true;

    var urlSet = {};
    function addUrl(u) {
      if (u && !_state.contentCache[u]) urlSet[u] = true;
    }

    if (_hasQUIZZES) {
      QUIZZES.forEach(function (q) {
        if (!q.tags || q.tags.indexOf('Folder') === -1) addUrl(_resolveUrl(q.url));
      });
    }

    Object.keys(_state.deepCache).forEach(function (fk) {
      var data = _state.deepCache[fk];
      if (!data || !data.entries) return;
      data.entries.forEach(function (e) {
        if (!e.isFolder) addUrl(e.url);
      });
    });

    var urlList = Object.keys(urlSet);
    if (!urlList.length) { _contentCrawlPending = false; return; }

    var idx = 0;
    function nextBatch() {
      var batch = urlList.slice(idx, idx + 4);
      idx += 4;
      if (!batch.length) { _contentCrawlPending = false; return; }
      Promise.all(batch.map(_crawlSingleContent)).then(function () {
        if (_state.open && _state.query) {
          clearTimeout(_contentBatchTimer);
          _contentBatchTimer = setTimeout(function () { _performSearch(_state.query); }, 150);
        }
        if (idx < urlList.length) setTimeout(nextBatch, 80);
        else {
          _contentCrawlPending = false;
          if (_state.searchContent) _startContentCrawl();
        }
      });
    }
    nextBatch();
  }

  /* ── Get matched question indices for a URL ────────────────── */
  function _getContentMatches(url, qLower) {
    var c = _state.contentCache[url];
    if (!c || !c.questions) return [];
    var matches = [];
    for (var i = 0; i < c.questions.length; i++) {
      if (c.questions[i].text.indexOf(qLower) >= 0) matches.push(c.questions[i].index);
    }
    return matches;
  }

  /* ── Perform search ────────────────────────────────────────── */
  function _performSearch(query) {
    _state.query = query;
    _state.selectedIdx = -1;
    var qLower = query.toLowerCase();

    var allResults = [];
    var seenUrls = {};

    function addResult(r) {
      if (seenUrls[r.url]) return;
      seenUrls[r.url] = true;
      allResults.push(r);
    }

    if (query.length >= 1 && _hasQUIZZES) {
      QUIZZES.forEach(function (quiz) {
        var score = _scoreEntry(quiz, qLower);
        var contentMatches = [];
        if (_state.searchContent) {
          contentMatches = _getContentMatches(_resolveUrl(quiz.url), qLower);
          if (score === 0 && contentMatches.length) score = 8;
        }
        if (score > 0) {
          addResult({
            title: quiz.title || '',
            description: quiz.description || '',
            icon: quiz.icon || '',
            tags: quiz.tags || [],
            url: quiz.url || '',
            breadcrumbs: [],
            score: score,
            isFolder: quiz.tags && quiz.tags.indexOf('Folder') !== -1,
            contentMatches: contentMatches
          });
        }
      });
    }

    Object.keys(_state.deepCache).forEach(function (fk) {
      var data = _state.deepCache[fk];
      if (!data || !data.entries) return;
      data.entries.forEach(function (entry) {
        var score = _scoreEntry(entry, qLower);
        var contentMatches = [];
        if (_state.searchContent) {
          contentMatches = _getContentMatches(entry.url, qLower);
          if (score === 0 && contentMatches.length) score = 8;
        }
        if (score > 0) {
          addResult({
            title: entry.title,
            description: entry.description,
            icon: entry.icon,
            tags: entry.tags,
            url: entry.url,
            breadcrumbs: entry.breadcrumbs,
            score: score,
            isFolder: entry.isFolder,
            contentMatches: contentMatches
          });
        }
      });
    });

    allResults.sort(function (a, b) { return b.score - a.score; });
    _state.results = allResults.length > 50 ? allResults.slice(0, 50) : allResults;
    _renderResults(_state.results, query);
  }

  /* ── Render search results ─────────────────────────────────── */
  function _renderResults(results, query) {
    var body = document.getElementById('search-modal-body');
    if (!body) return;
    var countEl = document.getElementById('search-footer-count');

    if (!query || query.length < 1) {
      body.innerHTML = '<div class="search-hint">Start typing to search across all quizzes...</div>';
      if (countEl) countEl.textContent = '';
      return;
    }

    var isComplete = true;
    for (var k in _state.deepCache) {
      if (_state.deepCache[k] && _state.deepCache[k].loading) { isComplete = false; break; }
    }

    if (countEl) {
      countEl.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');
      if (!isComplete) countEl.textContent += ' (searching deeper\u2026)';
    }

    if (!results.length) {
      body.innerHTML = '<div class="search-empty">' + (isComplete ? 'No quizzes found matching your search' : 'Searching...') + '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var sel = i === _state.selectedIdx;
      var locHtml = '';
      if (r.breadcrumbs && r.breadcrumbs.length) {
        locHtml = '<div class="search-result-location"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px;vertical-align:middle"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg> ' +
          r.breadcrumbs.map(function (b) { return _highlightMatch(b, query); }).join('<span class="loc-sep"> \u2192 </span>') +
          '</div>';
      }
      html += '<div class="search-result-item' + (sel ? ' selected' : '') + '" data-idx="' + i + '">';
      html += '<div class="search-result-icon">' + (r.icon || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>') + '</div>';
      html += '<div class="search-result-info">';
      html += '<div class="search-result-title">' + _highlightMatch(r.title, query) + '</div>';
      if (r.description) {
        html += '<div class="search-result-desc">' + _highlightMatch(r.description, query) + '</div>';
      }
      if (r.contentMatches && r.contentMatches.length) {
        var qLabel = r.contentMatches.length === 1 ? 'Q' + r.contentMatches[0] : 'Q' + r.contentMatches[0] + '\u2013Q' + r.contentMatches[r.contentMatches.length - 1];
        html += '<div class="search-result-only-content"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Matched in <span>' + qLabel + '</span></div>';
      }
      if (r.tags && r.tags.length) {
        html += '<div class="search-result-tags">';
        for (var j = 0; j < r.tags.length; j++) {
          html += '<span class="search-result-tag">' + _highlightMatch(r.tags[j], query) + '</span>';
        }
        html += '</div>';
      }
      html += locHtml;
      html += '</div></div>';
    }
    body.innerHTML = html;
  }

  window.__searchEngineRender = _renderResults;

  /* ── Navigate to a result ──────────────────────────────────── */
  window.__searchEngineNavigate = function (idx) {
    var r = _state.results[idx];
    if (!r) return;
    window.__searchEngineClose();
    var target = r.url ? _resolveUrl(r.url) : '';
    if (target) window.location.href = target;
  };

  /* ── Open search ───────────────────────────────────────────── */
  window.__searchEngineOpen = function () {
    if (_state.open) return;
    _state.open = true;
    var overlay = document.getElementById('search-overlay');
    if (overlay) overlay.classList.add('open');
    var input = document.getElementById('search-modal-input');
    if (input) { input.focus(); input.value = _state.query || ''; }
    var track = document.getElementById('sct-track');
    if (track) track.classList.toggle('active', _state.searchContent);
    if (_state.query) _performSearch(_state.query);
  };

  /* ── Close search ──────────────────────────────────────────── */
  window.__searchEngineClose = function () {
    _state.open = false;
    var overlay = document.getElementById('search-overlay');
    if (overlay) overlay.classList.remove('open');
  };

  /* ── Toggle content search ─────────────────────────────────── */
  window.__toggleContentSearch = function () {
    _state.searchContent = !_state.searchContent;
    var track = document.getElementById('sct-track');
    if (track) track.classList.toggle('active', _state.searchContent);
    if (_state.searchContent) _startContentCrawl();
    if (_state.query) _performSearch(_state.query);
  };

  /* ── Search input handlers ─────────────────────────────────── */
  (function () {
    var input = document.getElementById('search-modal-input');
    if (!input) return;
    var debounceTimer;
    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      var val = input.value;
      debounceTimer = setTimeout(function () {
        _performSearch(val);
      }, 150);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_state.results.length) {
          _state.selectedIdx = Math.min(_state.selectedIdx + 1, _state.results.length - 1);
          _renderResults(_state.results, _state.query);
          var sel = document.querySelector('.search-result-item.selected');
          if (sel) sel.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _state.selectedIdx = Math.max(_state.selectedIdx - 1, 0);
        _renderResults(_state.results, _state.query);
        var sel2 = document.querySelector('.search-result-item.selected');
        if (sel2) sel2.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (_state.selectedIdx >= 0 && _state.selectedIdx < _state.results.length) {
          window.__searchEngineNavigate(_state.selectedIdx);
        }
      } else if (e.key === 'Escape') {
        window.__searchEngineClose();
      }
    });
  })();

  /* ── Event delegation for result clicks / hover ──────────── */
  (function () {
    var body = document.getElementById('search-modal-body');
    if (!body) return;
    body.addEventListener('click', function (e) {
      var item = e.target.closest('.search-result-item');
      if (item) {
        var idx = parseInt(item.getAttribute('data-idx'), 10);
        if (!isNaN(idx)) window.__searchEngineNavigate(idx);
      }
    });
    body.addEventListener('mouseover', function (e) {
      var item = e.target.closest('.search-result-item');
      if (item) {
        var idx = parseInt(item.getAttribute('data-idx'), 10);
        if (!isNaN(idx) && idx !== _state.selectedIdx) {
          _state.selectedIdx = idx;
        }
      }
    });
  })();

  // Start deep crawl immediately (background)
  setTimeout(_startDeepCrawl, 100);

})();
