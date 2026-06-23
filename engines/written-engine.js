/* ================================================================
   written-engine.js - Standalone written-answer assessment engine.
   Consumes WRITTEN_CONFIG and WRITTEN_QUESTIONS from written files.
   ================================================================ */
(function () {
  'use strict';

  var ENGINE_BASE = EngineShared.ENGINE_BASE || (window.__WRITTEN_ENGINE_BASE || '');

  var sourceData = readWrittenData();
  var config = normalizeConfig(sourceData.config);
  var questions = normalizeQuestions(sourceData.questions);
  var currentIndex = 0;
  var answerSaveTimer = null;
  var _gradingChildIdx = null; // tracks which child is being graded (null = parent-level)
  var _gradingIsBatch = false; // true when grading all children at once
  var state = {
    answers: {},
    evaluations: {},
    flagged: {},
    photoAnswers: {},
    childAnswers: {},
    childEvaluations: {}
  };

  var STORAGE = {
    theme: 'quiz-theme',
    apiKey: 'gemini_api_key',
    model: 'gemini_selected_model',
    progress: 'quiz_progress_v1_' + config.uid,
    maxWait: 'gemini_max_wait',
    retryLevel: 'gemini_retry_level'
  };

  var _gradingAbortController = null;
  var _loadingTimerInterval = null;
  var _loadingStartTime = 0;
  var _cachedContentName = null; // Gemini explicit cache name for the active session
  var _cacheModelId = null;       // model ID the active cache was created for
  var _cacheRefreshCount = 0;    // refreshes used this session (cap: 1)
  var _cacheRefreshing  = false; // guard against concurrent refreshes

  /* ── API key access (thin wrappers over EngineShared) ────────── */
  function _readKey()        { return EngineShared.airReadGeminiKey(); }
  function _writeKey(plain)  { EngineShared.airWriteGeminiKey(plain); }

  function md(text) {
    if (!text) return '';
    var html = String(text)
      .replace(/\\([*_~`#\[\]()>!|\\-])/g, '$1')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var lines = html.split('\n').map(function(l) { return l.replace(/\r$/, ''); });
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].charAt(0) === '|' && i + 1 < lines.length && /^\|[-| :]+\|$/.test(lines[i + 1])) {
        out.push('<table><thead><tr>');
        lines[i].split('|').slice(1, -1).forEach(function(c) { out.push('<th>' + c.trim() + '</th>'); });
        out.push('</tr></thead><tbody>');
        i += 2;
        while (i < lines.length && lines[i].charAt(0) === '|') {
          out.push('<tr>');
          lines[i].split('|').slice(1, -1).forEach(function(c) { out.push('<td>' + c.trim() + '</td>'); });
          out.push('</tr>');
          i++;
        }
        out.push('</tbody></table>');
        i--;
      } else if (lines[i] !== '') {
        if (out.length) out.push('<br>');
        out.push(lines[i]);
      }
    }
    html = out.join('');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    return html;
  }

  function _getModelLabel(modelId) {
    for (var i = 0; i < MODELS.length; i++) {
      if (MODELS[i][0] === modelId) return MODELS[i][1];
    }
    return modelId;
  }

  function _getMaxWaitMs() {
    var v = localStorage.getItem(STORAGE.maxWait) || '15';
    var n = parseInt(v, 10);
    return n > 0 ? n * 1000 : 0;
  }

  function _getRetryLevel() {
    return localStorage.getItem(STORAGE.retryLevel) || 'balanced';
  }

  var MODELS = [
    ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite (default, fast & modern)'],
    ['gemma-4-26b-a4b-it', 'Gemma 4 26B IT (open model, strong & free)'],
    ['gemma-4-31b-it', 'Gemma 4 31B IT (larger open model)'],
    ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite (older, deprecating soon)'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash (older, deprecating soon)']
  ];

  function pickField(obj) {
    var fields = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < fields.length; i++) {
      var val = obj[fields[i]];
      if (val !== null && val !== undefined) return val;
    }
    return undefined;
  }

  function normalizeConfig(raw) {
    var title = textOr(pickField(raw, 'title', 'name', 'quizName', 'assessment_name', 'assessmentName'), 'Written Assessment');
    return {
      uid: textOr(pickField(raw, 'uid', 'id', 'quizId', 'uniqueId'), slugify(title) || 'written_assessment'),
      title: title,
      description: textOr(pickField(raw, 'description', 'desc', 'subtitle', 'intro'), 'Answer in your own words, compare with the model answer, and save your review progress.'),
      icon: textOr(pickField(raw, 'icon', 'emoji', 'icon_emoji'), 'WA')
    };
  }

  function readWrittenData() {
    var data = { config: {}, questions: [] };

    try {
      if (typeof WRITTEN_CONFIG !== 'undefined') data.config = WRITTEN_CONFIG;
    } catch (error) {}
    if (!data.config || !Object.keys(data.config).length) {
      data.config = window.WRITTEN_CONFIG || {};
    }

    try {
      if (typeof WRITTEN_QUESTIONS !== 'undefined') data.questions = WRITTEN_QUESTIONS;
    } catch (error) {}
    if (!Array.isArray(data.questions)) {
      data.questions = window.WRITTEN_QUESTIONS || [];
    }

    if ((!data.config || !Object.keys(data.config).length) || !Array.isArray(data.questions) || !data.questions.length) {
      var recovered = recoverWrittenDataFromScripts();
      if (!data.config || !Object.keys(data.config).length) data.config = recovered.config || {};
      if (!Array.isArray(data.questions) || !data.questions.length) data.questions = recovered.questions || [];
    }

    return data;
  }

  function recoverWrittenDataFromScripts() {
    var recovered = { config: {}, questions: [] };
    $all('script').some(function (script) {
      var text = script.textContent || '';
      if (!text || text.indexOf('WRITTEN_') === -1) return false;
      recovered.config = extractConstValue(text, 'WRITTEN_CONFIG') || recovered.config;
      recovered.questions = extractConstValue(text, 'WRITTEN_QUESTIONS') || recovered.questions;
      return recovered.config && Object.keys(recovered.config).length && Array.isArray(recovered.questions) && recovered.questions.length;
    });
    return recovered;
  }

  function extractConstValue(source, name) {
    var patterns = ['const ' + name + ' =', 'var ' + name + ' =', 'let ' + name + ' ='];
    var start = -1;
    for (var p = 0; p < patterns.length; p++) {
      start = source.indexOf(patterns[p]);
      if (start !== -1) {
        start += patterns[p].length;
        break;
      }
    }
    if (start === -1) return null;
    var end = findStatementEnd(source, start);
    if (end === -1) return null;
    var expression = source.slice(start, end).trim();
    try {
      return Function('"use strict"; return (' + expression + ');')();
    } catch (error) {
      console.error('Could not parse ' + name + ' from written template.', error);
      return null;
    }
  }

  function findStatementEnd(source, start) {
    var quote = null;
    var escape = false;
    var lineComment = false;
    var blockComment = false;
    var depth = 0;

    for (var i = start; i < source.length; i++) {
      var ch = source[i];
      var next = source[i + 1];

      if (lineComment) {
        if (ch === '\n') lineComment = false;
        continue;
      }
      if (blockComment) {
        if (ch === '*' && next === '/') {
          blockComment = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '/' && next === '/') {
        lineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        blockComment = true;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      if (ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) return i;
    }

    return -1;
  }

  function normalizeQuestions(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (q, index) {
      q = q || {};
      var norm = {
        id: textOr(pickField(q, 'id', 'questionId', 'qid', 'uid'), 'wq-' + (index + 1)),
        question: textOr(pickField(q, 'question', 'q', 'prompt', 'text', 'question_text', 'questionText'), 'Untitled written question'),
        modelAnswer: textOr(pickField(q, 'modelAnswer', 'model_answer', 'answer', 'expected_answer', 'expectedAnswer', 'correct_answer', 'correctAnswer', 'model_answer_text'), ''),
        rubric: textOr(pickField(q, 'rubric', 'grading_rubric', 'marking_scheme', 'criteria'), ''),
        explanation: textOr(pickField(q, 'explanation', 'notes', 'note', 'background', 'explanation_text'), ''),
        tags: Array.isArray(q.tags) ? q.tags.map(String).filter(Boolean) : [],
        _hasChildren: false,
        _childCount: 0,
        children: []
      };
      if (Array.isArray(q.children) && q.children.length) {
        norm._hasChildren = true;
        norm._childCount = q.children.length;
        norm.children = q.children.map(function (child, ci) {
          child = child || {};
          return {
            id: textOr(pickField(child, 'id', 'questionId', 'qid', 'uid'), norm.id + '-' + (ci + 1)),
            label: textOr(pickField(child, 'label', 'name', 'part'), ''),
            question: textOr(pickField(child, 'question', 'q', 'prompt', 'text', 'question_text', 'questionText'), ''),
            modelAnswer: textOr(pickField(child, 'modelAnswer', 'model_answer', 'answer', 'expected_answer', 'expectedAnswer', 'correct_answer', 'correctAnswer'), ''),
            rubric: textOr(pickField(child, 'rubric', 'grading_rubric', 'marking_scheme', 'criteria'), ''),
            explanation: textOr(pickField(child, 'explanation', 'notes', 'note', 'background', 'explanation_text'), '')
          };
        });
      }
      return norm;
    });
  }

  function textOr(value, fallback) {
    if (value === null || value === undefined) return fallback;
    var text = String(value).trim();
    return text || fallback;
  }



  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function create(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }



  function initStyles() {
    var style = document.createElement('style');
    style.textContent = [
      ':root{--surface3:#222b3a;--surface-2:var(--surface2);--surface-3:var(--surface3);--accent-soft:rgba(240,165,0,.13);--accent-dim:rgba(240,165,0,.12);--muted:var(--text-muted);--ok:var(--correct);--ok-soft:var(--correct-bg);--bad:var(--wrong);--bad-soft:var(--wrong-bg);--flag:var(--flagged);--flag-soft:var(--flagged-bg);--fast:.18s ease}',
      '[data-theme="light"]{--surface3:#eee9df;--accent-soft:rgba(194,120,3,.12);--accent-dim:rgba(194,120,3,0.10)}',
      '.written-app{height:100%;min-height:100%;display:flex;flex-direction:column;background:var(--bg);color:var(--text)}',
      '.start-shell{width:min(620px,100%)}#theme-start{position:absolute;top:1.5rem;right:1.5rem;z-index:10}',
      '.start-icon{width:64px;height:64px;display:grid;place-items:center;border-radius:16px;background:var(--accent-soft);color:var(--accent);font-weight:800;font-size:1.8rem;margin:0 auto 1.25rem}',
      '.start-card h1{font-family:"Playfair Display",Georgia,serif;font-size:clamp(1.8rem,4vw,2.4rem);line-height:1.2;margin:0 0 .5rem}',
      '.start-card p{margin:0 0 1.25rem;color:var(--muted);font-size:.95rem}',
      '.config-grid{display:grid;grid-template-columns:1fr;gap:.9rem;margin:1.5rem 0;text-align:left}.field-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:1rem}.field-label{display:block;color:var(--accent);font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px}.api-row{display:flex;gap:8px}.api-row input,.field-box select{width:100%;min-width:0;border:1.5px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);padding:.65rem .8rem;outline:0}.api-row input:focus,.field-box select:focus{border-color:var(--accent)}.field-note{font-size:.82rem;color:var(--muted);margin-top:8px}.grading-note{margin-top:10px;padding:10px 12px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface2);color:var(--muted);font-size:.86rem}',
      '.start-actions{display:flex;gap:10px;align-items:center}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--radius);font-weight:700;min-height:40px;padding:.7rem 1.25rem;transition:transform var(--fast),background var(--fast),border-color var(--fast),color var(--fast)}.btn:hover{transform:translateY(-1px)}.btn-primary{background:var(--accent);color:#111}.btn-secondary{background:var(--surface2);border:1.5px solid var(--border);color:var(--text)}.btn-secondary:hover{border-color:var(--accent)}.btn-danger{background:var(--bad-soft);border:1px solid var(--bad);color:var(--bad)}.btn-icon,.icon-btn{width:36px;height:36px;min-width:36px;padding:0;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:var(--surface2);border:1px solid var(--border);color:var(--muted);font-size:1rem;text-decoration:none}.btn-icon:hover,.icon-btn:hover{border-color:var(--accent);color:var(--text)}.btn-icon.danger:hover,.icon-btn.danger:hover{border-color:var(--bad);color:var(--bad)}.settings-gear{transition:transform .3s ease,border-color var(--fast)}.settings-gear:hover{transform:rotate(60deg)}',
      '.practice-screen{flex-direction:column}.layout{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) var(--nav-size);overflow:hidden}',
      '.nav-pane{min-height:0;background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden}',
      '.nav-pane-header{padding:1rem;color:var(--muted);font-size:.78rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid var(--border)}',
      '.legend{display:flex;flex-wrap:wrap;gap:0.4rem 0.75rem;margin-top:8px}.legend-item{display:flex;align-items:center;gap:0.3rem;font-size:0.72rem;color:var(--muted)}.legend-item .dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}',
      '.nav-grid-wrap{flex:1;min-height:0;overflow:auto;padding:.5rem}.nav-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:5px}.nav-btn{aspect-ratio:1;border-radius:8px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text-muted);font-size:.85rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all var(--fast);position:relative;line-height:1;padding:0}.nav-btn:hover{border-color:var(--accent);color:var(--accent)}.nav-btn.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent);box-shadow:0 0 0 2px var(--accent-dim)}.nav-btn.pass{background:var(--ok-soft);border-color:var(--ok);color:var(--ok)}.nav-btn.fail{background:var(--bad-soft);border-color:var(--bad);color:var(--bad)}.nav-btn.flag{background:var(--flag-soft);border-color:var(--flag);color:var(--flag)}.nav-btn.partial{background:rgba(240,165,0,.08);border-color:var(--accent);color:var(--accent)}',
      '.nav-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;padding:.75rem 1rem;border-top:1px solid var(--border)}.stat-item{text-align:center}.stat-item .sv{font-size:1rem;font-weight:700}.stat-item .sl{font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em}.sv.green{color:var(--correct)}.sv.blue{color:var(--flag)}.sv.muted{color:var(--text-muted)}',
      '.content{position:relative;min-width:0;min-height:0;overflow:auto;padding:22px}.work-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;max-width:1100px;margin:0 auto}.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow)}.question-panel{padding:20px}.question-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;color:var(--muted);font-size:.83rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.tag-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.tag{display:inline-flex;align-items:center;min-height:22px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);padding:2px 7px;color:var(--muted);font-size:.76rem;text-transform:none;letter-spacing:0}.question-text{font-size:1.14rem;font-weight:600;white-space:pre-wrap}',
      '.answer-panel{padding:16px}.answer-panel textarea{width:100%;min-height:230px;resize:vertical;border:1.5px solid var(--border);border-radius:var(--radius);background:var(--surface-2);color:var(--text);padding:14px;outline:0;transition:border-color var(--fast),box-shadow var(--fast)}.answer-panel textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.answer-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;flex-wrap:wrap}.counter{color:var(--muted);font-size:.86rem;white-space:nowrap}.action-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}',
      '.feedback{display:none;gap:16px}.feedback.active{display:grid}.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.compare-card{padding:16px;background:var(--surface2)}.compare-card.user{border-left:4px solid var(--flag)}.compare-card.model{border-left:4px solid var(--accent)}.compare-title{color:var(--muted);font-weight:800;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}.compare-body{white-space:pre-wrap;color:var(--text);font-size:.92rem;line-height:1.6}.eval-panel{padding:18px;background:var(--surface-3)}.eval-head{display:flex;align-items:center;gap:14px;margin-bottom:14px}.score{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;font-weight:800;border:3px solid var(--border);background:var(--surface)}.score.pass{border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}.score.fail{border-color:var(--bad);background:var(--bad-soft);color:var(--bad)}.verdict{font-size:1.1rem;font-weight:800}.eval-source{color:var(--muted);font-size:.86rem}.bullet-list{display:grid;gap:8px;margin:12px 0}.bullet{position:relative;padding-left:18px;font-size:.92rem;line-height:1.5}.bullet::before{content:"";position:absolute;left:0;top:.65em;width:7px;height:7px;border-radius:99px;background:var(--accent)}.bullet.good::before{background:var(--ok)}.bullet.gap::before{background:var(--bad)}.feedback-text{border-top:1px solid var(--border);padding-top:12px;margin-top:8px;white-space:pre-wrap;font-size:.92rem;line-height:1.6;color:var(--text)}.manual-bar{display:flex;flex-direction:column;align-items:center;gap:12px;padding:18px 16px;text-align:center}.manual-copy strong{display:block;font-size:.95rem;margin-bottom:2px}.manual-copy span{color:var(--muted);font-size:.86rem}.manual-bar .action-row{justify-content:center}.pass-choice.active{background:var(--ok);border-color:var(--ok);color:white}.fail-choice.active{background:var(--bad);border-color:var(--bad);color:white}',
      '.loading{position:fixed;inset:0;z-index:20;display:none;place-items:center;background:rgba(13,17,23,.72)}[data-theme="light"] .loading{background:rgba(243,240,235,.72)}.loading.active{display:grid}.loading-box{background:var(--surface);border:1px solid var(--accent-dim);border-radius:16px;padding:24px;box-shadow:0 0 24px var(--accent-dim),var(--shadow);text-align:center;max-width:360px;transition:box-shadow .6s ease}.loading-box.glow{box-shadow:0 0 40px var(--accent-soft),var(--shadow)}.brain-icon{font-size:48px;display:block;margin:0 auto 10px;animation:brain-pulse 1.4s ease-in-out infinite;user-select:none}.loading-box strong{display:block;font-size:1.05rem;margin-bottom:4px}@keyframes brain-pulse{0%,100%{transform:scale(1) rotate(0deg)}25%{transform:scale(1.06) rotate(-3deg)}75%{transform:scale(1.06) rotate(3deg)}}.empty{padding:22px;border:1px dashed var(--border);border-radius:12px;background:var(--surface-2);color:var(--muted)}',
      '.child-block{border:1px solid var(--border);border-radius:10px;margin-top:12px;overflow:hidden}.child-header{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 6px;background:var(--surface2);font-weight:600;font-size:.92rem}.child-header .child-label{color:var(--accent);font-weight:700;white-space:nowrap;flex-shrink:0}.child-question{white-space:pre-wrap;color:var(--text)}.child-answer{padding:8px 14px 6px}.child-answer textarea{width:100%;min-height:100px;resize:vertical;border:1.5px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text);padding:10px;outline:0;transition:border-color var(--fast),box-shadow var(--fast);font-size:.92rem}.child-answer textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.child-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 14px 10px;flex-wrap:wrap}.child-counter{color:var(--muted);font-size:.8rem;white-space:nowrap}.child-actions{display:flex;gap:6px;flex-wrap:wrap}.child-actions .btn{min-height:32px;padding:.4rem .85rem;font-size:.82rem}.child-feedback{display:none;border-top:1px solid var(--border);background:var(--surface);padding:12px 14px}.child-feedback.active{display:block}.child-feedback .compare-mini{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.child-feedback .compare-mini-card{padding:10px;background:var(--surface2);border-radius:8px;font-size:.85rem}.child-feedback .compare-mini-card .cm-title{color:var(--muted);font-weight:700;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}.child-feedback .compare-mini-card .cm-body{white-space:pre-wrap;line-height:1.5}.child-feedback .child-eval-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}.child-feedback .child-score{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:.85rem;border:2.5px solid var(--border);background:var(--surface);flex-shrink:0}.child-feedback .child-score.pass{border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}.child-feedback .child-score.fail{border-color:var(--bad);background:var(--bad-soft);color:var(--bad)}.child-feedback .child-verdict{font-weight:700;font-size:.9rem}.child-feedback .child-bullets{display:grid;gap:5px;margin:6px 0}.child-feedback .child-bullet{position:relative;padding-left:15px;font-size:.85rem;line-height:1.4}.child-feedback .child-bullet::before{content:"";position:absolute;left:0;top:.55em;width:6px;height:6px;border-radius:99px;background:var(--accent)}.child-feedback .child-bullet.good::before{background:var(--ok)}.child-feedback .child-bullet.gap::before{background:var(--bad)}.child-feedback .child-feedback-text{border-top:1px solid var(--border);padding-top:8px;margin-top:6px;font-size:.85rem;line-height:1.5;color:var(--text)}.child-feedback .child-manual-actions{display:flex;gap:6px;justify-content:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}.child-feedback .child-manual-actions .btn{min-height:30px;padding:.35rem .75rem;font-size:.8rem}.batch-grade-row{display:flex;gap:8px;justify-content:flex-start;margin-top:8px;padding-top:10px;border-top:2px dashed var(--border)}.batch-grade-row .btn{min-height:36px}.child-reminder{margin:10px 14px 4px;font-size:.82rem;color:var(--muted);padding:8px 10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)}',
      'table{border-collapse:collapse;width:100%;margin:8px 0;font-size:.88rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;overflow:hidden}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--border);vertical-align:top}th{background:var(--surface3);font-weight:700;color:var(--accent);font-size:.82rem;text-transform:uppercase;letter-spacing:.03em}tr:last-child td{border-bottom:0}td:first-child{font-weight:600;white-space:nowrap}[data-theme="light"] td:first-child{font-weight:600}[data-theme="light"] table{background:#fff}',
      '.camera-overlay-open{overflow:hidden}.photo-preview-box{padding:12px;text-align:center}.photo-preview-img{max-height:220px;border-radius:8px;max-width:100%;display:block;margin:0 auto;object-fit:contain;background:var(--surface-2)}.photo-preview-actions{display:flex;justify-content:center;gap:8px;margin-top:10px}.feedback-photo{max-width:100%;max-height:300px;border-radius:8px;display:block;margin:0 auto;border:1px solid var(--border)}.transcription-box{margin-top:12px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;text-align:left}.transcription-label{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px}.transcription-text{font-size:.88rem;line-height:1.6;color:var(--text);white-space:pre-wrap}#camera-video{display:block}#camera-modal .modal{max-width:520px}#camera-crop-section{text-align:center}.crop-container{position:relative;display:inline-block;overflow:hidden;border-radius:10px;background:#000;max-width:100%;max-height:60vh;user-select:none;-webkit-user-select:none;touch-action:none}.crop-container img{display:block;max-width:100%;max-height:60vh;margin:0 auto}.crop-overlay{position:absolute;inset:0;pointer-events:none}.crop-box{position:absolute;border:2px solid var(--accent);cursor:move;pointer-events:auto;touch-action:none;box-shadow:0 0 0 9999px rgba(0,0,0,.55)}.crop-handle{position:absolute;width:28px;height:28px;background:rgba(255,255,255,.9);border:2.5px solid var(--accent);border-radius:4px;z-index:2;pointer-events:auto;touch-action:none;box-sizing:border-box}.crop-handle.nw{top:-14px;left:-14px;cursor:nw-resize}.crop-handle.ne{top:-14px;right:-14px;cursor:ne-resize}.crop-handle.sw{bottom:-14px;left:-14px;cursor:sw-resize}.crop-handle.se{bottom:-14px;right:-14px;cursor:se-resize}.crop-info{text-align:center;color:var(--muted);font-size:.82rem;margin-top:8px}',
      '@media (orientation: portrait) and (max-width:860px){.layout{grid-template-columns:1fr}.nav-pane{border-left:0;border-top:1px solid var(--border);max-height:200px}.nav-grid-wrap{display:flex;overflow-x:auto;overflow-y:hidden;padding-bottom:10px}.nav-grid{grid-template-columns:repeat(auto-fill,minmax(42px,1fr));grid-template-rows:42px;grid-auto-flow:column;gap:5px}.nav-btn{width:42px;height:42px;min-width:42px;aspect-ratio:unset;border-radius:6px}}',
      '@media (max-width:860px){.config-grid,.compare-grid{grid-template-columns:1fr}.layout{grid-template-columns:1fr}.nav-pane{border-left:0;border-top:1px solid var(--border);max-height:200px}.nav-grid-wrap{display:flex;overflow-x:auto;overflow-y:hidden;padding-bottom:10px}.nav-grid{grid-template-columns:repeat(auto-fill,minmax(42px,1fr));grid-template-rows:42px;grid-auto-flow:column;gap:5px}.nav-btn{width:42px;height:42px;min-width:42px;aspect-ratio:unset;border-radius:6px}.content{padding:16px}.manual-bar{align-items:center}.action-row{justify-content:flex-start}.manual-bar .action-row{justify-content:center}}',
      '@media (max-width:560px){.start-screen{padding:14px}.start-card{padding:20px}.start-actions,.answer-foot{align-items:stretch;flex-direction:column}.start-actions .btn,.answer-foot .btn,.manual-bar .btn{width:100%}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function initMarkup() {
    document.title = config.title;
    document.body.innerHTML = '';

    var app = create('div', 'written-app');
    app.innerHTML = [
      '<section class="screen start-screen active" id="start-screen">',
      '  <a class="hub-back-btn" href="index.html" id="hub-link-start">',
      '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">',
      '      <line x1="19" y1="12" x2="5" y2="12"></line>',
      '      <polyline points="12 19 5 12 12 5"></polyline>',
      '    </svg>',
      '    Back to Hub',
      '  </a>',
      '  <button class="btn btn-icon" id="theme-start" type="button" title="Toggle theme">☀</button>',
      '  <div class="start-shell">',
      '    <div class="start-card">',
      '      <div class="start-icon" id="start-icon"></div>',
      '      <h1 id="start-title"></h1>',
      '      <p id="start-description"></p>',
      '      <div class="meta-grid">',
      '        <div class="meta-item">',
      '          <span class="val" id="start-q-count">—</span>',
      '          <span class="lbl">Questions</span>',
      '        </div>',
      '      </div>',
      '      <div class="config-grid">',
      '        <div class="field-box">',
      '          <label class="field-label" for="model-select" style="margin-bottom:8px">AI model</label>',
      '          <div class="api-row">',
      '            <select id="model-select"></select>',
      '            <button class="btn btn-icon settings-gear" id="settings-btn" type="button" title="API Key Settings ⚙">⚙</button>',
      '          </div>',
      '          <div class="field-note" id="question-count"></div>',
      '        </div>',
      '      </div>',
      '      <div class="start-actions">',
      '        <button class="btn btn-primary" id="begin-assessment" type="button">Begin Assessment</button>',
      '        <button class="btn btn-secondary" id="resume-last" type="button">Resume Saved Work</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</section>',
      '<section class="screen practice-screen" id="practice-screen">',
      '  <header class="topbar">',
      '    <div class="topbar-title" id="practice-title"></div>',
      '    <div class="topbar-spacer"></div>',
      '    <div class="topbar-actions">',
      '      <button class="icon-btn" id="flag-question" type="button" title="Flag question">⚑</button>',
      '      <a class="icon-btn" href="index.html" id="hub-link-practice" title="Back to Hub">🏠</a>',
      '      <button class="icon-btn" id="theme-practice" type="button" title="Toggle theme">☀</button>',
      '      <button class="icon-btn danger" id="reset-progress" type="button" title="Reset Progress">↻</button>',
      '    </div>',
      '  </header>',
      '  <div class="loading" id="loading"><div class="loading-box" id="loading-box"><div class="brain-icon">🧠</div><strong>Analyzing your answer</strong><div class="field-note" id="loading-note"></div><div class="field-note" id="loading-timer" style="font-size:.85rem;color:var(--accent);margin-top:4px;font-weight:600"></div><button class="btn btn-secondary" id="cancel-grading" type="button" style="margin-top:10px;display:none">Cancel</button></div></div>',
      '  <div class="layout">',
      '    <main class="content">',
      '      <div class="work-grid" id="work-grid">',
      '        <section class="panel question-panel" id="question-panel">',
      '          <div class="question-meta"><span id="question-number"></span><div class="tag-row" id="tag-row"></div></div>',
      '          <div class="question-text" id="question-text"></div>',
      '        </section>',
      '        <section class="panel answer-panel" id="answer-panel">',
      '          <textarea id="answer-input" placeholder="Write your answer here..."></textarea>',
      '          <div id="photo-answer-area" style="display:none">',
      '            <div class="photo-preview-box">',
      '              <img class="photo-preview-img" id="photo-preview-img">',
      '              <div class="photo-preview-actions">',
      '                <button class="btn btn-secondary" id="photo-retake-btn" type="button">📷 Retake</button>',
      '                <button class="btn btn-secondary" id="photo-remove-btn" type="button">Remove</button>',
      '              </div>',
      '            </div>',
      '          </div>',
      '          <div class="answer-foot">',
      '            <div class="counter" id="answer-counter">0 words | 0 characters</div>',
      '            <div class="action-row">',
      '              <button class="btn btn-secondary" id="skip-question" type="button">Skip</button>',
      '              <button class="btn btn-secondary" id="photo-toggle" type="button">📷 Photo</button>',
      '              <button class="btn btn-secondary" id="self-grade" type="button">Manual Grade</button>',
      '              <button class="btn btn-primary" id="ai-grade" type="button">Grade with AI</button>',
      '            </div>',
      '          </div>',
      '          <div class="grading-note" id="grading-note">Grading tries AI first. If AI is unavailable or the request fails, this screen automatically falls back to manual grading and tells you why.</div>',
      '        </section>',
      '        <div class="children-container" id="children-container" style="display:none"></div>',
      '        <section class="feedback" id="feedback">',
      '          <div class="compare-grid">',
      '            <article class="panel compare-card user"><div class="compare-title">Your answer</div><div class="compare-body" id="feedback-user"></div></article>',
      '            <article class="panel compare-card model"><div class="compare-title">Model answer</div><div class="compare-body" id="feedback-model"></div></article>',
      '          </div>',
      '          <article class="panel eval-panel">',
      '            <div class="eval-head"><div class="score" id="score"></div><div><div class="verdict" id="verdict"></div><div class="eval-source" id="eval-source"></div></div></div>',
      '            <div class="bullet-list" id="bullet-list"></div>',
      '            <div class="feedback-text" id="feedback-text"></div>',
      '          </article>',
      '          <div class="panel manual-bar">',
      '            <div class="manual-copy"><strong>Final mark for this question</strong><span>Use these buttons to override the AI or complete self grading.</span></div>',
      '            <div class="action-row">',
      '              <button class="btn btn-secondary fail-choice" id="mark-fail" type="button">Fail</button>',
      '              <button class="btn btn-secondary pass-choice" id="mark-pass" type="button">Pass</button>',
      '              <button class="btn btn-secondary" id="retry-question" type="button">↺ Retry</button>',
      '              <button class="btn btn-primary" id="next-question" type="button">Next</button>',
      '            </div>',
      '          </div>',
      '        </section>',
      '      </div>',
      '    </main>',
      '    <aside class="nav-pane">',
      '      <div class="nav-pane-header">',
      '        Questions',
      '        <div class="legend">',
      '          <div class="legend-item"><div class="dot answered"></div> Done</div>',
      '          <div class="legend-item"><div class="dot wrong"></div> Wrong</div>',
      '          <div class="legend-item"><div class="dot flagged"></div> Flagged</div>',
      '          <div class="legend-item"><div class="dot unanswered"></div> Skipped</div>',
      '        </div>',
      '      </div>',
      '      <div class="nav-grid-wrap">',
      '        <div class="nav-grid" id="question-list"></div>',
      '      </div>',
      '      <div class="nav-stats">',
      '        <div class="stat-item"><div class="sv green" id="stat-done">0</div><div class="sl">Done</div></div>',
      '        <div class="stat-item"><div class="sv blue" id="stat-flagged">0</div><div class="sl">Flagged</div></div>',
      '        <div class="stat-item"><div class="sv muted" id="stat-skipped">0</div><div class="sl">Skipped</div></div>',
      '      </div>',
      '    </aside>',
      '  </div>',
      '</section>',
      '<div class="modal-overlay" id="reset-modal">',
      '  <div class="modal">',
      '    <h3>Reset Progress?</h3>',
      '    <p>Are you sure you want to reset your progress? This cannot be undone.</p>',
      '    <div class="modal-actions">',
      '      <button class="btn btn-cancel" id="close-reset-modal">Go Back</button>',
      '      <button class="btn btn-confirm danger" id="confirm-reset-action">Reset Now</button>',
      '    </div>',
      '  </div>',
      '</div>',
      '<section class="screen result-screen" id="result-screen">',
      '  <header class="result-topbar">',
      '    <h2>Assessment Results</h2>',
      '    <div class="topbar-actions">',
      '      <a class="icon-btn" href="index.html" id="hub-link-result" title="Back to Hub">🏠</a>',
      '      <button class="icon-btn" id="theme-result" type="button" title="Toggle theme">☀</button>',
      '      <button class="icon-btn danger" id="reset-result" type="button" title="Reset Progress">↻</button>',
      '    </div>',
      '  </header>',
      '  <div class="result-body">',
      '    <div class="score-banner">',
      '      <div class="score-circle">',
      '        <div class="pct" id="res-pct">0%</div>',
      '        <div class="lbl">Pass Rate</div>',
      '      </div>',
      '      <div class="score-details">',
      '        <h3 id="res-grade">Ready</h3>',
      '        <div class="score-grid">',
      '          <div class="score-stat"><div class="n green" id="res-passed">0</div><div class="t">Passed</div></div>',
      '          <div class="score-stat"><div class="n red" id="res-failed">0</div><div class="t">Failed</div></div>',
      '          <div class="score-stat"><div class="n blue" id="res-flagged">0</div><div class="t">Flagged</div></div>',
      '          <div class="score-stat"><div class="n muted" id="res-skipped">0</div><div class="t">Skipped</div></div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="pdf-export-section">',
      '      <div class="export-options">',
      '        <label class="export-option">',
      '          <input type="checkbox" name="export-all" checked onchange="onExportFilterChange(this)">',
      '          <span class="export-checkbox-visual"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></span>',
      '          <span class="export-label">All</span>',
      '          <span class="export-badge" id="badge-all">0</span>',
      '        </label>',
      '        <label class="export-option">',
      '          <input type="checkbox" name="export-failed" onchange="onExportFilterChange(this)">',
      '          <span class="export-checkbox-visual"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></span>',
      '          <span class="export-label">Failed</span>',
      '          <span class="export-badge" id="badge-failed">0</span>',
      '        </label>',
      '        <label class="export-option">',
      '          <input type="checkbox" name="export-flagged" onchange="onExportFilterChange(this)">',
      '          <span class="export-checkbox-visual"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></span>',
      '          <span class="export-label">Flagged</span>',
      '          <span class="export-badge" id="badge-flagged">0</span>',
      '        </label>',
      '      </div>',
      '      <button class="btn-export-pdf" onclick="exportToPDF()">',
      '        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">',
      '          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>',
      '          <polyline points="14 2 14 8 20 8"></polyline>',
      '          <line x1="16" y1="13" x2="8" y2="13"></line>',
      '          <line x1="16" y1="17" x2="8" y2="17"></line>',
      '          <polyline points="10 9 9 9 8 9"></polyline>',
      '        </svg>',
      '        Export to PDF',
      '      </button>',
      '    </div>',
      '    <div class="result-tabs">',
      '      <button class="tab-btn active" onclick="filterResults(\'all\', this)">All Questions</button>',
      '      <button class="tab-btn" onclick="filterResults(\'pass\', this)">✓ Passed</button>',
      '      <button class="tab-btn" onclick="filterResults(\'fail\', this)">✗ Failed</button>',
      '      <button class="tab-btn" onclick="filterResults(\'skipped\', this)">— Skipped</button>',
      '      <button class="tab-btn" onclick="filterResults(\'flagged\', this)">⚑ Flagged</button>',
      '    </div>',
      '    <div class="result-list" id="result-list"></div>',
      '    <div class="result-actions">',
      '      <button class="btn-restart" onclick="restartAssessment()">↺ Start Again</button>',
      '      <a class="btn-restart btn-secondary" href="index.html" id="hub-link-result-action">🏠 Return to Hub</a>',
      '    </div>',
      '  </div>',
      '</section>',
      '<input type="file" id="photo-file-input" accept="image/*" style="display:none">',
      '<div class="modal-overlay" id="camera-modal">',
      '  <div class="modal" style="max-width:520px">',
      '    <div class="dash-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">',
      '      <h3 style="margin:0">📷 Capture Answer Photo</h3>',
      '      <button class="icon-btn" id="camera-close-btn" type="button" title="Close">✕</button>',
      '    </div>',
      '    <div id="camera-viewfinder-section">',
      '      <video id="camera-video" autoplay playsinline style="width:100%;border-radius:10px;background:#000;max-height:60vh;display:block"></video>',
      '      <canvas id="camera-canvas" style="display:none"></canvas>',
      '      <div style="display:flex;justify-content:center;gap:1rem;margin-top:1rem;align-items:center">',
      '        <button class="btn btn-secondary" id="camera-upload-btn" type="button">📁 Upload</button>',
      '        <button class="btn btn-primary" id="camera-capture-btn" type="button" style="width:56px;height:56px;border-radius:50%;font-size:1.8rem;padding:0;display:flex;align-items:center;justify-content:center">●</button>',
      '        <button class="btn btn-icon" id="camera-switch-btn" type="button" title="Switch camera">🔄</button>',
      '      </div>',
      '    </div>',
      '    <div id="camera-crop-section" style="display:none">',
      '      <div class="crop-container" id="crop-container">',
      '        <img id="crop-image" alt="Crop preview">',
      '        <div class="crop-overlay">',
      '          <div class="crop-box" id="crop-box">',
      '            <div class="crop-handle nw"></div>',
      '            <div class="crop-handle ne"></div>',
      '            <div class="crop-handle sw"></div>',
      '            <div class="crop-handle se"></div>',
      '          </div>',
      '        </div>',
      '      </div>',
      '      <div class="crop-info">Drag the box or resize handles to select the answer area</div>',
      '      <div style="display:flex;justify-content:center;gap:1rem;margin-top:1rem">',
      '        <button class="btn btn-secondary" id="crop-retake-btn" type="button">Retake</button>',
      '        <button class="btn btn-primary" id="crop-use-btn" type="button">Crop &amp; Use</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="modal-overlay" id="settings-modal">',
      '  <div class="modal" style="max-width:440px">',
      '    <div class="dash-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">',
      '      <h3 style="margin:0">⚙ Settings</h3>',
      '      <button class="icon-btn" id="settings-close-btn" type="button" title="Close">✕</button>',
      '    </div>',
    '    <div class="field-box">',
      '      <label class="field-label" for="settings-api-key">Gemini API Key</label>',
      '      <div class="api-row">',
      '        <input id="settings-api-key" type="password" autocomplete="off" placeholder="Enter your Gemini API key">',
      '        <button class="btn btn-icon" id="settings-key-toggle" type="button" title="Show/Hide key">👁</button>',
      '      </div>',
      '      <div class="field-note">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank">AI Studio</a>. Manual grading works without a key.</div>',
      '      <div style="display:flex;gap:8px;margin-top:10px">',
      '        <button class="btn btn-primary" id="settings-save-btn" type="button">Save</button>',
      '        <button class="btn btn-secondary" id="settings-clear-btn" type="button">Clear</button>',
      '        <button class="btn btn-secondary" id="settings-test-btn" type="button">Test Connection</button>',
      '      </div>',
      '      <div id="settings-status" style="margin-top:8px;font-size:.85rem;color:var(--muted)"></div>',
      '    </div>',
      '    <div class="field-box" style="margin-top:12px">',
      '      <label class="field-label">Grading</label>',
      '      <div style="display:grid;gap:10px">',
      '        <div><label style="font-size:.82rem;color:var(--text);display:block;margin-bottom:4px">Max wait per request</label><select id="settings-max-wait"><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="0">No limit</option></select></div>',
      '        <div><label style="font-size:.82rem;color:var(--text);display:block;margin-bottom:4px">Retry on failure</label><select id="settings-retry-level"><option value="fast">Fast (1 attempt)</option><option value="balanced">Balanced (2 attempts)</option><option value="thorough">Thorough (4 attempts)</option></select></div>',
      '      </div>',
      '      <div class="field-note">These settings control how long the AI waits before falling back to manual grading.</div>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div id="toast" class="toast"></div>'
    ].join('');

    document.body.appendChild(app);
  }

  function initContent() {
    $('#start-icon').textContent = config.icon;
    $('#start-title').textContent = config.title;
    $('#start-description').textContent = config.description;
    $('#practice-title').textContent = config.title;
    $('#start-q-count').textContent = questions.length;
    $('#question-count').textContent = questions.length + ' question' + (questions.length === 1 ? '' : 's');

    var modelSelect = $('#model-select');
    modelSelect.innerHTML = '';
    MODELS.forEach(function (model) {
      var option = document.createElement('option');
      option.value = model[0];
      option.textContent = model[1];
      modelSelect.appendChild(option);
    });
    var savedModel = localStorage.getItem(STORAGE.model);
    modelSelect.value = modelIsAvailable(savedModel) ? savedModel : MODELS[0][0];
    if (savedModel && !modelIsAvailable(savedModel)) {
      localStorage.setItem(STORAGE.model, MODELS[0][0]);
    }
    updateThemeButtons();
    updateResumeButton();
    if (!_readKey()) {
      setTimeout(function () {
        EngineShared.showToast('⚙ Set your Gemini API key in Settings for AI grading');
      }, 500);
    }
  }

  function bindEvents() {
    $('#theme-start').addEventListener('click', function() { EngineShared.toggleTheme(); updateThemeButtons(); });
    $('#theme-practice').addEventListener('click', function() { EngineShared.toggleTheme(); updateThemeButtons(); });
    $('#settings-btn').addEventListener('click', openSettings);
    $('#settings-close-btn').addEventListener('click', closeSettings);
    $('#settings-save-btn').addEventListener('click', saveSettingsKey);
    $('#settings-clear-btn').addEventListener('click', clearSettingsKey);
    $('#settings-test-btn').addEventListener('click', testSettingsKey);
    $('#settings-key-toggle').addEventListener('click', toggleKeyVisibility);
    $('#settings-modal').addEventListener('click', function (e) {
      if (e.target === this) closeSettings();
    });
    $('#model-select').addEventListener('change', function () {
      localStorage.setItem(STORAGE.model, this.value);
    });
    $('#begin-assessment').addEventListener('click', beginAssessment);
    $('#resume-last').addEventListener('click', beginAssessment);
    $('#reset-progress').addEventListener('click', confirmResetProgress);
    $('#close-reset-modal').addEventListener('click', closeResetModal);
    $('#confirm-reset-action').addEventListener('click', confirmResetAction);
    $('#hub-link-practice').addEventListener('click', function () {
      saveProgress();
    });
    $('#flag-question').addEventListener('click', toggleFlag);
    $('#answer-input').addEventListener('input', onAnswerInput);
    $('#skip-question').addEventListener('click', goNext);
    $('#self-grade').addEventListener('click', function () {
      createManualEvaluation({
        source: 'Manual grade',
        feedback: 'Manual grading selected. Compare your response with the model answer, then choose Pass or Fail for the final mark.'
      });
    });
    $('#photo-toggle').addEventListener('click', openCamera);
    $('#camera-close-btn').addEventListener('click', closeCamera);
    $('#camera-capture-btn').addEventListener('click', capturePhoto);
    $('#crop-use-btn').addEventListener('click', cropAndUse);
    $('#crop-retake-btn').addEventListener('click', function () {
      $('#camera-crop-section').style.display = 'none';
      $('#camera-viewfinder-section').style.display = 'block';
      if (!_cameraStream) openCamera();
    });
    $('#camera-upload-btn').addEventListener('click', openFilePicker);
    $('#camera-switch-btn').addEventListener('click', switchCamera);
    $('#photo-remove-btn').addEventListener('click', removePhoto);
    $('#photo-retake-btn').addEventListener('click', openCamera);
    $('#photo-file-input').addEventListener('change', handlePhotoFile);
    $('#camera-modal').addEventListener('click', function (e) {
      if (e.target === this) closeCamera();
    });
    $('#cancel-grading').addEventListener('click', function () {
      if (_gradingAbortController) _gradingAbortController.abort();
    });
    $('#settings-max-wait').addEventListener('change', function () {
      localStorage.setItem(STORAGE.maxWait, this.value);
    });
    $('#settings-retry-level').addEventListener('change', function () {
      localStorage.setItem(STORAGE.retryLevel, this.value);
    });
    $('#ai-grade').addEventListener('click', submitForAiGrade);
    $('#mark-pass').addEventListener('click', function () {
      markVerdict('pass');
    });
    $('#mark-fail').addEventListener('click', function () {
      markVerdict('fail');
    });
    $('#retry-question').addEventListener('click', retryQuestion);
    $('#next-question').addEventListener('click', goNext);
    $('#theme-result').addEventListener('click', function() { EngineShared.toggleTheme(); updateThemeButtons(); });
    $('#reset-result').addEventListener('click', confirmResetProgress);

    // Release the cache if the user closes the tab, navigates away, or the
    // browser suspends the page. keepalive: true (set in _deleteGradingCache)
    // lets the DELETE request outlive the page unload.
    window.addEventListener('pagehide', function () {
      _deleteGradingCache();
    });
  }

  function modelIsAvailable(modelId) {
    return MODELS.some(function (model) {
      return model[0] === modelId;
    });
  }

  function showScreen(id) {
    $all('.screen').forEach(function (screen) {
      screen.classList.toggle('active', screen.id === id);
    });
  }

  function beginAssessment() {
    if (!questions.length) {
      EngineShared.showToast('No written questions were found in this assessment.');
      return;
    }
    showScreen('practice-screen');
    renderQuestionList();
    showQuestion(currentIndex);

    // Pre-warm the context cache in the background. All questions in this
    // session will share it. Safe to ignore errors — gradeWithGemini always
    // sends systemInstruction as a fallback on every request.
    var apiKey = _readKey();
    if (apiKey) {
      var modelEl = $('#model-select');
      var modelId = (modelEl && modelEl.value) || localStorage.getItem(STORAGE.model) || MODELS[0][0];
      _cacheRefreshCount = 0;
      _cacheRefreshing   = false;
      _createGradingCache(apiKey, modelId);
    }
  }

  function updateResumeButton() {
    var hasSaved = Object.keys(state.answers).length || Object.keys(state.evaluations).length || Object.keys(state.flagged).length || Object.keys(state.photoAnswers || {}).length
      || Object.keys(state.childAnswers || {}).length || Object.keys(state.childEvaluations || {}).length;
    $('#resume-last').disabled = !hasSaved;
  }

  function renderQuestionList() {
    var list = $('#question-list');
    list.innerHTML = '';
    if (!questions.length) {
      list.appendChild(create('div', 'empty', 'No questions found.'));
      return;
    }

    var doneCount = 0;
    var flaggedCount = 0;
    var skippedCount = 0;

    questions.forEach(function (question, index) {
      var isFlagged = !!state.flagged[index];
      var isDone = false;
      var passed = null;

      if (question._hasChildren) {
        var childEvals = state.childEvaluations[index] || [];
        var doneChildren = childEvals.filter(function (e) { return !!e; }).length;
        if (doneChildren === question._childCount) {
          isDone = true;
          doneCount++;
        } else if (doneChildren > 0) {
          isFlagged = true;
        }
        if (doneChildren === 0 && !isFlagged) skippedCount++;
        if (doneChildren > 0) {
          passed = childEvals.every(function (e) { return e ? isPassed(e) : true; });
        }
      } else {
        var evaluation = state.evaluations[index];
        passed = evaluation ? isPassed(evaluation) : null;
        var isAnswered = !!(state.answers[index] || (state.photoAnswers && state.photoAnswers[index] && state.photoAnswers[index].data));
        if (evaluation) { isDone = true; doneCount++; }
        if (!isAnswered && !evaluation) skippedCount++;
      }

      if (isFlagged) flaggedCount++;

      var btn = create('button', 'nav-btn' + (index === currentIndex ? ' active' : ''));
      btn.type = 'button';
      btn.textContent = index + 1;
      btn.addEventListener('click', function () {
        showQuestion(index);
      });

      if (passed === true) btn.classList.add('pass');
      if (passed === false) btn.classList.add('fail');
      if (isFlagged) btn.classList.add('flag');

      if (question._hasChildren) {
        var childEvals = state.childEvaluations[index] || [];
        var doneChildCount = childEvals.filter(function (e) { return !!e; }).length;
        if (doneChildCount > 0 && doneChildCount < question._childCount) {
          btn.classList.add('partial');
        }
        if (doneChildCount > 0) {
          btn.textContent = doneChildCount + '/' + question._childCount;
          btn.style.fontSize = '.7rem';
        }
      }

      list.appendChild(btn);
    });

    $('#stat-done').textContent = doneCount;
    $('#stat-flagged').textContent = flaggedCount;
    $('#stat-skipped').textContent = skippedCount;
  }

  function showQuestion(index) {
    if (index < 0 || index >= questions.length) return;
    currentIndex = index;

    var question = questions[index];
    $('#question-number').textContent = 'Question ' + (index + 1) + ' of ' + questions.length;
    $('#question-text').innerHTML = md(question.question);

    var tagRow = $('#tag-row');
    tagRow.innerHTML = '';
    question.tags.forEach(function (tag) {
      tagRow.appendChild(create('span', 'tag', tag));
    });

    var hasPhotoAnswer = state.photoAnswers && state.photoAnswers[index] && state.photoAnswers[index].data;

    if (question._hasChildren) {
      // Children mode: hide single answer panel, show children container
      $('#answer-panel').style.display = 'none';
      $('#feedback').classList.remove('active');
      renderChildren(index);
    } else {
      // Standard mode: single answer panel
      $('#answer-panel').style.display = '';
      $('#feedback').classList.remove('active');
      var container = $('#children-container');
      if (container) container.style.display = 'none';

      var input = $('#answer-input');
      var photoArea = $('#photo-answer-area');
      if (hasPhotoAnswer) {
        input.style.display = 'none';
        photoArea.style.display = 'block';
        $('#photo-preview-img').src = 'data:' + state.photoAnswers[index].mimeType + ';base64,' + state.photoAnswers[index].data;
        $('#answer-counter').textContent = '📷 Photo answer';
      } else {
        input.style.display = '';
        photoArea.style.display = 'none';
        input.value = state.answers[index] || '';
        updateCounter();
      }

      var evaluation = state.evaluations[index];
      if (evaluation) {
        renderFeedback(evaluation);
      }
    }
    updateFlagButton();
    renderQuestionList();
  }

  function renderChildren(pIdx) {
    var question = questions[pIdx];
    var container = $('#children-container');
    container.style.display = 'block';
    container.innerHTML = '';

    var childAnswers = state.childAnswers[pIdx] = state.childAnswers[pIdx] || [];
    var childEvals = state.childEvaluations[pIdx] = state.childEvaluations[pIdx] || [];

    // Ensure arrays are long enough
    while (childAnswers.length < question._childCount) childAnswers.push('');
    while (childEvals.length < question._childCount) childEvals.push(null);

    var hasAllChildModelAnswers = question.children.every(function (c) { return !!c.modelAnswer; });

    // Photo area shared across all children (parent-level)
    var parentPhoto = state.photoAnswers && state.photoAnswers[pIdx];
    if (parentPhoto && parentPhoto.data) {
      var photoBanner = create('div', 'panel');
      photoBanner.style.padding = '12px';
      photoBanner.style.marginBottom = '8px';
      photoBanner.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.85rem"><span>📷</span> Photo answer attached for all parts</div>'
        + '<img src="data:' + parentPhoto.mimeType + ';base64,' + parentPhoto.data + '" style="max-height:160px;border-radius:8px;max-width:100%;display:block;margin:8px auto 0;object-fit:contain;background:var(--surface-2)">';
      container.appendChild(photoBanner);
    }

    question.children.forEach(function (child, ci) {
      var block = create('div', 'child-block');

      // Header: label + question
      var header = create('div', 'child-header');
      if (child.label) {
        var labelSpan = create('span', 'child-label', child.label);
        header.appendChild(labelSpan);
      }
      var qSpan = create('span', 'child-question', child.question);
      header.appendChild(qSpan);
      block.appendChild(header);

      // Answer textarea
      var answerDiv = create('div', 'child-answer');
      var textarea = document.createElement('textarea');
      textarea.placeholder = 'Write your answer for part ' + (child.label || (ci + 1)) + '...';
      textarea.value = childAnswers[ci] || '';
      textarea.dataset.pIdx = pIdx;
      textarea.dataset.cIdx = ci;
      textarea.addEventListener('input', function () {
        onChildAnswerInput(pIdx, ci, this.value);
      });
      answerDiv.appendChild(textarea);
      block.appendChild(answerDiv);

      // Footer: counter + grade buttons
      var foot = create('div', 'child-foot');
      var counter = create('div', 'child-counter', countWords(childAnswers[ci] || ''));
      counter.id = 'child-counter-' + pIdx + '-' + ci;
      foot.appendChild(counter);

      var actions = create('div', 'child-actions');
      var manualBtn = create('button', 'btn btn-secondary');
      manualBtn.textContent = 'Manual Grade';
      manualBtn.type = 'button';
      manualBtn.dataset.pIdx = pIdx;
      manualBtn.dataset.cIdx = ci;
      manualBtn.addEventListener('click', function () {
        createChildManualEvaluation(pIdx, ci);
      });
      actions.appendChild(manualBtn);

      var aiBtn = create('button', 'btn btn-primary');
      aiBtn.textContent = 'Grade with AI';
      aiBtn.type = 'button';
      aiBtn.dataset.pIdx = pIdx;
      aiBtn.dataset.cIdx = ci;
      aiBtn.addEventListener('click', function () {
        submitChildForAiGrade(pIdx, ci);
      });
      actions.appendChild(aiBtn);
      foot.appendChild(actions);
      block.appendChild(foot);

      // Child feedback section
      var feedback = create('div', 'child-feedback');
      feedback.id = 'child-feedback-' + pIdx + '-' + ci;
      block.appendChild(feedback);
      container.appendChild(block);
      if (childEvals[ci]) {
        renderChildFeedback(pIdx, ci, childEvals[ci]);
      }
    });

    // Batch action row: AI grade, manual grade, photo
    var batchRow = create('div', 'batch-grade-row');
    if (!hasAllChildModelAnswers) {
      var batchNote = create('div', 'child-reminder');
      batchNote.textContent = '💡 Parts share a single model answer. Use "Grade All with AI" to grade all parts together, or grade individually with Manual Grade.';
      container.appendChild(batchNote);
    }

    var manualBatchBtn = create('button', 'btn btn-secondary');
    manualBatchBtn.textContent = 'Manual Grade';
    manualBatchBtn.type = 'button';
    manualBatchBtn.addEventListener('click', function () {
      createBatchManualEvaluation(pIdx);
    });
    batchRow.appendChild(manualBatchBtn);

    var photoBtn = create('button', 'btn btn-secondary');
    photoBtn.textContent = '📷 Photo';
    photoBtn.type = 'button';
    photoBtn.addEventListener('click', function () {
      $('#photo-toggle').click();
    });
    batchRow.appendChild(photoBtn);

    var batchAiBtn = create('button', 'btn btn-primary');
    batchAiBtn.textContent = 'Grade All with AI';
    batchAiBtn.type = 'button';
    batchAiBtn.style.marginLeft = 'auto';
    batchAiBtn.addEventListener('click', function () {
      submitBatchAiGrade(pIdx);
    });
    batchRow.appendChild(batchAiBtn);
    container.appendChild(batchRow);

    // Show overall assessment section if parent-level evaluation exists (from batch grading)
    var parentEval = state.evaluations[pIdx];
    if (parentEval) {
      var childAnswersArr = state.childAnswers[pIdx] || [];
      var combinedUserParts = [];
      question.children.forEach(function (child, ci) {
        var label = child.label || (ci + 1);
        var ans = (childAnswersArr[ci] || '').trim();
        combinedUserParts.push(label + ': ' + (ans || '(No answer)'));
      });
      var combinedUserAnswer = combinedUserParts.join('\n\n');

      var combinedModelParts = [];
      question.children.forEach(function (child, ci) {
        var label = child.label || (ci + 1);
        combinedModelParts.push(label + ': ' + (child.modelAnswer || '(No model answer supplied for this part.)'));
      });
      var combinedModelAnswer = combinedModelParts.join('\n\n');

      var passed = isPassed(parentEval);
      var scoreText = parentEval.score === null || parentEval.score === undefined ? 'Self' : String(parentEval.score);

      var overallDiv = create('div', 'eval-panel');
      overallDiv.style.marginTop = '16px';

      var evalHead = create('div', 'eval-head');
      var score = create('div', 'score ' + (passed ? 'pass' : 'fail'));
      score.textContent = scoreText;
      evalHead.appendChild(score);
      var vDiv = create('div');
      vDiv.innerHTML = '<div class="verdict">' + (passed ? 'Passed' : 'Needs revision') + '</div>'
        + '<div class="eval-source">' + (parentEval.source || 'Evaluation') + '</div>';
      evalHead.appendChild(vDiv);
      overallDiv.appendChild(evalHead);

      var compareGrid = create('div', 'compare-grid');
      var userCard = create('div', 'panel compare-card user');
      userCard.innerHTML = '<div class="compare-title">Your combined answer</div><div class="compare-body">' + EngineShared.escHtml(combinedUserAnswer) + '</div>';
      compareGrid.appendChild(userCard);
      var modelCard = create('div', 'panel compare-card model');
      modelCard.innerHTML = '<div class="compare-title">Combined model answer</div><div class="compare-body">' + EngineShared.escHtml(combinedModelAnswer) + '</div>';
      compareGrid.appendChild(modelCard);
      overallDiv.appendChild(compareGrid);

      var bulletList = create('div', 'bullet-list');
      (parentEval.strengths || []).forEach(function (item) {
        bulletList.appendChild(create('div', 'bullet good', item));
      });
      (parentEval.gaps || []).forEach(function (item) {
        bulletList.appendChild(create('div', 'bullet gap', item));
      });
      if (!bulletList.children.length) {
        bulletList.appendChild(create('div', 'bullet', 'No detailed points for this evaluation.'));
      }
      overallDiv.appendChild(bulletList);

      var feedbackText = create('div', 'feedback-text');
      feedbackText.textContent = parentEval.feedback || '';
      overallDiv.appendChild(feedbackText);

      // Photo display in overall assessment
      var parentPhoto = state.photoAnswers && state.photoAnswers[pIdx];
      if (parentPhoto && parentPhoto.data) {
        var photoDiv = create('div', '');
        photoDiv.style.borderTop = '1px solid var(--border)';
        photoDiv.style.paddingTop = '12px';
        photoDiv.style.marginTop = '12px';
        photoDiv.innerHTML = '<img src="data:' + parentPhoto.mimeType + ';base64,' + parentPhoto.data + '" class="feedback-photo">'
          + (parentEval.transcription ? '<div class="transcription-box" style="margin-top:8px"><div class="transcription-label">AI Transcription</div><div class="transcription-text">' + EngineShared.escHtml(parentEval.transcription) + '</div></div>' : '');
        overallDiv.appendChild(photoDiv);
      }

      // Buttons: same as normal questions (Pass/Fail, Retry, Next)
      var btnBar = create('div', 'action-row');
      btnBar.style.marginTop = '16px';
      btnBar.style.borderTop = '1px solid var(--border)';
      btnBar.style.paddingTop = '12px';
      btnBar.style.flexWrap = 'wrap';

      var failBtn = create('button', 'btn btn-secondary' + (!passed ? ' fail-choice active' : ''));
      failBtn.textContent = 'Fail';
      failBtn.type = 'button';
      failBtn.addEventListener('click', function (idx) {
        return function () {
          state.evaluations[idx].manualVerdict = 'fail';
          state.evaluations[idx].passed = false;
          showQuestion(idx);
          renderQuestionList();
          saveProgress();
          EngineShared.showToast('Marked fail.');
        };
      }(pIdx));
      btnBar.appendChild(failBtn);

      var passBtn = create('button', 'btn btn-secondary' + (passed ? ' pass-choice active' : ''));
      passBtn.textContent = 'Pass';
      passBtn.type = 'button';
      passBtn.addEventListener('click', function (idx) {
        return function () {
          state.evaluations[idx].manualVerdict = 'pass';
          state.evaluations[idx].passed = true;
          showQuestion(idx);
          renderQuestionList();
          saveProgress();
          EngineShared.showToast('Marked pass.');
        };
      }(pIdx));
      btnBar.appendChild(passBtn);

      var retryBtn = create('button', 'btn btn-secondary');
      retryBtn.innerHTML = '\u21BA Retry';
      retryBtn.type = 'button';
      retryBtn.addEventListener('click', function (idx) {
        return function () {
          delete state.evaluations[idx];
          if (state.childAnswers) delete state.childAnswers[idx];
          if (state.childEvaluations) delete state.childEvaluations[idx];
          if (state.photoAnswers) delete state.photoAnswers[idx];
          state.flagged[idx] = false;
          delete state.flagged[idx];
          saveProgress();
          showQuestion(idx);
          renderQuestionList();
          updateResumeButton();
          EngineShared.showToast('Question cleared. Try again.');
        };
      }(pIdx));
      btnBar.appendChild(retryBtn);

      var nextBtn = create('button', 'btn btn-primary');
      nextBtn.textContent = 'Next';
      nextBtn.type = 'button';
      nextBtn.addEventListener('click', goNext);
      btnBar.appendChild(nextBtn);

      overallDiv.appendChild(btnBar);
      container.appendChild(overallDiv);
    }
  }

  function countWords(text) {
    if (!text || !text.trim()) return '0 words | 0 characters';
    var value = text.trim();
    var words = value ? value.split(/\s+/).length : 0;
    var chars = value.length;
    return words + ' word' + (words === 1 ? '' : 's') + ' | ' + chars + ' character' + (chars === 1 ? '' : 's');
  }

  function onChildAnswerInput(pIdx, cIdx, value) {
    if (!state.childAnswers[pIdx]) state.childAnswers[pIdx] = [];
    state.childAnswers[pIdx][cIdx] = value;
    var counter = document.getElementById('child-counter-' + pIdx + '-' + cIdx);
    if (counter) counter.textContent = countWords(value);
    clearTimeout(answerSaveTimer);
    answerSaveTimer = setTimeout(function () {
      saveProgress();
      renderQuestionList();
      updateResumeButton();
    }, 250);
  }

  function onAnswerInput() {
    state.answers[currentIndex] = $('#answer-input').value;
    updateCounter();
    clearTimeout(answerSaveTimer);
    answerSaveTimer = setTimeout(function () {
      saveProgress();
      renderQuestionList();
      updateResumeButton();
    }, 250);
  }

  function updateCounter() {
    var value = ($('#answer-input').value || '').trim();
    var words = value ? value.split(/\s+/).length : 0;
    var chars = value.length;
    $('#answer-counter').textContent = words + ' word' + (words === 1 ? '' : 's') + ' | ' + chars + ' character' + (chars === 1 ? '' : 's');
  }

  function toggleFlag() {
    state.flagged[currentIndex] = !state.flagged[currentIndex];
    if (!state.flagged[currentIndex]) delete state.flagged[currentIndex];
    updateFlagButton();
    renderQuestionList();
    saveProgress();
  }

  function updateFlagButton() {
    var btn = $('#flag-question');
    var active = !!state.flagged[currentIndex];
    btn.classList.toggle('active', active);
    btn.style.color = active ? 'var(--flag)' : '';
    btn.title = active ? 'Remove flag' : 'Flag question';
  }

  function createManualEvaluation(options) {
    options = options || {};
    var answer = ($('#answer-input').value || '').trim();
    var photo = state.photoAnswers && state.photoAnswers[currentIndex] && state.photoAnswers[currentIndex].data;
    var hasContent = !!(answer || photo);
    state.answers[currentIndex] = answer;
    state.evaluations[currentIndex] = {
      score: null,
      passed: hasContent,
      strengths: hasContent ? ['Answer attempted and ready for self review.'] : [],
      gaps: hasContent ? [] : ['No answer was provided before self grading.'],
      feedback: options.feedback || 'Compare your response with the model answer, then choose Pass or Fail for the final mark.',
      source: options.source || 'Manual grade',
      manualVerdict: hasContent ? 'pass' : 'fail'
    };
    renderFeedback(state.evaluations[currentIndex]);
    renderQuestionList();
    saveProgress();
    updateResumeButton();
  }

  function createChildManualEvaluation(pIdx, cIdx) {
    var question = questions[pIdx];
    var child = question.children[cIdx];
    if (!state.childAnswers[pIdx]) state.childAnswers[pIdx] = [];
    if (!state.childEvaluations[pIdx]) state.childEvaluations[pIdx] = [];
    var answer = (state.childAnswers[pIdx][cIdx] || '').trim();
    var hasContent = !!answer;
    state.childEvaluations[pIdx][cIdx] = {
      score: null,
      passed: hasContent,
      strengths: hasContent ? ['Answer attempted for part ' + (child.label || (cIdx + 1)) + ' and ready for self review.'] : [],
      gaps: hasContent ? [] : ['No answer was provided for this part before self grading.'],
      feedback: 'Compare your response with the model answer, then choose Pass or Fail for the final mark.',
      source: 'Manual grade',
      manualVerdict: hasContent ? 'pass' : 'fail'
    };
    renderChildFeedback(pIdx, cIdx, state.childEvaluations[pIdx][cIdx]);
    saveProgress();
    renderQuestionList();
  }

  function submitForAiGrade() {
    var apiKey = (_readKey() || '').trim();
    var answer = ($('#answer-input').value || '').trim();
    var photo = state.photoAnswers && state.photoAnswers[currentIndex] && state.photoAnswers[currentIndex].data;
    if (!answer && !photo) {
      EngineShared.showToast('Write an answer or capture a photo before requesting AI grading.');
      return;
    }
    if (!photo && answer.length < 10 && answer.split(/\s+/).length < 3) {
      EngineShared.showToast('Very short answer — AI grading will work but results may be limited. Consider writing more detail.');
    }
    if (!apiKey) {
      createManualEvaluation({
        source: 'Manual fallback',
        feedback: 'AI grading is the primary grading path, but no Gemini API key is saved. Manual grading was opened instead; compare your response with the model answer and choose Pass or Fail.'
      });
      EngineShared.showToast('No Gemini API key found. Falling back to manual grading.');
      return;
    }

    state.answers[currentIndex] = answer;
    _writeKey(apiKey);
    localStorage.setItem(STORAGE.model, $('#model-select').value);

    _gradingAbortController = new AbortController();
    var cancelSignal = _gradingAbortController.signal;
    var modelId = $('#model-select').value;
    setLoading(true, _getModelLabel(modelId));

    gradeWithGemini(questions[currentIndex], photo ? null : answer, apiKey, modelId, cancelSignal)
      .then(function (evaluation) {
        state.evaluations[currentIndex] = evaluation;
        renderFeedback(evaluation);
        renderQuestionList();
        saveProgress();
        updateResumeButton();
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') {
          EngineShared.showToast('Grading cancelled.');
          return;
        }
        console.error(error);
        createManualEvaluation({
          source: 'Manual fallback',
          feedback: 'AI grading was attempted first, but the request failed. Manual grading was opened instead. Reason: ' + friendlyAiError(error)
        });
        EngineShared.showToast('AI grading failed. Falling back to manual grading.');
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function submitChildForAiGrade(pIdx, cIdx) {
    var apiKey = (_readKey() || '').trim();
    var question = questions[pIdx];
    var child = question.children[cIdx];
    if (!state.childAnswers[pIdx]) state.childAnswers[pIdx] = [];
    var answer = (state.childAnswers[pIdx][cIdx] || '').trim();
    var hasPhoto = !!(state.photoAnswers && state.photoAnswers[pIdx] && state.photoAnswers[pIdx].data);

    if (!answer && !hasPhoto) {
      EngineShared.showToast('Write an answer for part ' + (child.label || (cIdx + 1)) + ' before requesting AI grading.');
      return;
    }
    if (!apiKey) {
      createChildManualEvaluation(pIdx, cIdx);
      EngineShared.showToast('No Gemini API key found. Falling back to manual grading.');
      return;
    }

    // Grade this child independently (extracts child's section from parent modelAnswer if needed)
    _gradeSingleChild(pIdx, cIdx, apiKey, child);
  }

  function submitBatchAiGrade(pIdx) {
    var apiKey = (_readKey() || '').trim();
    if (!apiKey) {
      EngineShared.showToast('Set a Gemini API key for AI grading, or grade each part manually.');
      return;
    }
    _gradeBatchChildren(pIdx, apiKey);
  }

  function _gradeSingleChild(pIdx, cIdx, apiKey, child) {
    var question = questions[pIdx];
    var answer = (state.childAnswers[pIdx] && state.childAnswers[pIdx][cIdx]) || '';
    var modelId = $('#model-select').value;
    _gradingAbortController = new AbortController();
    _gradingChildIdx = cIdx;
    _gradingIsBatch = false;
    setLoading(true, _getModelLabel(modelId));

    // Build a mini-question object for this child
    // The AI prompt becomes:
    //   ## QUESTION  →  clinical scenario (for context)
    //                  + child's specific question
    //   ## MODEL ANSWER → only this child's expected answer
    // This keeps scenario context for the AI without expecting the full parent answer.
    var childQuestion = {
      question: child.question
        ? 'Clinical scenario (for context, do NOT grade this):\n' + question.question + '\n\nNow grade ONLY this specific part:\n' + child.question
        : question.question,
      modelAnswer: child.modelAnswer || '(No model answer supplied for this part.)',
      rubric: child.rubric || '',
      explanation: child.explanation || ''
    };

    var hasPhoto = !!(state.photoAnswers && state.photoAnswers[pIdx] && state.photoAnswers[pIdx].data);

    gradeWithGemini(childQuestion, hasPhoto ? null : answer, apiKey, modelId, _gradingAbortController.signal, pIdx)
      .then(function (evaluation) {
        if (!state.childEvaluations[pIdx]) state.childEvaluations[pIdx] = [];
        state.childEvaluations[pIdx][cIdx] = evaluation;
        renderChildFeedback(pIdx, cIdx, evaluation);
        saveProgress();
        renderQuestionList();
        EngineShared.showToast('Part ' + (child.label || (cIdx + 1)) + ' graded.');
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') { EngineShared.showToast('Grading cancelled.'); return; }
        console.error(error);
        createChildManualEvaluation(pIdx, cIdx);
        EngineShared.showToast('AI grading failed. Falling back to manual grading.');
      })
      .finally(function () {
        setLoading(false);
        _gradingChildIdx = null;
      });
  }

  function createBatchManualEvaluation(pIdx) {
    var question = questions[pIdx];
    var childAnswersArr = state.childAnswers[pIdx] || [];
    var combinedParts = [];
    question.children.forEach(function (child, ci) {
      var label = child.label || (ci + 1);
      var ans = (childAnswersArr[ci] || '').trim();
      combinedParts.push(label + ': ' + (ans || '(No answer)'));
    });
    var combinedAnswer = combinedParts.join('\n\n');
    var hasContent = combinedParts.some(function (p) { return p.indexOf('(No answer)') === -1; });
    state.childEvaluations[pIdx] = state.childEvaluations[pIdx] || [];
    question.children.forEach(function (child, ci) {
      var ans = (childAnswersArr[ci] || '').trim();
      state.childEvaluations[pIdx][ci] = {
        score: null,
        passed: !!ans,
        strengths: ans ? ['Answer attempted for part ' + (child.label || (ci + 1)) + ' and ready for self review.'] : [],
        gaps: ans ? [] : ['No answer was provided for this part before self grading.'],
        feedback: 'Compare your response with the model answer, then choose Pass or Fail for the final mark.',
        source: 'Manual grade',
        manualVerdict: ans ? 'pass' : 'fail'
      };
    });
    state.evaluations[pIdx] = {
      score: null,
      passed: hasContent,
      strengths: hasContent ? ['All parts attempted and ready for self review.'] : [],
      gaps: hasContent ? [] : ['No answers were provided before self grading.'],
      feedback: 'Compare your combined response with the combined model answer, then choose Pass or Fail for the final mark.',
      source: 'Manual grade',
      manualVerdict: hasContent ? 'pass' : 'fail'
    };
    saveProgress();
    currentIndex = pIdx;
    showQuestion(pIdx);
    renderQuestionList();
    EngineShared.showToast('Batch manual grade created.');
  }

  function _gradeBatchChildren(pIdx, apiKey) {
    var question = questions[pIdx];
    var modelId = $('#model-select').value;
    _gradingAbortController = new AbortController();
    _gradingIsBatch = true;
    _gradingChildIdx = null;
    setLoading(true, _getModelLabel(modelId));

    // Build combined answers string from all children
    var childAnswers = state.childAnswers[pIdx] || [];
    var combinedParts = [];
    question.children.forEach(function (child, ci) {
      var label = child.label || (ci + 1);
      var ans = (childAnswers[ci] || '').trim();
      if (ans) {
        combinedParts.push(label + ' ' + ans);
      } else {
        combinedParts.push(label + ' (No answer)');
      }
    });
    var combinedAnswer = combinedParts.join('\n\n');

    // Build combined model answer from children when each has its own
    var hasAllChildModelAnswers = question.children.every(function (c) { return !!c.modelAnswer; });
    var batchQuestion;
    if (hasAllChildModelAnswers) {
      var combinedModelParts = [];
      question.children.forEach(function (child, ci) {
        var label = child.label || (ci + 1);
        combinedModelParts.push(label + ': ' + (child.modelAnswer || ''));
      });
      batchQuestion = {
        question: question.question,
        modelAnswer: [
          question.modelAnswer || '',
          '',
          'Each part is graded separately against its own model answer:',
          '',
          combinedModelParts.join('\n\n')
        ].join('\n'),
        rubric: question.rubric,
        explanation: question.explanation
      };
    } else {
      batchQuestion = {
        question: question.question,
        modelAnswer: '(No model answer supplied for this part.)',
        rubric: '',
        explanation: question.explanation || ''
      };
    }

    var hasPhoto = !!(state.photoAnswers && state.photoAnswers[pIdx] && state.photoAnswers[pIdx].data);

    gradeWithGemini(batchQuestion, hasPhoto ? null : combinedAnswer, apiKey, modelId, _gradingAbortController.signal, pIdx)
      .then(function (evaluation) {
        // Store parent-level (whole-question) evaluation
        state.evaluations[pIdx] = evaluation;
        // Store a deep copy per-child so verdicts can be adjusted independently
        if (!state.childEvaluations[pIdx]) state.childEvaluations[pIdx] = [];
        question.children.forEach(function (child, ci) {
          state.childEvaluations[pIdx][ci] = JSON.parse(JSON.stringify(evaluation));
        });
        saveProgress();
        // Re-render with children + overall assessment
        currentIndex = pIdx;
        showQuestion(pIdx);
        renderQuestionList();
        EngineShared.showToast('All parts graded together.');
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') { EngineShared.showToast('Grading cancelled.'); return; }
        console.error(error);
        EngineShared.showToast('AI grading failed. Try grading individually with Manual Grade.');
      })
      .finally(function () {
        setLoading(false);
        _gradingIsBatch = false;
      });
  }

  // ── _buildSysPrompt ───────────────────────────────────────────────────────
  // Returns the fixed grading system instruction text.
  // Kept as a function so both gradeWithGemini (fallback path) and
  // _createGradingCache (cache path) always use the same source of truth.
  function _buildSysPrompt() {
    return [
      'You are an expert medical education grading assistant. Your role is to evaluate student written exam answers fairly, consistently, and constructively.',
      '',
      '# GRADING PHILOSOPHY',
      'This is a formative LEARNING TOOL, not a high-stakes summative exam. You are a generous grader.',
      'Core rule: when uncertain whether the student has covered a point, give them the benefit of the doubt.',
      'Partial understanding is valuable and must be rewarded.',
      '',
      '# OUTPUT REQUIREMENTS',
      'You MUST respond with a single raw JSON object and absolutely nothing else.',
      'No markdown fences, no backticks, no preamble, no explanation, no trailing text.',
      'The JSON object must contain exactly these keys:',
      '  "score"         : integer 0–100, or null if the answer cannot be assessed at all',
      '  "passed"        : boolean — true when final score >= 45',
      '  "strengths"     : array of strings, minimum 2 items; name specific things the student got right',
      '  "gaps"          : array of strings; missing points phrased constructively ("Could also mention…"); use [] if fully correct',
      '  "feedback"      : string; 1–2 sentences of encouraging, personalised advice',
      '  "transcription" : string — ONLY include this key when grading a handwritten/photo answer; omit entirely for text answers',
      '',
      '# GRADING METHODOLOGY — FOLLOW THESE STEPS IN ORDER',
      'Step 1. Decompose the model answer into N distinct key points (individual facts, mechanisms, steps, list items, or concepts).',
      'Step 2. For each key point, determine whether the student covered it. Accept synonyms, paraphrases, and clinical equivalents. Do NOT require verbatim wording.',
      'Step 3. Compute raw score = (number of covered key points ÷ N) × 100.',
      'Step 4. Round the raw score UP to the nearest multiple of 5. Examples: 47 → 50, 52 → 55, 43 → 45, 80 → 80.',
      'Step 5. Apply a GENEROSITY BONUS of +5 points, capped at 100. Example: raw 43 → rounded 45 → final 50.',
      'Step 6. Set passed = true if final score >= 45.',
      '',
      '# QUESTION-TYPE RULES',
      '',
      'Enumeration questions ("list / state / mention / enumerate X items"):',
      '  • Award 1 point per clearly correct item; 0.5 points for partially described items.',
      '  • If the question specifies a number (e.g., "list 5"), score against those 5 only — extra items are ignored.',
      '  • Missing minor items from a long comprehensive list does not automatically fail the answer.',
      '',
      'Explanation / "give reason" / "explain why" questions:',
      '  • Correct identification of the core mechanism or concept = pass, even if the explanation is incomplete.',
      '  • Showing directional understanding (right concept, imprecise expression) = score 60.',
      '',
      'Definition questions:',
      '  • Capturing the essential meaning in the student\'s own words = pass.',
      '  • Verbatim memorised phrasing is NEVER required.',
      '',
      'Clinical features / signs / symptoms questions:',
      '  • Correctly identifying the most important features = pass.',
      '  • Missing rare, minor, or late features from a comprehensive list does not fail the answer.',
      '',
      '# NEVER PENALISE FOR ANY OF THE FOLLOWING',
      '• Paraphrasing or using simpler/non-technical language that conveys the same meaning',
      '• Reordering list items — order does not matter unless the question specifically demands it',
      '• Including additional correct information that is not in the model answer',
      '• Minor spelling errors (e.g., "dyspnea" vs "dispnea", "systollic" vs "systolic")',
      '• Missing obscure or very minor details from a long comprehensive model answer',
      '• Providing more detail than the model answer on certain points',
      '• Using clinically accepted abbreviations or acronyms',
      '• Writing in bullet points or numbered lists instead of prose',
      '',
      '# FIELD GUIDANCE',
      'strengths: Be concrete and specific — reference the student\'s actual wording or concept to show the feedback is personalised. Never write generic praise like "Good attempt."',
      'gaps:      Frame constructively — "Could also mention…", "A stronger answer would include…", "Worth adding…". Return [] if the answer is fully correct.',
      'feedback:  Open with a positive observation, then point the student to what they should review or add. Keep it under 60 words.',
      '',
      '# CALIBRATION EXAMPLES — THESE ANSWERS ALL PASS',
      '• Covered the 3 most clinically important points out of 6 → score 60, passed: true',
      '• Listed all items in wrong order but all correct → score 90, passed: true',
      '• Used simpler wording that conveyed the correct medical concept → score 75, passed: true',
      '• Explained the mechanism correctly but omitted one minor step → score 65, passed: true',
      '• Missed 1 item out of 5 in an enumeration → score 80, passed: true',
      '• Wrote in bullet points instead of prose → score based on content alone, passed: true',
    ].join('\n');
  }

  // ── Context cache management ───────────────────────────────────────────────
  // Creates an explicit Gemini context cache at session start so the fixed
  // system instruction is uploaded once and reused across all questions.
  // Falls back silently — gradeWithGemini always sends systemInstruction too,
  // so every question works even if cache creation failed or expired.

  function _createGradingCache(apiKey, modelId, ttl) {
    _cachedContentName = null;
    _cacheModelId = null;
    var body = {
      model: 'models/' + modelId,
      systemInstruction: { parts: [{ text: _buildSysPrompt() }] },
      ttl: ttl || '3600s'   // 1-hour default; halved on refresh
    };
    return fetch(
      'https://generativelanguage.googleapis.com/v1beta/cachedContents',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) }
    )
    .then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) {
          // Expected for models that don't support caching (e.g. Gemma) or if
          // the prompt is below the 1 024-token minimum — silently fall back.
          console.warn('[written-engine] Cache creation failed (' + response.status + '):', data && data.error && data.error.message);
          return;
        }
        if (data && data.name) {
          _cachedContentName = data.name;
          _cacheModelId = modelId;
          console.log('[written-engine] Context cache ready:', _cachedContentName);
        }
      });
    })
    .catch(function (err) {
      console.warn('[written-engine] Cache creation error:', err && err.message);
    });
  }

  function _deleteGradingCache() {
    if (!_cachedContentName) return;
    var name = _cachedContentName;
    var apiKey = _readKey();
    _cachedContentName = null;
    _cacheModelId = null;
    if (!apiKey) return;
    // Fire-and-forget — billing stops when the cache is deleted, so we try but
    // don't block the UI on it. Caches also auto-expire after their TTL.
    fetch(
      'https://generativelanguage.googleapis.com/v1beta/' + name,
      { method: 'DELETE', headers: { 'x-goog-api-key': apiKey }, keepalive: true }
    ).catch(function () {});
  }

  // ── _refreshGradingCache ────────────────────────────────────────────────────
  // Called when the cache expires mid-session (400/404 on a cachedContent
  // request). Recreates it with a halved TTL (1800s) so subsequent questions
  // continue to benefit from caching. Capped at one refresh per session — if
  // the second window also expires the user has been working for 90+ minutes
  // and the fallback systemInstruction path handles everything cleanly.
  function _refreshGradingCache() {
    if (_cacheRefreshing || _cacheRefreshCount >= 1) return;
    var apiKey = _readKey();
    if (!apiKey) return;
    var modelEl = $('#model-select');
    var modelId = (modelEl && modelEl.value) || localStorage.getItem(STORAGE.model) || MODELS[0][0];
    _cacheRefreshing = true;
    _cacheRefreshCount++;
    console.log('[written-engine] TTL expired mid-session — refreshing cache with 1800s TTL.');
    var p = _createGradingCache(apiKey, modelId, '1800s');
    if (p && p.finally) {
      p.finally(function () { _cacheRefreshing = false; });
    } else {
      _cacheRefreshing = false;
    }
  }

  function gradeWithGemini(question, answer, apiKey, model, cancelSignal, photoIdx) {
    var qIdx = photoIdx !== undefined ? photoIdx : currentIndex;
    var hasPhotoAnswer = state.photoAnswers && state.photoAnswers[qIdx] && state.photoAnswers[qIdx].data;

    // ── System instruction ─────────────────────────────────────────────────
    // Sent on every request as a fallback. requestGemini replaces it with a
    // cached-content reference when _cachedContentName is available.
    var sysPrompt = _buildSysPrompt();

    // ── User message (the actual grading request) ──────────────────────────
    var userPromptParts = [
      '## QUESTION',
      question.question,
      '',
      '## MODEL ANSWER',
      question.modelAnswer || '(No model answer supplied.)',
      ''
    ];
    if (question.rubric) {
      userPromptParts.push('## RUBRIC');
      userPromptParts.push(question.rubric);
      userPromptParts.push('');
    }
    if (hasPhotoAnswer) {
      userPromptParts.push('## STUDENT\'S ANSWER');
      userPromptParts.push('The student\'s handwritten answer is attached as an image. First, transcribe every word of the handwriting accurately into the "transcription" field. Then evaluate the transcribed text against the model answer using your grading methodology. The "strengths" and "gaps" arrays must each contain at least 2 items.');
    } else {
      userPromptParts.push('## STUDENT\'S ANSWER');
      userPromptParts.push(answer);
    }
    userPromptParts.push('');
    userPromptParts.push('Apply your grading methodology now and return the JSON object only.');
    var userPrompt = userPromptParts.join('\n');

    return tryGeminiRequests({ sysPrompt: sysPrompt, userPrompt: userPrompt }, apiKey, buildGeminiAttempts(model), cancelSignal)
      .then(function (result) {
        var text = extractGeminiText(result.payload);
        try {
          return normalizeEvaluation(parseJsonResponse(text), result.label);
        } catch (parseError) {
          throw new Error('Gemini returned a prose response instead of the expected JSON format.' + (text ? ' Response start: "' + text.substring(0, 100) + '".' : ''));
        }
      });
  }

  function buildGeminiAttempts(model) {
    var attempts = [
      { model: model, jsonMode: true },
      { model: model, jsonMode: false }
    ];
    if (model !== MODELS[0][0]) {
      attempts.push({ model: MODELS[0][0], jsonMode: true });
      attempts.push({ model: MODELS[0][0], jsonMode: false });
    }
    attempts = attempts.filter(function (attempt, index) {
      return attempts.findIndex(function (other) {
        return other.model === attempt.model && other.jsonMode === attempt.jsonMode;
      }) === index;
    });
    var retryLevel = _getRetryLevel();
    if (retryLevel === 'fast') return attempts.slice(0, 1);
    if (retryLevel === 'thorough') return attempts;
    return attempts.slice(0, 2);
  }

  function tryGeminiRequests(promptObj, apiKey, attempts, cancelSignal) {
    var lastError = null;
    var chain = Promise.reject(new Error('AI grading did not start.'));
    attempts.forEach(function (attempt, index) {
      chain = chain.catch(function () {
        if (cancelSignal && cancelSignal.aborted) {
          var err = new DOMException('Grading cancelled.', 'AbortError');
          if (index === attempts.length - 1) throw err;
          return Promise.reject(err);
        }
        return requestGemini(promptObj, apiKey, attempt, cancelSignal)
          .catch(function (error) {
            lastError = error;
            if (index === attempts.length - 1) throw lastError;
            return Promise.reject(error);
          });
      });
    });
    return chain;
  }

  function requestGemini(promptObj, apiKey, attempt, cancelSignal) {
    var photo = state.photoAnswers && state.photoAnswers[currentIndex];
    // Use the explicit cache when it exists and matches the current model.
    // If _cacheModelId differs (user switched models mid-session) fall back
    // to the full systemInstruction path for that request.
    var useCachedContent = !!(_cachedContentName && _cacheModelId === attempt.model);
    var body;

    if (useCachedContent) {
      // Cache path: user turn only — systemInstruction is baked into the cache.
      body = {
        cachedContent: _cachedContentName,
        contents: [{ parts: [{ text: promptObj.userPrompt }] }]
      };
    } else {
      // Fallback path: send the full system instruction on every request.
      body = {
        systemInstruction: { parts: [{ text: promptObj.sysPrompt }] },
        contents: [{ parts: [{ text: promptObj.userPrompt }] }]
      };
    }

    if (photo && photo.data) {
      body.contents[0].parts.push({
        inlineData: {
          mimeType: photo.mimeType || 'image/jpeg',
          data: photo.data
        }
      });
    }

    // Low temperature for deterministic, consistent grading.
    // responseSchema enforces the JSON shape at the API level in JSON mode,
    // eliminating parse failures caused by stray prose or markdown fences.
    var genConfig = { temperature: 0.1 };
    if (attempt.jsonMode) {
      genConfig.responseMimeType = 'application/json';
      genConfig.responseSchema = {
        type: 'object',
        properties: {
          score:          { type: 'integer', nullable: true },
          passed:         { type: 'boolean' },
          strengths:      { type: 'array', items: { type: 'string' } },
          gaps:           { type: 'array', items: { type: 'string' } },
          feedback:       { type: 'string' },
          transcription:  { type: 'string', nullable: true }
        },
        required: ['score', 'passed', 'strengths', 'gaps', 'feedback']
      };
    }
    body.generationConfig = genConfig;

    var maxWaitMs = _getMaxWaitMs();
    var fetchController = new AbortController();
    var timeoutId = null;
    var cancelCleanup = null;

    if (maxWaitMs > 0) {
      timeoutId = setTimeout(function () { fetchController.abort(); }, maxWaitMs);
    }
    if (cancelSignal) {
      cancelCleanup = function () {
        if (timeoutId) clearTimeout(timeoutId);
        fetchController.abort();
      };
      cancelSignal.addEventListener('abort', cancelCleanup);
    }

    return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(attempt.model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: fetchController.signal
    })
      .then(function (response) {
        return response.text().then(function (text) {
          var payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch (error) {}
          if (!response.ok) {
            // If we used a cached-content reference and Gemini rejected it
            // (expired, wrong model, unsupported), clear it so the next retry
            // in the chain automatically falls back to the full systemInstruction.
            if (useCachedContent && (response.status === 400 || response.status === 404)) {
              console.warn('[written-engine] Cache miss/expired — falling back to direct systemInstruction.');
              _cachedContentName = null;
              _cacheModelId = null;
              _refreshGradingCache(); // background refresh for subsequent questions
            }
            var message = payload && payload.error && payload.error.message ? payload.error.message : text;
            throw new Error('Gemini ' + attempt.model + ' returned HTTP ' + response.status + ': ' + (message || response.statusText));
          }
          return payload;
        });
      })
      .then(function (payload) {
        return {
          payload: payload,
          label: 'Gemini ' + attempt.model + (attempt.jsonMode ? '' : ' (compatibility mode)')
        };
      })
      .finally(function () {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        if (cancelCleanup && cancelSignal) {
          cancelSignal.removeEventListener('abort', cancelCleanup);
        }
        cancelCleanup = null;
      });
  }

  function extractGeminiText(payload) { return EngineShared.airExtractGeminiText(payload); }
  function friendlyAiError(error) { return EngineShared.airFriendlyError(error); }
  }

  function parseJsonResponse(text) {
    if (!text) throw new Error('Gemini response did not include text.');
    var cleaned = String(text).trim()
      .replace(/^```(?:json|javascript|js)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      var start = cleaned.indexOf('{');
      var end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        var sliced = cleaned.slice(start, end + 1);
        try { return JSON.parse(sliced); } catch (_) {}
        try { return JSON.parse(fixSloppyJson(sliced)); } catch (_) {}
        try { return JSON.parse(fixSloppyJson(sliced.replace(/'/g, '"'))); } catch (_) {}
      }
      try { return JSON.parse(fixSloppyJson(cleaned)); } catch (_) {}
      try { return JSON.parse(fixSloppyJson(cleaned.replace(/'/g, '"'))); } catch (_) {}
      throw error;
    }
  }

  function fixSloppyJson(str) {
    str = str.replace(/,\s*([}\]])/g, '$1');
    str = str.replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":');
    str = str.replace(/:\s*'([^']*?)'\s*([,}\]])/g, ':"$1"$2');
    return str;
  }

  function normalizeEvaluation(raw, source) {
    raw = raw || {};
    var score = raw.score;
    if (score === null || score === undefined || score === '' || score === 'N/A' || score === 'n/a') score = null;
    if (score !== null) {
      score = Number(score);
      if (!isFinite(score)) score = null;
    }
    if (score !== null) score = Math.max(0, Math.min(100, Math.round(score)));
    var passed;
    if (typeof raw.passed === 'boolean') {
      passed = raw.passed;
    } else if (score !== null) {
      passed = score >= 50;
      if (score >= 40 && score < 50) passed = true;
    } else {
      passed = false;
    }
    return {
      score: score,
      passed: passed,
      transcription: raw.transcription ? String(raw.transcription).trim() : '',
      strengths: Array.isArray(raw.strengths) ? raw.strengths.map(String).filter(Boolean) : (typeof raw.strengths === 'string' ? raw.strengths.split('\n').map(function (s) { return s.replace(/^[-*•]\s*/, '').trim(); }).filter(Boolean) : []),
      gaps: Array.isArray(raw.gaps) ? raw.gaps.map(String).filter(Boolean) : (typeof raw.gaps === 'string' ? raw.gaps.split('\n').map(function (s) { return s.replace(/^[-*•]\s*/, '').trim(); }).filter(Boolean) : []),
      feedback: textOr(raw.feedback, 'Review the model answer and adjust your final mark if needed.'),
      source: source || 'Evaluation',
      manualVerdict: raw.manualVerdict || null
    };
  }

  function renderFeedback(evaluation) {
    var question = questions[currentIndex];
    $('#answer-panel').style.display = 'none';
    $('#feedback').classList.add('active');
    if (question._hasChildren) {
      $('#children-container').style.display = 'none';
    }
    var photo = state.photoAnswers && state.photoAnswers[currentIndex];
    if (photo && photo.data) {
      var html = '<img src="data:' + photo.mimeType + ';base64,' + photo.data + '" class="feedback-photo">';
      if (evaluation.transcription) {
        html += '<div class="transcription-box"><div class="transcription-label">AI Transcription</div><div class="transcription-text">' + EngineShared.escHtml(evaluation.transcription) + '</div></div>';
      }
      $('#feedback-user').innerHTML = html;
    } else {
      $('#feedback-user').textContent = state.answers[currentIndex] || '(No answer written.)';
    }
    $('#feedback-model').innerHTML = md(question.modelAnswer) || '(No model answer supplied.)';

    var passed = isPassed(evaluation);
    var score = $('#score');
    score.className = 'score ' + (passed ? 'pass' : 'fail');
    score.textContent = evaluation.score === null || evaluation.score === undefined ? 'Self' : String(evaluation.score);
    $('#verdict').textContent = passed ? 'Passed' : 'Needs revision';
    $('#eval-source').textContent = evaluation.source || 'Evaluation';

    var bullets = $('#bullet-list');
    bullets.innerHTML = '';
    (evaluation.strengths || []).forEach(function (item) {
      bullets.appendChild(create('div', 'bullet good', item));
    });
    (evaluation.gaps || []).forEach(function (item) {
      bullets.appendChild(create('div', 'bullet gap', item));
    });
    if (!bullets.children.length) {
      bullets.appendChild(create('div', 'bullet', 'No detailed points were returned for this evaluation.'));
    }

    $('#feedback-text').textContent = evaluation.feedback || '';
    $('#mark-pass').classList.toggle('active', passed);
    $('#mark-fail').classList.toggle('active', !passed);
  }

  function renderChildFeedback(pIdx, cIdx, evaluation) {
    var question = questions[pIdx];
    var child = question.children[cIdx];
    var fb = document.getElementById('child-feedback-' + pIdx + '-' + cIdx);
    if (!fb) return;

    fb.classList.add('active');
    fb.innerHTML = '';

    var answer = (state.childAnswers[pIdx] && state.childAnswers[pIdx][cIdx]) || '(No answer written.)';
    var modelAnswer = child.modelAnswer || '(No model answer supplied for this part.)';

    // Compare mini
    var compare = create('div', 'compare-mini');
    compare.innerHTML = '<div class="compare-mini-card user"><div class="cm-title">Your answer</div><div class="cm-body">' + EngineShared.escHtml(answer) + '</div></div>'
      + '<div class="compare-mini-card model"><div class="cm-title">Model answer</div><div class="cm-body">' + md(modelAnswer) + '</div></div>';
    fb.appendChild(compare);

    // Eval head
    var passed = isPassed(evaluation);
    var eHead = create('div', 'child-eval-head');
    var score = create('div', 'child-score ' + (passed ? 'pass' : 'fail'));
    score.textContent = evaluation.score === null || evaluation.score === undefined ? 'Self' : String(evaluation.score);
    eHead.appendChild(score);
    var vDiv = create('div');
    vDiv.innerHTML = '<div class="child-verdict">' + (passed ? 'Passed' : 'Needs revision') + '</div>'
      + '<div style="font-size:.75rem;color:var(--muted)">' + (evaluation.source || 'Evaluation') + '</div>';
    eHead.appendChild(vDiv);
    fb.appendChild(eHead);

    // Bullets
    var bullets = create('div', 'child-bullets');
    (evaluation.strengths || []).forEach(function (item) {
      bullets.appendChild(create('div', 'child-bullet good', item));
    });
    (evaluation.gaps || []).forEach(function (item) {
      bullets.appendChild(create('div', 'child-bullet gap', item));
    });
    if (!bullets.children.length) {
      bullets.appendChild(create('div', 'child-bullet', 'No detailed points for this evaluation.'));
    }
    fb.appendChild(bullets);

    // Feedback text
    if (evaluation.feedback) {
      var ft = create('div', 'child-feedback-text', evaluation.feedback);
      fb.appendChild(ft);
    }

    // Manual override buttons
    var mBar = create('div', 'child-manual-actions');
    var failBtn = create('button', 'btn btn-secondary' + (!passed ? ' fail-choice active' : ''));
    failBtn.textContent = 'Fail';
    failBtn.type = 'button';
    failBtn.addEventListener('click', function () {
      markChildVerdict(pIdx, cIdx, 'fail');
    });
    mBar.appendChild(failBtn);

    var passBtn = create('button', 'btn btn-secondary' + (passed ? ' pass-choice active' : ''));
    passBtn.textContent = 'Pass';
    passBtn.type = 'button';
    passBtn.addEventListener('click', function () {
      markChildVerdict(pIdx, cIdx, 'pass');
    });
    mBar.appendChild(passBtn);

    fb.appendChild(mBar);

    // Action row: Retry + Next
    var actionRow = create('div', 'action-row');
    var retryBtn = create('button', 'btn btn-secondary');
    retryBtn.innerHTML = '↺ Retry';
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', function () {
      submitChildForAiGrade(pIdx, cIdx);
    });
    actionRow.appendChild(retryBtn);

    var nextBtn = create('button', 'btn btn-primary');
    nextBtn.textContent = 'Next';
    nextBtn.type = 'button';
    nextBtn.addEventListener('click', goNext);
    actionRow.appendChild(nextBtn);

    fb.appendChild(actionRow);
  }

  function isPassed(evaluation) {
    if (!evaluation) return false;
    if (evaluation.manualVerdict) return evaluation.manualVerdict === 'pass';
    return !!evaluation.passed;
  }

  function markVerdict(verdict) {
    var evaluation = state.evaluations[currentIndex];
    if (!evaluation) {
      createManualEvaluation();
      evaluation = state.evaluations[currentIndex];
    }
    evaluation.manualVerdict = verdict;
    evaluation.passed = verdict === 'pass';
    renderFeedback(evaluation);
    renderQuestionList();
    saveProgress();
    EngineShared.showToast('Marked ' + verdict + '.');
  }

  function markChildVerdict(pIdx, cIdx, verdict) {
    if (!state.childEvaluations[pIdx]) state.childEvaluations[pIdx] = [];
    var evaluation = state.childEvaluations[pIdx][cIdx];
    if (!evaluation) {
      createChildManualEvaluation(pIdx, cIdx);
      evaluation = state.childEvaluations[pIdx][cIdx];
    }
    evaluation.manualVerdict = verdict;
    evaluation.passed = verdict === 'pass';
    renderChildFeedback(pIdx, cIdx, evaluation);
    saveProgress();
    renderQuestionList();
    EngineShared.showToast('Part ' + ((questions[pIdx].children[cIdx] && questions[pIdx].children[cIdx].label) || (cIdx + 1)) + ': ' + verdict + '.');
  }

  function retryQuestion() {
    delete state.answers[currentIndex];
    delete state.evaluations[currentIndex];
    if (state.photoAnswers) delete state.photoAnswers[currentIndex];
    state.flagged[currentIndex] = false;
    delete state.flagged[currentIndex];
    if (state.childAnswers) delete state.childAnswers[currentIndex];
    if (state.childEvaluations) delete state.childEvaluations[currentIndex];
    saveProgress();
    showQuestion(currentIndex);
    renderQuestionList();
    updateResumeButton();
    EngineShared.showToast('Question cleared. Try again.');
  }

  function goNext() {
    saveProgress();
    if (currentIndex < questions.length - 1) {
      showQuestion(currentIndex + 1);
      return;
    }
    showResultsScreen();
  }

  function showResultsScreen() {
    localStorage.removeItem(STORAGE.progress);
    _deleteGradingCache(); // session over — release the cache
    buildResults();
    showScreen('result-screen');
  }

  function buildResults() {
    var passed = 0, failed = 0, skipped = 0;
    questions.forEach(function(q, i) {
      if (q._hasChildren) {
        var childEvals = state.childEvaluations[i] || [];
        var hasEval = childEvals.some(function (e) { return !!e; });
        if (!hasEval) { skipped++; return; }
        var allPassed = childEvals.every(function (e) { return e ? isPassed(e) : true; });
        // If any child is evaluated and passed → count as passed
        var anyFailed = childEvals.some(function (e) { return e && !isPassed(e); });
        if (anyFailed) failed++;
        else if (hasEval) passed++;
      } else {
        var ev = state.evaluations[i];
        if (!ev) { skipped++; return; }
        if (isPassed(ev)) passed++;
        else failed++;
      }
    });
    var total = questions.length;
    if (!total) { EngineShared.showToast('No questions loaded.'); return; }
    var pct = total ? Math.round(passed / total * 100) : 0;
    var flagged = 0;
    Object.keys(state.flagged).forEach(function(k) {
      if (state.flagged[k]) flagged++;
    });

    document.getElementById('res-pct').textContent = pct + '%';
    document.getElementById('res-passed').textContent = passed;
    document.getElementById('res-failed').textContent = failed;
    document.getElementById('res-flagged').textContent = flagged;
    document.getElementById('res-skipped').textContent = skipped;

    var grade = '';
    if (pct >= 90) grade = 'Excellent!';
    else if (pct >= 75) grade = 'Great Work!';
    else if (pct >= 60) grade = 'Good Effort!';
    else if (pct >= 40) grade = 'Keep Studying!';
    else grade = 'Keep Practicing!';
    document.getElementById('res-grade').textContent = grade;

    renderResultItems('all');
    updateExportBadges();
  }

  function renderResultItems(filter) {
    var list = document.getElementById('result-list');
    list.innerHTML = '';
    var itemsRendered = 0;

    questions.forEach(function(q, i) {
      var isFlagged = !!state.flagged[i];
      var statusClass, statusIcon, ev, evPassed, isSkipped;

      if (q._hasChildren) {
        var childEvals = state.childEvaluations[i] || [];
        var evaluatedChildren = childEvals.filter(function (e) { return !!e; });
        var passCount = evaluatedChildren.filter(function (e) { return isPassed(e); }).length;
        var failCount = evaluatedChildren.filter(function (e) { return !isPassed(e); }).length;
        isSkipped = evaluatedChildren.length === 0;
        if (isSkipped) { statusClass = 'skipped'; statusIcon = '—'; }
        else if (failCount > 0) { statusClass = 'fail'; statusIcon = '✗'; }
        else { statusClass = 'pass'; statusIcon = '✓'; }

        var showItem = filter === 'all'
          || (filter === 'pass' && statusClass === 'pass' && !isSkipped)
          || (filter === 'fail' && statusClass === 'fail' && !isSkipped)
          || (filter === 'skipped' && isSkipped)
          || (filter === 'flagged' && isFlagged);
        if (!showItem) return;
        itemsRendered++;

        var el = document.createElement('div');
        el.className = 'result-item ' + statusClass;
        el.dataset.idx = i;

        var header = document.createElement('div');
        header.className = 'result-item-header';
        header.onclick = function() { toggleResultItem(this); };
        var childSummary = isSkipped ? '' : ' · ' + passCount + '/' + (passCount + failCount) + ' passed';
        header.innerHTML = '<div class="result-status-icon">' + statusIcon + '</div>'
          + '<div class="result-q-meta">'
          + '<div class="result-q-num">Question ' + (i + 1) + (isFlagged ? ' · ⚑ Flagged' : '') + childSummary + '</div>'
          + '<div class="result-q-text">' + q.question + '</div>'
          + '</div>'
          + '<div class="expand-arrow">▼</div>';

        var body = document.createElement('div');
        body.className = 'result-item-body';

        if (!isSkipped) {
          q.children.forEach(function (child, ci) {
            var childEval = childEvals[ci];
            var childPassed = childEval ? isPassed(childEval) : null;
            var childAnswer = (state.childAnswers[i] && state.childAnswers[i][ci]) || '';
            var childIcon = childEval ? (childPassed ? '✅' : '❌') : '—';
            var childModel = child.modelAnswer || q.modelAnswer;
            body.innerHTML += '<div style="margin:8px 0;padding:8px 10px;background:var(--surface2);border-radius:8px;border-left:3px solid ' + (childPassed ? 'var(--ok)' : (childEval ? 'var(--bad)' : 'var(--border)')) + '">'
              + '<div style="font-weight:700;font-size:.85rem;margin-bottom:4px;color:var(--accent)">' + childIcon + ' ' + (child.label || 'Part ' + (ci+1)) + ' — ' + (child.question || '') + '</div>'
              + '<div style="font-size:.85rem;margin:2px 0"><strong>Your answer:</strong> ' + (childAnswer || 'Not answered') + '</div>'
              + '<div style="font-size:.85rem"><strong>Model:</strong> ' + childModel + '</div>'
              + (childEval && childEval.feedback ? '<div style="font-size:.82rem;color:var(--muted);margin-top:4px">' + childEval.feedback + '</div>' : '')
              + '</div>';
          });
        }
        if (q.explanation) {
          body.innerHTML += '<div class="explanation-box"><strong>Explanation</strong>' + md(q.explanation) + '</div>';
        }

        el.appendChild(header);
        el.appendChild(body);
        list.appendChild(el);
        return;
      }

      // Standard (non-child) question
      ev = state.evaluations[i];
      evPassed = ev ? isPassed(ev) : null;
      isSkipped = !ev;

      statusClass = isSkipped ? 'skipped' : (evPassed ? 'pass' : 'fail');

      var showItem = filter === 'all'
        || (filter === 'pass' && evPassed && !isSkipped)
        || (filter === 'fail' && evPassed === false && !isSkipped)
        || (filter === 'skipped' && isSkipped)
        || (filter === 'flagged' && isFlagged);

      if (!showItem) return;

      itemsRendered++;

      statusIcon = isSkipped ? '—' : (evPassed ? '✓' : '✗');
      var userAnswer = state.answers[i] || '';

      var el = document.createElement('div');
      el.className = 'result-item ' + statusClass;
      el.dataset.idx = i;

      var header = document.createElement('div');
      header.className = 'result-item-header';
      header.onclick = function() { toggleResultItem(this); };
      header.innerHTML = '<div class="result-status-icon">' + statusIcon + '</div>'
        + '<div class="result-q-meta">'
        + '<div class="result-q-num">Question ' + (i + 1) + (isFlagged ? ' · ⚑ Flagged' : '') + '</div>'
        + '<div class="result-q-text">' + q.question + '</div>'
        + '</div>'
        + '<div class="expand-arrow">▼</div>';

      var body = document.createElement('div');
      body.className = 'result-item-body';

      var bodyHTML = '';
      if (!isSkipped) {
        bodyHTML += '<div class="answer-row user-answer">'
          + '<span class="ar-label">Your Answer</span>'
          + '<span class="ar-text">' + (userAnswer || '(No answer written)') + '</span>'
          + '</div>';
      }
      bodyHTML += '<div class="answer-row model-answer">'
        + '<span class="ar-label">Model Answer</span>'
        + '<span class="ar-text">' + (q.modelAnswer ? md(q.modelAnswer) : '(No model answer supplied)') + '</span>'
        + '</div>';
      if (q.explanation) {
        bodyHTML += '<div class="explanation-box"><strong>Explanation</strong>' + md(q.explanation) + '</div>';
      }

      body.innerHTML = bodyHTML;
      el.appendChild(header);
      el.appendChild(body);
      list.appendChild(el);
    });

    if (itemsRendered === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem;padding:1rem 0;">No questions in this category.</div>';
    }
  }

  function toggleResultItem(header) {
    header.classList.toggle('open');
    var body = header.nextElementSibling;
    if (body) body.classList.toggle('open');
  }

  function filterResults(filter, btn) {
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    renderResultItems(filter);
  }

  function restartAssessment() {
    _deleteGradingCache(); // old session over — release the cache
    state.answers = {};
    state.evaluations = {};
    state.flagged = {};
    state.photoAnswers = {};
    state.childAnswers = {};
    state.childEvaluations = {};
    localStorage.removeItem(STORAGE.progress);
    currentIndex = 0;
    showScreen('start-screen');
    updateResumeButton();
    renderQuestionList();
    showQuestion(currentIndex);
    EngineShared.showToast('Assessment reset.');
  }

  function onExportFilterChange(checkbox) {
    var allCb = document.querySelector('input[name="export-all"]');
    var failedCb = document.querySelector('input[name="export-failed"]');
    var flaggedCb = document.querySelector('input[name="export-flagged"]');
    if (checkbox.name === 'export-all' && checkbox.checked) {
      failedCb.checked = false; flaggedCb.checked = false;
    } else if (checkbox.name !== 'export-all' && checkbox.checked) {
      allCb.checked = false;
    }
    if (!allCb.checked && !failedCb.checked && !flaggedCb.checked) allCb.checked = true;
  }

  function updateExportBadges() {
    var allC = 0, failedC = 0, flaggedC = 0;
    questions.forEach(function(q, i) {
      if (q._hasChildren) {
        var childEvals = state.childEvaluations[i] || [];
        var hasEval = childEvals.some(function (e) { return !!e; });
        if (hasEval) allC++;
        var anyFailed = childEvals.some(function (e) { return e && !isPassed(e); });
        if (anyFailed) failedC++;
      } else {
        var ev = state.evaluations[i];
        var isFailed = ev && !isPassed(ev);
        allC++;
        if (isFailed) failedC++;
      }
      if (state.flagged[i]) flaggedC++;
    });
    document.getElementById('badge-all').textContent = allC;
    document.getElementById('badge-failed').textContent = failedC;
    document.getElementById('badge-flagged').textContent = flaggedC;
  }

  function exportToPDF() {
    var allCb = document.querySelector('input[name="export-all"]');
    var failedCb = document.querySelector('input[name="export-failed"]');
    var flaggedCb = document.querySelector('input[name="export-flagged"]');

    var filter = 'all';
    if (!allCb.checked) {
      if (failedCb.checked && !flaggedCb.checked) filter = 'failed';
      else if (flaggedCb.checked && !failedCb.checked) filter = 'flagged';
      else if (failedCb.checked && flaggedCb.checked) filter = 'failed+flagged';
    }

    EngineShared.showToast('Generating PDF...');

    var title = document.title || 'Assessment Results';
    var pct = document.getElementById('res-pct').textContent;
    var grade = document.getElementById('res-grade').textContent;
    var passed = document.getElementById('res-passed').textContent;
    var failed = document.getElementById('res-failed').textContent;
    var skipped = document.getElementById('res-skipped').textContent;
    var flagged = document.getElementById('res-flagged').textContent;

    var filterLabels = {
      'all': 'All Questions',
      'failed': 'Failed Questions',
      'flagged': 'Flagged Questions',
      'failed+flagged': 'Failed + Flagged'
    };

    var toExport = [];
    questions.forEach(function(q, i) {
      var isFlagged = !!state.flagged[i];
      var ev, evPassed, isSkipped, isFailed;

      if (q._hasChildren) {
        var childEvals = state.childEvaluations[i] || [];
        var evaluatedChildren = childEvals.filter(function (e) { return !!e; });
        var passCount = evaluatedChildren.filter(function (e) { return isPassed(e); }).length;
        var failCount = evaluatedChildren.filter(function (e) { return !isPassed(e); }).length;
        isSkipped = evaluatedChildren.length === 0;
        isFailed = failCount > 0;
        evPassed = !isFailed && !isSkipped;
      } else {
        ev = state.evaluations[i];
        evPassed = ev ? isPassed(ev) : null;
        isSkipped = !ev;
        isFailed = ev && !evPassed;
      }

      var show = filter === 'all'
        || (filter === 'failed' && isFailed)
        || (filter === 'flagged' && isFlagged)
        || (filter === 'failed+flagged' && (isFailed || isFlagged));
      if (show) toExport.push({ q: q, i: i, ev: ev, evPassed: evPassed, isSkipped: isSkipped, isFailed: isFailed, isFlagged: isFlagged });
    });

    var container = document.createElement('div');

    var currentChunkHtml = '<h1 style="font-size:22px;margin:0 0 4px;font-family:Georgia,serif;">' + title + '</h1>'
      + '<p style="color:#78716c;margin:0 0 16px;font-size:13px;">Assessment Results &mdash; ' + new Date().toLocaleDateString() + '</p>'
      + '<div style="background:#f8f6f1;border-radius:12px;padding:18px 20px;margin-bottom:22px;border:1px solid #d0ccc5;display:flex;gap:18px;align-items:center;flex-wrap:wrap;">'
      +   '<div style="width:84px;height:84px;border-radius:50%;border:4px solid #c27803;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;background:rgba(194,120,3,.10);">'
      +     '<div style="font-size:20px;font-weight:700;color:#c27803;line-height:1;">' + pct + '</div>'
      +     '<div style="font-size:9px;color:#78716c;text-transform:uppercase;letter-spacing:.04em;">Pass Rate</div>'
      +   '</div>'
      +   '<div style="flex:1;min-width:180px;">'
      +     '<h2 style="font-family:Georgia,serif;font-size:17px;margin:0 0 10px;">' + grade + '</h2>'
      +     '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#16a34a;">' + passed + '</div><div style="font-size:10px;color:#78716c;">Passed</div></div>'
      +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#dc2626;">' + failed + '</div><div style="font-size:10px;color:#78716c;">Failed</div></div>'
      +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#78716c;">' + skipped + '</div><div style="font-size:10px;color:#78716c;">Skipped</div></div>'
      +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#2563eb;">' + flagged + '</div><div style="font-size:10px;color:#78716c;">Flagged</div></div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin:0 0 12px;">'
      +   (filterLabels[filter] || 'Questions') + ' (' + toExport.length + ')'
      + '</h3>';

    var questionsPerChunk = 15;

    toExport.forEach(function(item, idx) {
      var q = item.q, i = item.i;
      var evPassed = item.evPassed, isSkipped = item.isSkipped, isFlagged = item.isFlagged;
      var sc = isSkipped ? '#78716c' : (evPassed ? '#16a34a' : '#dc2626');
      var icon = isSkipped ? '-' : (evPassed ? 'OK' : 'X');
      var bgH = isSkipped ? '#f8f6f1' : (evPassed ? 'rgba(22,163,74,.06)' : 'rgba(220,38,38,.06)');

      var answerHtml = '';
      if (q._hasChildren) {
        var childEvals = state.childEvaluations[i] || [];
        var childAnswers = state.childAnswers[i] || [];
        q.children.forEach(function (child, ci) {
          var ce = childEvals[ci];
          var cp = ce ? isPassed(ce) : null;
          var ca = childAnswers[ci] || '';
          var cIcon = ce ? (cp ? '✅' : '❌') : '—';
          answerHtml += '<div style="margin:8px 0;padding:8px 10px;background:#f8f6f1;border-radius:6px;border-left:3px solid ' + (cp ? '#16a34a' : (ce ? '#dc2626' : '#d0ccc5')) + '">'
            + '<div style="font-weight:700;font-size:11px;margin-bottom:2px;color:#c27803">' + cIcon + ' ' + (child.label || 'Part ' + (ci+1)) + ' — ' + EngineShared.escHtml(child.question) + '</div>'
            + '<div style="font-size:10px;margin:2px 0"><strong>Answer:</strong> ' + EngineShared.escHtml(ca || 'Not answered') + '</div>'
            + '<div style="font-size:10px"><strong>Model:</strong> ' + (child.modelAnswer || q.modelAnswer || '—') + '</div>'
            + '</div>';
        });
      } else {
        var userAnswer = state.answers[i] || '';
        answerHtml = '<div style="background:' + (evPassed ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)') + ';border-radius:6px;padding:7px 11px;margin-bottom:7px;font-size:12px;"><span style="font-size:10px;text-transform:uppercase;font-weight:700;opacity:.6;margin-right:8px;">Your Answer</span>' + (userAnswer || 'Not answered') + '</div>'
          + '<div style="background:rgba(22,163,74,.08);border-radius:6px;padding:7px 11px;margin-bottom:7px;font-size:12px;"><span style="font-size:10px;text-transform:uppercase;font-weight:700;opacity:.6;margin-right:8px;">Model Answer</span>' + (q.modelAnswer ? md(q.modelAnswer) : '(No model answer supplied)') + '</div>';
      }

      currentChunkHtml += '<div style="border:1.5px solid ' + sc + ';border-radius:10px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid;">'
        +   '<div style="padding:12px 15px;background:' + bgH + ';">'
        +     '<div style="display:flex;gap:10px;align-items:flex-start;">'
        +       '<div style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;background:rgba(0,0,0,.06);color:' + sc + ';">' + icon + '</div>'
        +       '<div>'
        +         '<div style="font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Q' + (i+1) + (isFlagged ? ' &bull; Flagged' : '') + '</div>'
        +         '<div style="font-size:14px;font-weight:500;line-height:1.5;">' + md(q.question) + '</div>'
        +       '</div>'
        +     '</div>'
        +   '</div>'
        +   '<div style="padding:10px 15px 12px;border-top:1px solid #e5e0db;">'
        +     answerHtml
        + (q.explanation ? '<div style="background:#f8f6f1;border-left:3px solid #c27803;border-radius:0 6px 6px 0;padding:9px 11px;font-size:12px;color:#44403c;line-height:1.6;margin-top:6px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#1c1917;margin-bottom:3px;">Explanation</div>' + md(q.explanation) + '</div>' : '')
        + '</div></div>';

      if ((idx + 1) % questionsPerChunk === 0 || idx === toExport.length - 1) {
        var chunkDiv = document.createElement('div');
        chunkDiv.innerHTML = '<div style="font-family:Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#1c1917;">' + currentChunkHtml + '</div>';
        container.appendChild(chunkDiv);
        currentChunkHtml = '';
      }
    });

    var filename = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_results.pdf';
    var opt = {
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: 'jpeg', quality: 0.97 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    function runExport() {
      var children = Array.from(container.children);
      if (children.length === 0) return;

      var worker = html2pdf().set(opt).from(children[0]).toPdf();

      children.slice(1).forEach(function(child) {
        worker = worker.get('pdf').then(function(pdf) {
          pdf.addPage();
        }).from(child).toContainer().toCanvas().toPdf();
      });

      worker.save().catch(function() {});
    }

    if (typeof html2pdf !== 'undefined') {
      runExport();
    } else {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = runExport;
      s.onerror = function() { EngineShared.showToast('Failed to load PDF library'); };
      document.head.appendChild(s);
    }
  }

  function confirmResetProgress() {
    $('#reset-modal').classList.add('open');
  }

  function closeResetModal() {
    $('#reset-modal').classList.remove('open');
  }

  function confirmResetAction() {
    state.answers = {};
    state.evaluations = {};
    state.flagged = {};
    state.photoAnswers = {};
    state.childAnswers = {};
    state.childEvaluations = {};
    localStorage.removeItem(STORAGE.progress);
    closeResetModal();
    currentIndex = 0;
    showScreen('start-screen');
    updateResumeButton();
    EngineShared.showToast('Progress has been reset.');
  }

  function openSettings() {
    $('#settings-api-key').value = _readKey();
    $('#settings-status').textContent = '';
    $('#settings-max-wait').value = localStorage.getItem(STORAGE.maxWait) || '15';
    $('#settings-retry-level').value = _getRetryLevel();
    $('#settings-modal').classList.add('open');
    setTimeout(function () { $('#settings-api-key').focus(); }, 100);
  }

  function closeSettings() {
    $('#settings-modal').classList.remove('open');
  }

  function saveSettingsKey() {
    var value = ($('#settings-api-key').value || '').trim();
    _writeKey(value || '');
    EngineShared.showToast(value ? 'API key saved.' : 'API key cleared.');
    closeSettings();
  }

  function clearSettingsKey() {
    _writeKey('');
    $('#settings-api-key').value = '';
    $('#settings-status').textContent = '';
    EngineShared.showToast('API key cleared.');
    closeSettings();
  }

  function testSettingsKey() {
    var value = ($('#settings-api-key').value || '').trim();
    if (!value) {
      $('#settings-status').textContent = '✗ No key entered.';
      return;
    }
    $('#settings-status').textContent = 'Testing...';
    fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': value } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.models && data.models.length) {
          $('#settings-status').textContent = '✓ Key is valid (' + data.models.length + ' models available).';
        } else {
          $('#settings-status').textContent = '✗ Unexpected response. Check the key.';
        }
      })
      .catch(function () {
        $('#settings-status').textContent = '✗ Connection failed. Check the key or your network.';
      });
  }

  function toggleKeyVisibility() {
    var input = $('#settings-api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  }



  function updateThemeButtons() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    $all('#theme-start,#theme-practice,#theme-result').forEach(function (btn) {
      btn.textContent = isDark ? '☀' : '☾';
    });
  }

  function setLoading(active, modelName) {
    $('#loading').classList.toggle('active', !!active);
    $('#loading-box').classList.toggle('glow', !!active);
    $('#ai-grade').disabled = !!active;
    $('#self-grade').disabled = !!active;
    if (active) {
      _loadingStartTime = Date.now();
      $('#loading-timer').textContent = '⏱ 0s';
      $('#loading-note').textContent = modelName
        ? 'Grading with ' + modelName
        : 'Comparing your response with the model answer';
      $('#cancel-grading').style.display = '';
      if (_loadingTimerInterval) clearInterval(_loadingTimerInterval);
      _loadingTimerInterval = setInterval(function () {
        var elapsed = Math.round((Date.now() - _loadingStartTime) / 1000);
        $('#loading-timer').textContent = '⏱ ' + elapsed + 's';
      }, 500);
    } else {
      if (_loadingTimerInterval) {
        clearInterval(_loadingTimerInterval);
        _loadingTimerInterval = null;
      }
      $('#cancel-grading').style.display = 'none';
      $('#loading-timer').textContent = '';
      _gradingAbortController = null;
    }
  }



  function loadProgress() {
    var raw = localStorage.getItem(STORAGE.progress);
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      state.answers = saved.answers || {};
      state.evaluations = saved.evaluations || {};
      state.flagged = saved.flagged || {};
      state.photoAnswers = saved.photoAnswers || {};
      state.childAnswers = saved.childAnswers || {};
      state.childEvaluations = saved.childEvaluations || {};
    } catch (error) {
      console.error('Could not restore written assessment progress.', error);
    }
  }

  function saveProgress() {
    var payload = {
      answers: state.answers,
      evaluations: state.evaluations,
      flagged: state.flagged,
      photoAnswers: state.photoAnswers,
      childAnswers: state.childAnswers,
      childEvaluations: state.childEvaluations,
      timestamp: Date.now()
    };
    try {
      localStorage.setItem(STORAGE.progress, JSON.stringify(payload));
    } catch (error) {
      EngineShared.showToast('Storage full. Clear old tracker data to keep saving.');
    }
  }

// --- Camera & Photo functions ---
var _cameraStream = null;
var _useFrontCamera = false;
var _capturedDataUrl = null;
var _cropBox = null; // { left, top, width, height } in display px
var _cropDragType = null; // 'move', 'nw', 'ne', 'sw', 'se' or null
var _cropDragStartX = 0;
var _cropDragStartY = 0;
var _cropStartBox = null;

function hasPhoto(index) {
  return state.photoAnswers && state.photoAnswers[index] && state.photoAnswers[index].data;
}

function _renderCropBox() {
  if (!_cropBox) return;
  var box = $('#crop-box');
  box.style.left = _cropBox.left + 'px';
  box.style.top = _cropBox.top + 'px';
  box.style.width = _cropBox.width + 'px';
  box.style.height = _cropBox.height + 'px';
}

function _getPointerPos(e) {
  var container = $('#crop-container');
  var rect = container.getBoundingClientRect();
  var cx = e.touches ? e.touches[0].clientX : e.clientX;
  var cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: cx - rect.left, y: cy - rect.top };
}

function _startCropDrag(e) {
  if (e.type === 'mousedown' && e.button !== 0) return;
  e.preventDefault();
  _cropDragType = 'move';
  var pos = _getPointerPos(e);
  _cropDragStartX = pos.x;
  _cropDragStartY = pos.y;
  _cropStartBox = { left: _cropBox.left, top: _cropBox.top, width: _cropBox.width, height: _cropBox.height };
  document.addEventListener('mousemove', _onCropMove);
  document.addEventListener('mouseup', _endCropDrag);
  document.addEventListener('touchmove', _onCropMove, { passive: false });
  document.addEventListener('touchend', _endCropDrag);
}

function _startCropResize(e, handle) {
  if (e.type === 'mousedown' && e.button !== 0) return;
  e.preventDefault();
  _cropDragType = handle;
  var pos = _getPointerPos(e);
  _cropDragStartX = pos.x;
  _cropDragStartY = pos.y;
  _cropStartBox = { left: _cropBox.left, top: _cropBox.top, width: _cropBox.width, height: _cropBox.height };
  document.addEventListener('mousemove', _onCropMove);
  document.addEventListener('mouseup', _endCropDrag);
  document.addEventListener('touchmove', _onCropMove, { passive: false });
  document.addEventListener('touchend', _endCropDrag);
}

function _onCropMove(e) {
  e.preventDefault();
  var maxW = $('#crop-container').clientWidth;
  var maxH = $('#crop-container').clientHeight;
  var pos = _getPointerPos(e);
  var dx = pos.x - _cropDragStartX;
  var dy = pos.y - _cropDragStartY;
  var b = _cropStartBox;
  var min = 40;

  var l = b.left, t = b.top, r = b.left + b.width, bm = b.top + b.height;

  switch (_cropDragType) {
    case 'move':
      l = b.left + dx; t = b.top + dy;
      r = l + b.width; bm = t + b.height;
      break;
    case 'se':
      r = b.left + b.width + dx; bm = b.top + b.height + dy;
      break;
    case 'sw':
      l = b.left + dx; r = b.left + b.width; bm = b.top + b.height + dy;
      break;
    case 'ne':
      t = b.top + dy; r = b.left + b.width + dx; bm = b.top + b.height;
      break;
    case 'nw':
      l = b.left + dx; t = b.top + dy; r = b.left + b.width; bm = b.top + b.height;
      break;
  }

  l = Math.max(0, Math.min(l, maxW - min));
  t = Math.max(0, Math.min(t, maxH - min));
  r = Math.max(l + min, Math.min(r, maxW));
  bm = Math.max(t + min, Math.min(bm, maxH));

  _cropBox.left = l;
  _cropBox.top = t;
  _cropBox.width = r - l;
  _cropBox.height = bm - t;
  _renderCropBox();
}

function _endCropDrag() {
  _cropDragType = null;
  document.removeEventListener('mousemove', _onCropMove);
  document.removeEventListener('mouseup', _endCropDrag);
  document.removeEventListener('touchmove', _onCropMove);
  document.removeEventListener('touchend', _endCropDrag);
}

function _initCrop() {
  var img = $('#crop-image');
  var naturalW = img.naturalWidth;
  var naturalH = img.naturalHeight;
  var displayW = img.clientWidth || naturalW;
  var displayH = img.clientHeight || naturalH;
  if (!displayW || !displayH) return;
  var pad = 0.05;
  var w = Math.round(displayW * (1 - pad * 2));
  var h = Math.round(displayH * (1 - pad * 2));
  _cropBox = {
    left: Math.round((displayW - w) / 2),
    top: Math.round((displayH - h) / 2),
    width: w,
    height: h
  };
  _renderCropBox();

  // Bind drag events on the crop box
  var box = $('#crop-box');
  box.addEventListener('mousedown', _startCropDrag);
  box.addEventListener('touchstart', _startCropDrag, { passive: false });

  // Bind resize events on handles
  document.querySelectorAll('.crop-handle').forEach(function (el) {
    var handle = el.classList.contains('nw') ? 'nw' :
                 el.classList.contains('ne') ? 'ne' :
                 el.classList.contains('sw') ? 'sw' : 'se';
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); _startCropResize(e, handle); });
    el.addEventListener('touchstart', function (e) { e.stopPropagation(); _startCropResize(e, handle); }, { passive: false });
  });
}

