/* ================================================================
   engine-tracker.js  —  Question tracker system shared by
   quiz-engine.js, bank-engine.js, and uworld-engine.js.
   Load after engine-shared.js, before the individual engine.
   ================================================================ */
(function () {
  'use strict';

  /* ── Storage keys ── */
  var TRACKER_VERSION = 'v2';
  var STORAGE_PREFIX = 'quiz_tracker_';
  var KEYS_LIST_KEY  = 'quiz_tracker_keys';

  /* ── Auto-detect config & questions source ── */
  function getConfig() {
    return (typeof QUIZ_CONFIG !== 'undefined' && QUIZ_CONFIG)
      || (typeof BANK_CONFIG !== 'undefined' && BANK_CONFIG)
      || { uid: location.pathname, title: document.title };
  }
  function getQuestions() {
    return (typeof SESSION_QUESTIONS !== 'undefined' && SESSION_QUESTIONS && SESSION_QUESTIONS.length)
      ? SESSION_QUESTIONS
      : (typeof QUESTIONS !== 'undefined' ? QUESTIONS : []);
  }

  /* ── Path-based group resolution ── */
  var _rootName = '';
  try {
    _rootName = new URL(EngineShared.ENGINE_BASE || '', location.href).pathname
      .replace(/\/$/, '').replace(/^\//, '');
  } catch (e) {}

  function _normStoredPath(p) {
    if (!p) return '';
    var s = p.replace(/^\//, '');
    if (_rootName && s.indexOf(_rootName + '/') === 0) {
      s = s.substring(_rootName.length + 1);
    } else if (_rootName && s === _rootName) {
      s = '';
    }
    return s;
  }

  function getFolderSegments(path) {
    var cleaned = path.replace(/\/[^/]*$/, '').replace(/^\//, '');
    if (_rootName && cleaned.indexOf(_rootName + '/') === 0) {
      cleaned = cleaned.substring(_rootName.length + 1);
    } else if (_rootName && cleaned === _rootName) {
      cleaned = '';
    }
    var parts = cleaned.split('/').filter(Boolean);
    var segments = [];
    for (var i = 0; i < parts.length; i++) {
      segments.push(parts.slice(0, i + 1).join('/'));
    }
    return segments;
  }

  function getStorageKey(uid) {
    return STORAGE_PREFIX + TRACKER_VERSION + '_' + uid;
  }

  function computeFolderPath() {
    try {
      var rootUrl = EngineShared.ENGINE_BASE || '';
      var rootAbs = new URL(rootUrl, location.href).href;
      var pageAbs = location.href;
      var relative = pageAbs.substring(rootAbs.length);
      var folderPath = relative.replace(/[^/]*$/, '');
      return folderPath || '';
    } catch (e) {
      var cleaned = location.pathname.replace(/^\//, '');
      var parts = cleaned.split('/');
      if (parts.length > 1) return parts.slice(0, -1).join('/') + '/';
      return '';
    }
  }

  var _folderTitleCache = {};
  var _eagerFolderTitle = null;

  function fetchAndCacheFolderTitle(folderPath) {
    if (!folderPath || _folderTitleCache[folderPath]) {
      return Promise.resolve(_folderTitleCache[folderPath] || null);
    }
    var rootAbs = '';
    try { rootAbs = new URL(EngineShared.ENGINE_BASE || '', location.href).href; } catch(e) { rootAbs = ''; }
    var indexUrl = rootAbs + folderPath + 'index.html';
    return fetch(indexUrl)
      .then(function(resp) { return resp.ok ? resp.text() : null; })
      .then(function(html) {
        if (!html) return null;
        var match = html.match(/<title>([^<]+)<\/title>/i);
        if (match) {
          var rawTitle = match[1].trim();
          var cleaned = rawTitle.replace(/^(?:QuizTool|MU61\s+Quiz|Mansoura\s+MCQ)\s*[-–—]\s*/i, '').trim();
          if (cleaned) {
            _folderTitleCache[folderPath] = cleaned;
            _eagerFolderTitle = rawTitle;
          }
          return rawTitle;
        }
        return null;
      })
      .catch(function() { return null; });
  }

  (function() {
    try {
      var fp = computeFolderPath();
      if (fp) fetchAndCacheFolderTitle(fp).then(function(t) { if (t) _eagerFolderTitle = t; });
    } catch(e) {}
  })();

  function getSafeTrackerKeys() {
    try {
      var raw = localStorage.getItem(KEYS_LIST_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) {
      console.warn('Recovered corrupted tracker keys list');
      return [];
    }
  }

  function getAllTrackerData() {
    try {
      var keys = getSafeTrackerKeys();
      var results = [];
      keys.forEach(function(uid) {
        var raw = localStorage.getItem(getStorageKey(uid));
        if (raw) try { results.push(JSON.parse(raw)); } catch(e) {}
      });
      return results;
    } catch(e) { return []; }
  }

  function getTrackerDataForScope(scope, scopePath) {
    var all = getAllTrackerData();
    var cfg = getConfig();

    if (scope === 'quiz') {
      return all.filter(function(d) { return d.uid === cfg.uid; });
    }

    if (scope === 'folder' && scopePath) {
      var target = scopePath.replace(/^\/|\/$/g, '');
      return all.filter(function(d) {
        var fp = (d.folderPath || '').replace(/^\/|\/$/g, '');
        var dp = _normStoredPath(d.path);
        var dpFolder = '';
        if (dp) {
          var dpParts = dp.split('/');
          if (dpParts.length > 1) {
            dpFolder = dpParts.slice(0, -1).join('/').replace(/^\/|\/$/g, '');
          }
        }
        return (fp && (fp === target || fp.indexOf(target + '/') === 0))
            || (dpFolder && (dpFolder === target || dpFolder.indexOf(target + '/') === 0));
      });
    }

    return all;
  }

  function updateDashboardBadge() {
    var keys = getSafeTrackerKeys();
    var total = 0;
    keys.forEach(function(uid) {
      var raw = localStorage.getItem(getStorageKey(uid));
      if (!raw) return;
      var wMatch = raw.match(/"wrongCount"\s*:\s*(\d+)/);
      var fMatch = raw.match(/"flaggedCount"\s*:\s*(\d+)/);
      if (wMatch || fMatch) {
        total += (wMatch ? parseInt(wMatch[1], 10) : 0) + (fMatch ? parseInt(fMatch[1], 10) : 0);
      }
    });
    var badge = document.getElementById('tracker-badge');
    if (badge) {
      badge.textContent = total > 0 ? total : '';
      badge.style.display = total > 0 ? 'flex' : 'none';
    }
  }

  /* ── Parameterized saveTrackerData ── */
  function saveTrackerData(params) {
    try {
      var cfg = params.config || getConfig();
      var qs  = params.questions || getQuestions();
      if (!qs.length) return;

      var st = params.state;
      var keys = params.keys;
      var sessionIndices = params.sessionIndices;
      var questionBank = params.questionBank;
      var onNavigate = params.onNavigate || (function(e) { if (e) e.preventDefault(); window.location.href = 'index.html'; });
      var onToast = params.onToast || EngineShared.showToast;

      var wrongQs = [], flaggedQs = [];
      var currentSessionIndices = {};
      var currentSessionTexts = {};
      var hasGlobalIndices = sessionIndices && sessionIndices.length;

      qs.forEach(function(q, i) {
        var ans = st.answers ? st.answers[i] : undefined;
        var isWrong   = ans !== undefined && ans !== q.correct;
        var isFlagged = st.flagged && st.flagged[i];

        var qIdx = hasGlobalIndices ? sessionIndices[i] : (q.idx !== undefined ? q.idx : i);

        if (hasGlobalIndices || q.idx !== undefined) {
          currentSessionIndices[qIdx] = true;
        } else {
          currentSessionTexts[q.question] = true;
        }

        var qData = {
          idx: qIdx,
          text: q.question,
          yourAnswer:   ans !== undefined ? keys[ans] + '. ' + q.options[ans] : 'Not answered',
          correctAnswer: keys[q.correct] + '. ' + q.options[q.correct],
          explanation: q.explanation || ''
        };
        if (isWrong)   wrongQs.push(qData);
        if (isFlagged) flaggedQs.push(qData);
      });

      var storageKey = getStorageKey(cfg.uid || location.pathname);
      var existingRaw = localStorage.getItem(storageKey);
      var existingData = null;
      if (existingRaw) {
        try { existingData = JSON.parse(existingRaw); } catch (e) {}
      }

      if (existingData) {
        var oldWrong = (existingData.wrong || []).filter(function(wq) {
          if (hasGlobalIndices || wq.idx !== undefined) {
            return !currentSessionIndices[wq.idx];
          } else {
            return !currentSessionTexts[wq.text];
          }
        });
        var oldFlagged = (existingData.flagged || []).filter(function(fq) {
          if (hasGlobalIndices || fq.idx !== undefined) {
            return !currentSessionIndices[fq.idx];
          } else {
            return !currentSessionTexts[fq.text];
          }
        });
        wrongQs = oldWrong.concat(wrongQs);
        flaggedQs = oldFlagged.concat(flaggedQs);
      }

      if (!wrongQs.length && !flaggedQs.length) {
        localStorage.removeItem(storageKey);
        var keysList = getSafeTrackerKeys();
        localStorage.setItem(KEYS_LIST_KEY, JSON.stringify(keysList.filter(function(k) { return k !== (cfg.uid || location.pathname); })));
        updateDashboardBadge();
        return;
      }

      var folderPath = computeFolderPath();

      var data = {
        uid:         cfg.uid || location.pathname,
        title:       cfg.title || document.title,
        timestamp:   Date.now(),
        totalQs:     typeof questionBank !== 'undefined' ? questionBank.length : (existingData ? Math.max(existingData.totalQs || 0, qs.length) : qs.length),
        wrongCount:  wrongQs.length,
        flaggedCount: flaggedQs.length,
        wrong:       wrongQs,
        flagged:     flaggedQs,
        path:        location.pathname,
        folderPath:  folderPath
      };

      var cachedTitle = _eagerFolderTitle || _folderTitleCache[folderPath] || null;
      function _persistTracker(folderTitle) {
        if (folderTitle) data.folderTitle = folderTitle;
        try {
          localStorage.setItem(getStorageKey(data.uid), JSON.stringify(data));
          var keysList = getSafeTrackerKeys();
          if (keysList.indexOf(data.uid) === -1) { keysList.push(data.uid); }
          localStorage.setItem(KEYS_LIST_KEY, JSON.stringify(keysList));
          updateDashboardBadge();
        } catch (e) {
          if (e.name === 'QuotaExceededError' || e.code === 22) {
            onToast('Storage full! Clear tracker data to continue tracking mistakes.', [
              { label: 'Go to Menu', primary: true, onClick: onNavigate }
            ]);
          }
        }
      }
      if (cachedTitle) {
        _persistTracker(cachedTitle);
      } else {
        fetchAndCacheFolderTitle(folderPath).then(_persistTracker).catch(function() { _persistTracker(null); });
      }
    } catch (e) { console.error('Tracker save error:', e); }
  }

  /* ── Export ── */
  window.EngineTracker = {
    getConfig: getConfig,
    getQuestions: getQuestions,
    _normStoredPath: _normStoredPath,
    getFolderSegments: getFolderSegments,
    getStorageKey: getStorageKey,
    computeFolderPath: computeFolderPath,
    fetchAndCacheFolderTitle: fetchAndCacheFolderTitle,
    getSafeTrackerKeys: getSafeTrackerKeys,
    getAllTrackerData: getAllTrackerData,
    getTrackerDataForScope: getTrackerDataForScope,
    updateDashboardBadge: updateDashboardBadge,
    saveTrackerData: saveTrackerData
  };
})();