function _showCropSection(imgSrc) {
  _capturedDataUrl = imgSrc;
  $('#camera-viewfinder-section').style.display = 'none';
  $('#camera-crop-section').style.display = 'block';
  var cropImg = $('#crop-image');
  cropImg.src = imgSrc;
  if (cropImg.complete && cropImg.naturalWidth) {
    _initCrop();
  } else {
    cropImg.addEventListener('load', _initCrop, { once: true });
  }
}

function applyCrop() {
  if (!_capturedDataUrl || !_cropBox) return;
  var img = new Image();
  img.onload = function () {
    var displayW = $('#crop-image').clientWidth || img.naturalWidth;
    var displayH = $('#crop-image').clientHeight || img.naturalHeight;
    var sx = (_cropBox.left / displayW) * img.naturalWidth;
    var sy = (_cropBox.top / displayH) * img.naturalHeight;
    var sw = (_cropBox.width / displayW) * img.naturalWidth;
    var sh = (_cropBox.height / displayH) * img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    var cropped = c.toDataURL('image/jpeg', 0.85);
    state.photoAnswers[currentIndex] = {
      data: cropped.replace(/^data:image\/\w+;base64,/, ''),
      mimeType: 'image/jpeg'
    };
    closeCamera();
    showQuestion(currentIndex);
    EngineShared.showToast('Photo captured.');
  };
  img.src = _capturedDataUrl;
}

function openCamera() {
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    EngineShared.showToast('Camera requires HTTPS or localhost. Use Upload instead.');
    openFilePicker();
    return;
  }
  _capturedDataUrl = null;
  $('#camera-modal').classList.add('open');
  $('#camera-crop-section').style.display = 'none';
  $('#camera-viewfinder-section').style.display = 'block';

  var constraints = {
    video: { facingMode: _useFrontCamera ? 'user' : 'environment' }
  };

  navigator.mediaDevices.getUserMedia(constraints)
    .then(function (stream) {
      _cameraStream = stream;
      var video = $('#camera-video');
      video.srcObject = stream;
    })
    .catch(function (err) {
      closeCamera();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        EngineShared.showToast('Camera permission denied. Use Upload instead.');
      } else if (err.name === 'NotFoundError') {
        EngineShared.showToast('No camera found. Use Upload instead.');
      } else {
        EngineShared.showToast('Camera error: ' + (err.message || 'unknown'));
      }
      openFilePicker();
    });
}

function closeCamera() {
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(function (track) { track.stop(); });
    _cameraStream = null;
  }
  _capturedDataUrl = null;
  $('#camera-modal').classList.remove('open');
}

function capturePhoto() {
  var video = $('#camera-video');
  var canvas = $('#camera-canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  _showCropSection(dataUrl);
}

function cropAndUse() {
  applyCrop();
}

function switchCamera() {
  _useFrontCamera = !_useFrontCamera;
  if (_cameraStream) {
    _cameraStream.getTracks().forEach(function (track) { track.stop(); });
    _cameraStream = null;
  }
  openCamera();
}

function openFilePicker() {
  $('#photo-file-input').click();
}

function handlePhotoFile(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    EngineShared.showToast('Please select an image file.');
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var dataUrl = e.target.result;
    $('#camera-modal').classList.add('open');
    _showCropSection(dataUrl);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function removePhoto() {
  delete state.photoAnswers[currentIndex];
  showQuestion(currentIndex);
  EngineShared.showToast('Photo removed.');
}


  function init() {
    initStyles();
    initMarkup();
    loadProgress();
    initContent();
    bindEvents();
  }

  window.startWrittenAssessment = beginAssessment;
  window.toggleWrittenTheme = function() { EngineShared.toggleTheme(); updateThemeButtons(); };
  window.filterResults = filterResults;
  window.restartAssessment = restartAssessment;
  window.toggleResultItem = toggleResultItem;
  window.exportToPDF = exportToPDF;
  window.onExportFilterChange = onExportFilterChange;

  if (typeof marked === 'undefined') {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    document.head.appendChild(s);
  }
  init();
})();
