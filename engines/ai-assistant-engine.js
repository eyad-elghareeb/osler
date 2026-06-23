/* ================================================================
   ai-assistant-engine.js  —  Optional AI assistant for quiz/bank engines.
   Lazy-loaded only when user clicks the 🤖 button or expands study notes.
   Requires internet connection — NOT cached by service worker.
   Shares localStorage keys with written-engine.js so one key works everywhere.
   ================================================================ */
(function () {
  'use strict';

  /* ── Storage ────────────────────────────────────────────────── */
  var _SK = {
    apiKey: 'gemini_api_key',
    model:  'gemini_selected_model',
    maxWait:'gemini_max_wait',
    retry:  'gemini_retry_level'
  };
  /* ── Models ──────────────────────────────────────────────────── */
  var MODELS = [
    ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite (default, fast & modern)'],
    ['gemini-3.5-flash',      'Gemini 3.5 Flash (latest, strongest Flash)'],
    ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview (most capable, premium)'],
    ['gemma-4-26b-a4b-it',    'Gemma 4 26B IT (open model, strong & free)'],
    ['gemma-4-31b-it',        'Gemma 4 31B IT (larger open model)'],
    ['gemini-2.5-flash',      'Gemini 2.5 Flash (older fallback)']
  ];

  /* ── API key access (thin wrappers over EngineShared) ────────── */
  function _readKey()        { return EngineShared.airReadGeminiKey(); }
  function _writeKey(plain)  { EngineShared.airWriteGeminiKey(plain); }
  function _hasApiKey()      { return EngineShared.airHasGeminiKey(); }

  function _getSavedModel()  { return localStorage.getItem(_SK.model) || MODELS[0][0]; }
  function _getModelLabel(id) {
    for (var i = 0; i < MODELS.length; i++) { if (MODELS[i][0] === id) return MODELS[i][1]; }
    return id;
  }
  function _getMaxWaitMs()   { var v = localStorage.getItem(_SK.maxWait) || '15'; var n = parseInt(v, 10); return n > 0 ? n * 1000 : 0; }
  function _getRetryLevel()  { return localStorage.getItem(_SK.retry) || 'balanced'; }
  function modelIsAvailable(modelId) { return MODELS.some(function (m) { return m[0] === modelId; }); }

  /* ── Gemini transport (thin wrappers over EngineShared) ──────── */
  function extractGeminiText(payload)  { return EngineShared.airExtractGeminiText(payload); }
  function friendlyAiError(error)      { return EngineShared.airFriendlyError(error); }
  function buildGeminiAttempts(model)  { return EngineShared.airBuildAttempts(model, MODELS, _getRetryLevel()); }
  function tryGeminiRequests(systemPrompt, userPrompt, apiKey, attempts, cancelSignal) {
    return EngineShared.airTryRequests(systemPrompt, [{parts:[{text:userPrompt}]}], apiKey, attempts, cancelSignal, 0.3, _getMaxWaitMs());
  }
  function requestGeminiChat(systemPrompt, contents, apiKey, model, cancelSignal) {
    return EngineShared.airRequestGemini(systemPrompt, contents, apiKey, model, cancelSignal, 0.3, _getMaxWaitMs());
  }
  function tryGeminiChatRequests(systemPrompt, contents, apiKey, attempts, cancelSignal) {
    return EngineShared.airTryRequests(systemPrompt, contents, apiKey, attempts, cancelSignal, 0.3, _getMaxWaitMs());
  }

  /* ── Markdown renderer (lightweight) 
  function _renderMarkdown(text) {
    if (!text) return '';
    text = String(text);

    // Handle backslash escapes before HTML escaping
    text = text.replace(/\\([*_~`#\[\]()>!|\\-])/g, '$1');

    // Escape HTML first (code blocks will be re-escaped after)
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Code blocks (```lang ... ```)
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      return '<pre dir="auto"><code dir="auto">' + code.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>';
    });

    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code dir="auto">$1</code>');

    // Headings
    text = text.replace(/^##### (.+)$/gm, '<h6 dir="auto">$1</h6>');
    text = text.replace(/^#### (.+)$/gm, '<h5 dir="auto">$1</h5>');
    text = text.replace(/^### (.+)$/gm, '<h4 dir="auto">$1</h4>');
    text = text.replace(/^## (.+)$/gm, '<h3 dir="auto">$1</h3>');
    text = text.replace(/^# (.+)$/gm, '<h2 dir="auto">$1</h2>');

    // Blockquotes
    text = text.replace(/^&gt; (.+)$/gm, '<blockquote dir="auto">$1</blockquote>');

    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong dir="auto">$1</strong>');

    // Italic — bold was processed above, so remaining *...* pairs are italic
    text = text.replace(/\*([^*]+)\*/g, '<em dir="auto">$1</em>');

    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a dir="auto" href="$2" target="_blank" rel="noopener">$1</a>');

    // Unordered lists (line-by-line then wrap)
    text = text.replace(/^- (.+)$/gm, '<!--ul--><li dir="auto">$1</li>');
    text = text.replace(/(?:<!--ul--><li>.*?<\/li>\n?)+/g, function (m) { return '<ul>' + m.replace(/<!--ul-->/g,'') + '</ul>'; });

    // Ordered lists
    text = text.replace(/^\d+\. (.+)$/gm, '<!--ol--><li dir="auto">$1</li>');
    text = text.replace(/(?:<!--ol--><li>.*?<\/li>\n?)+/g, function (m) { return '<ol>' + m.replace(/<!--ol-->/g,'') + '</ol>'; });

    // Clean up leftover markers
    text = text.replace(/<!--[ou]l-->/g, '');

    // Horizontal rules
    text = text.replace(/^---+$/gm, '<hr>');

    // Consecutive blockquotes — merge into a single wrapper
    text = text.replace(/(<blockquote>.*?<\/blockquote>\n?)+/g, function (m) {
      return '<blockquote>' + m.replace(/<\/?blockquote>/g,'').trim() + '</blockquote>';
    });

    // Double newlines → paragraph breaks
    // Only wrap in <p> if the text doesn't already contain block-level HTML
    if (!/<(h[2-6]|pre|ul|ol|blockquote|hr|table)[>\s]/i.test(text)) {
      var paragraphs = text.split(/\n\s*\n/);
      if (paragraphs.length > 1) {
        text = paragraphs.map(function (p) { return '<p dir="auto">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('\n');
      }
    }

    // Single newlines inside text (not inside block tags) → <br>
    text = text.replace(/\n/g, '<br>');

    // Cleanup: remove empty <p> tags
    text = text.replace(/<p>\s*<br>\s*<\/p>/g, '');
    text = text.replace(/<p><\/p>/g, '');

    return text;
  }

  /* ── Build prompts (system + user separated) ──────────────────── */
  function _buildSysPrompt() {
    return [
      'You are a medical quiz tutor and study assistant.',
      '',
      'Your purpose is to help students understand medical concepts, clarify doubts, and deepen their knowledge through clear, focused explanations.',
      '',
      '# RULES',
      '• Answer in 1-3 short sentences or a few bullet points.',
      '• Be direct and concise. No introductions, no conclusions, no fluff.',
      '• When explaining concepts, reference the specific question context provided by the user.',
      '• If you need more information to give a precise answer, ask a focused follow-up question.',
      '• Always maintain an encouraging, educational tone.',
      '• Use clear language appropriate for medical students.',
      '',
      '# SCOPE',
      '• Focus on medical and health sciences education.',
      '• For questions outside this scope, politely redirect to the question at hand.'
    ].join('\n');
  }

  function _buildUserPrompt(questionObj, userQuery) {
    var parts = [];
    var ctx = '## Current Question\n' + (questionObj.question || '');
    if (questionObj.options && Array.isArray(questionObj.options)) {
      var keys = ['A','B','C','D','E','F','G','H'];
      questionObj.options.forEach(function (opt, i) {
        ctx += '\n' + (keys[i] || i) + '. ' + opt;
      });
      if (typeof questionObj.correct === 'number' && questionObj.options[questionObj.correct]) {
        ctx += '\n\nCorrect answer: ' + (keys[questionObj.correct] || questionObj.correct) + '. ' + questionObj.options[questionObj.correct];
      }
    }
    parts.push(ctx);
    parts.push('');
    parts.push('## My Question');
    parts.push(userQuery);
    return parts.join('\n');
  }

  function _buildNotesPrompt(questions, answers) {
    var wrongItems = [];
    questions.forEach(function (q, i) {
      var ans = answers[i];
      if (ans === undefined || ans === q.correct) return;
      wrongItems.push({
        question: q.question,
        userAnswer: q.options[ans] || '(selected ' + ans + ')',
        correctAnswer: q.options[q.correct],
        explanation: q.explanation || ''
      });
    });
    if (!wrongItems.length) return null;

    var prompt = 'You are a medical education tutor. Create very concise bullet-point study notes from these mistakes.\n\n';
    wrongItems.forEach(function (item, i) {
      prompt += 'Q' + (i + 1) + ': ' + item.question + '\n';
      prompt += 'Your answer: ' + item.userAnswer + '\n';
      prompt += 'Correct: ' + item.correctAnswer + '\n';
      if (item.explanation) prompt += 'Explanation: ' + item.explanation + '\n';
      prompt += '\n';
    });
    prompt += 'Output only concise bullet-point notes. One short line per concept. No fluff, no introductions, no conclusions.';
    return { prompt: prompt, count: wrongItems.length };
  }

  /* ── CSS ────────────────────────────────────────────────────── */
  var _aiCSS = null;
  function _injectCSS() {
    if (_aiCSS) return;
    _aiCSS = document.createElement('style');
    _aiCSS.textContent =
      '#ai-assistant-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease}\n' +
      '#ai-assistant-overlay:not(.open){display:none}\n' +
      '#ai-assistant-modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(640px,94vw);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,0.5);animation:slideUp .25s ease}\n' +
      '#ai-assistant-header{display:flex;align-items:center;justify-content:space-between;padding:.6rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0}\n' +
      '#ai-assistant-header h3{margin:0;font-size:1rem}\n' +
      '#ai-assistant-context{flex-shrink:0;background:var(--surface2);border-bottom:1px solid var(--border);font-size:.82rem}\n' +
      '#ai-context-header{display:flex;align-items:center;justify-content:space-between;padding:.35rem 1rem;cursor:pointer;user-select:none;color:var(--text-muted);font-size:.78rem;font-weight:500;transition:background .15s}\n' +
      '#ai-context-header:hover{background:var(--surface)}\n' +
      '#ai-context-header .collapse-arrow{font-size:.65rem;transition:transform .2s}\n' +
      '#ai-context-header .collapse-arrow.open{transform:rotate(180deg)}\n' +
      '#ai-context-body{max-height:0;overflow:hidden;transition:max-height .25s ease,padding .25s ease;padding:0 1rem}\n' +
      '#ai-context-body.open{max-height:140px;overflow-y:auto;padding:.4rem 1rem .65rem}\n' +
      '#ai-context-body .q-label{font-weight:600;color:var(--text);margin-bottom:3px}\n' +
      '#ai-context-body .opt-line{padding-left:.5rem;font-size:.8rem}\n' +
      /* Chat area */
      '#ai-chat-area{flex:1;overflow-y:auto;padding:.5rem 1rem;display:flex;flex-direction:column;gap:.4rem;min-height:160px;scroll-behavior:smooth}\n' +
       '.chat-msg{max-width:92%;padding:.45rem .75rem;border-radius:10px;font-size:.85rem;line-height:1.5;word-wrap:break-word;animation:fadeIn .2s ease;unicode-bidi:plaintext}\n' +
      '.user-msg{align-self:flex-end;background:var(--accent-dim);border:1px solid rgba(240,165,0,0.2)}\n' +
      '.ai-msg{align-self:flex-start;background:var(--surface2);border:1px solid var(--border)}\n' +
      '.chat-msg .msg-label{font-size:.68rem;font-weight:600;margin-bottom:3px;opacity:.55}\n' +
       '.chat-msg .msg-body *{unicode-bidi:plaintext}\n' +
       '.chat-msg p{margin:0 0 .3rem}\n' +
      '.chat-msg p:last-child{margin-bottom:0}\n' +
      '.chat-msg ul,.chat-msg ol{margin:.25rem 0;padding-left:1.2rem}\n' +
      '.chat-msg li{margin-bottom:.15rem}\n' +
      '.chat-msg code{background:rgba(0,0,0,0.2);padding:.08rem .3rem;border-radius:4px;font-size:.8rem}\n' +
      '.chat-msg pre{background:rgba(0,0,0,0.2);padding:.5rem .7rem;border-radius:8px;overflow-x:auto;margin:.35rem 0;font-size:.8rem}\n' +
      '.chat-msg pre code{background:none;padding:0}\n' +
      '.chat-msg strong{font-weight:600}\n' +
      '.chat-msg a{color:var(--accent);text-decoration:underline}\n' +
      '.chat-msg blockquote{border-left:3px solid var(--accent);padding-left:.6rem;margin:.25rem 0;opacity:.85}\n' +
      '.chat-msg h2,.chat-msg h3,.chat-msg h4,.chat-msg h5,.chat-msg h6{margin:.35rem 0 .15rem;font-weight:600}\n' +
      '.chat-msg h2{font-size:.95rem}\n' +
      '.chat-msg h3{font-size:.9rem}\n' +
      '.chat-msg h4{font-size:.87rem}\n' +
      '.chat-msg .thinking-indicator{display:flex;gap:3px;padding:4px 0}\n' +
      '.chat-msg .thinking-indicator span{width:6px;height:6px;border-radius:50%;background:var(--text-muted);animation:bounce 1.2s infinite}\n' +
      '.chat-msg .thinking-indicator span:nth-child(2){animation-delay:.2s}\n' +
      '.chat-msg .thinking-indicator span:nth-child(3){animation-delay:.4s}\n' +
      '@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}}\n' +
      '#ai-input-wrap{display:flex;gap:.5rem;align-items:flex-end;padding:.5rem 1rem;border-top:1px solid var(--border);flex-shrink:0}\n' +
      '#ai-input{flex:1;padding:.5rem .75rem;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-size:.85rem;resize:none;min-height:38px;max-height:80px;outline:none}\n' +
      '#ai-input:focus{border-color:var(--accent)}\n' +
      '#ai-send-btn{padding:.6rem 1rem;border-radius:8px;border:none;background:var(--accent);color:#000;font-weight:600;font-size:.85rem;cursor:pointer;white-space:nowrap}\n' +
      '#ai-send-btn:disabled{opacity:.5;cursor:not-allowed}\n' +
      '#ai-chat-error{padding:.35rem .75rem;margin:0 1rem;border-radius:6px;background:var(--wrong-bg);color:var(--wrong);font-size:.8rem;display:none;flex-shrink:0}\n' +
      '#ai-chat-error.show{display:block}\n' +
      '@keyframes spin{to{transform:rotate(360deg)}}\n' +
      '@keyframes fadeIn{from{opacity:0}to{opacity:1}}\n' +
      '@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}\n' +
      /* Study notes card */
      '#study-notes-card{margin:1rem 1.25rem;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--surface)}\n' +
      '#study-notes-header{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;cursor:pointer;font-weight:600;font-size:.9rem;user-select:none;transition:background .15s}\n' +
      '#study-notes-header:hover{background:var(--surface2)}\n' +
      '#study-notes-header .arrow{font-size:.75rem;transition:transform .2s}\n' +
      '#study-notes-header .arrow.open{transform:rotate(180deg)}\n' +
      '#study-notes-body{display:none;padding:0 1rem 1rem;font-size:.85rem;line-height:1.6;border-top:1px solid var(--border);max-height:400px;overflow-y:auto}\n' +
      '#study-notes-body.open{display:block;padding-top:1rem}\n' +
       '#study-notes-body .notes-content{white-space:pre-wrap;word-wrap:break-word;line-height:1.6;unicode-bidi:plaintext}\n' +
       '#study-notes-body .notes-content *{unicode-bidi:plaintext}\n' +
       '#study-notes-body .notes-content p{margin:0 0 .3rem}\n' +
      '#study-notes-body .notes-content p:last-child{margin-bottom:0}\n' +
      '#study-notes-body .notes-content ul,.notes-content ol{margin:.3rem 0;padding-left:1.3rem}\n' +
      '#study-notes-body .notes-content li{margin-bottom:.15rem}\n' +
      '#study-notes-body .notes-content code{background:rgba(0,0,0,0.15);padding:.08rem .3rem;border-radius:4px;font-size:.8rem}\n' +
      '#study-notes-body .notes-content pre{background:rgba(0,0,0,0.15);padding:.5rem .7rem;border-radius:8px;overflow-x:auto;margin:.35rem 0;font-size:.8rem}\n' +
      '#study-notes-body .notes-content pre code{background:none;padding:0}\n' +
      '#study-notes-body .notes-content strong{font-weight:600}\n' +
      '#study-notes-body .notes-content a{color:var(--accent);text-decoration:underline}\n' +
      '#study-notes-body .notes-content blockquote{border-left:3px solid var(--accent);padding-left:.6rem;margin:.25rem 0;opacity:.85}\n' +
      '#study-notes-body .notes-content h2,.notes-content h3,.notes-content h4{font-weight:600;margin:.4rem 0 .15rem}\n' +
      '#study-notes-body .notes-content h2{font-size:.95rem}\n' +
      '#study-notes-body .notes-content h3{font-size:.9rem}\n' +
      '#study-notes-body .notes-content h4{font-size:.86rem}\n' +
      '#study-notes-body .notes-loading{display:flex;align-items:center;gap:.5rem;color:var(--text-muted)}\n' +
      '#study-notes-body .notes-loading .spinner{width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}\n' +
      '#study-notes-body .notes-error{color:var(--wrong);margin-bottom:.5rem}\n' +
      '#study-notes-body .notes-error .retry-btn{margin-left:.5rem;text-decoration:underline;cursor:pointer;color:var(--accent)}\n' +
      '#study-notes-body .regenerate-btn{display:inline-block;margin-top:.5rem;padding:.3rem .7rem;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.75rem;cursor:pointer}\n' +
      /* Settings sub-modal */
      '#ai-settings-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center}\n' +
      '#ai-settings-overlay:not(.open){display:none}\n' +
      '#ai-settings-modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(400px,92vw);padding:1.25rem;box-shadow:0 12px 36px rgba(0,0,0,0.5)}\n' +
      '#ai-settings-modal h3{margin:0 0 1rem;font-size:1rem}\n' +
      '#ai-settings-modal .field-label{display:block;font-size:.82rem;font-weight:600;margin-bottom:4px;color:var(--text)}\n' +
      '#ai-settings-modal input[type=password],#ai-settings-modal select{width:100%;padding:.5rem .7rem;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-size:.85rem;outline:none}\n' +
      '#ai-settings-modal input:focus,#ai-settings-modal select:focus{border-color:var(--accent)}\n' +
      '#ai-settings-modal .field-box{margin-bottom:1rem}\n' +
      '#ai-settings-modal .api-row{display:flex;gap:.5rem}\n' +
      '#ai-settings-modal .api-row input{flex:1}\n' +
      '#ai-settings-modal .field-note{font-size:.75rem;color:var(--text-muted);margin-top:4px}\n' +
      '#ai-settings-modal .btn-row{display:flex;gap:.5rem;margin-top:.5rem}\n' +
      '#ai-settings-modal .btn-row button{padding:.5rem .9rem;border-radius:6px;border:none;font-size:.82rem;font-weight:600;cursor:pointer}\n' +
      '#ai-settings-modal .btn-primary{background:var(--accent);color:#000}\n' +
      '#ai-settings-modal .btn-secondary{background:var(--surface2);color:var(--text);border:1px solid var(--border)}\n' +
      '#ai-settings-modal #settings-status{font-size:.8rem;margin-top:6px}\n' +
      '#ai-settings-modal .field-row{display:flex;gap:.5rem;align-items:center}\n' +
      '#ai-settings-modal .field-row select{flex:1}';
    document.head.appendChild(_aiCSS);
  }

  /* ── State ──────────────────────────────────────────────────── */
  var _currentQuestion = null;
  var _chatHistory = []; // [{role:'user'|'model', text:'...'}]
  var _notesCache = null;

  /* ── Render helpers ──────────────────────────────────────────── */
  function _$(id) { return document.getElementById(id); }

  /* ── AI Assistant Modal (chat UI) ────────────────────────────── */
  function _renderAssistantHTML() {
    _injectCSS();
    if (_$('ai-assistant-overlay')) return;

    var div = document.createElement('div');
    div.id = 'ai-assistant-overlay';
    div.innerHTML =
      '<div id="ai-assistant-modal">' +
        '<div id="ai-assistant-header">' +
          '<h3>🤖 AI Assistant</h3>' +
          '<div style="display:flex;gap:.5rem;align-items:center">' +
            '<button class="icon-btn" id="ai-settings-gear" title="AI Settings" style="font-size:1rem">⚙</button>' +
            '<button class="icon-btn" id="ai-close-btn" title="Close">✕</button>' +
          '</div>' +
        '</div>' +
        '<div id="ai-assistant-context">' +
          '<div id="ai-context-header" onclick="_toggleContext()">' +
            '<span>📋 Question</span>' +
            '<span class="collapse-arrow">▾</span>' +
          '</div>' +
          '<div id="ai-context-body"></div>' +
        '</div>' +
        '<div id="ai-chat-area" class="ai-chat-area" dir="auto"></div>' +
        '<div id="ai-chat-error"></div>' +
        '<div id="ai-input-wrap">' +
          '<textarea id="ai-input" dir="auto" placeholder="Ask anything about this question..." rows="1"></textarea>' +
          '<button id="ai-send-btn">Ask</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);

    _$('ai-close-btn').addEventListener('click', _closeAssistant);
    _$('ai-settings-gear').addEventListener('click', _openSettings);
    _$('ai-send-btn').addEventListener('click', _sendQuestion);
    _$('ai-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _sendQuestion();
      }
    });
    div.addEventListener('click', function (e) {
      if (e.target === div) _closeAssistant();
    });
  }

  function _appendChatMsg(role, text) {
    var chatArea = _$('ai-chat-area');
    if (!chatArea) return;

    // Remove loading indicator if present
    var loadingEl = _$('ai-thinking-msg');
    if (loadingEl) loadingEl.remove();

    _chatHistory.push({ role: role, text: text });

    var div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'user' ? 'user-msg' : 'ai-msg');
    div.innerHTML = '<div class="msg-label">' + (role === 'user' ? 'You' : 'AI') + '</div><div class="msg-body" dir="auto">' + _renderMarkdown(text) + '</div>';
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function _showThinking() {
    var chatArea = _$('ai-chat-area');
    if (!chatArea) return;
    var loadingEl = document.createElement('div');
    loadingEl.className = 'chat-msg ai-msg';
    loadingEl.id = 'ai-thinking-msg';
    loadingEl.innerHTML = '<div class="msg-label">AI</div><div class="thinking-indicator"><span></span><span></span><span></span></div>';
    chatArea.appendChild(loadingEl);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function _toggleContext() {
    var body = _$('ai-context-body');
    var arrow = document.querySelector('#ai-context-header .collapse-arrow');
    if (!body || !arrow) return;
    body.className = body.className === 'open' ? '' : 'open';
    arrow.className = 'collapse-arrow' + (body.className === 'open' ? ' open' : '');
  }

  function _openAssistant(questionObj) {
    if (!questionObj) return;
    _currentQuestion = questionObj;
    _chatHistory = [];
    _renderAssistantHTML();

    // Populate question context (collapsed by default)
    var ctx = _$('ai-context-body');
    var keys = ['A','B','C','D','E','F','G','H'];
    var html = '<div class="q-label" dir="auto">' + _escapeHtml(questionObj.question || '') + '</div>';
    if (questionObj.options && Array.isArray(questionObj.options)) {
      questionObj.options.forEach(function (opt, i) {
        var chk = '';
        if (typeof questionObj.correct === 'number' && i === questionObj.correct) chk = ' ✓';
        html += '<div class="opt-line" dir="auto">' + (keys[i] || i) + '. ' + _escapeHtml(opt) + chk + '</div>';
      });
    }
    ctx.innerHTML = html;

    // Welcome message
    var chatArea = _$('ai-chat-area');
    chatArea.innerHTML =
      '<div class="chat-msg ai-msg">' +
        '<div class="msg-label">AI</div>' +
        '<div class="msg-body" dir="auto">' + _renderMarkdown('Hi! Ask me anything about this question — I can explain concepts, clarify why an answer is right or wrong, or dive deeper into any topic.') +
        '</div>' +
      '</div>';

    _$('ai-input').value = '';
    _$('ai-chat-error').className = '';
    _$('ai-chat-error').textContent = '';
    _$('ai-send-btn').disabled = false;

    _$('ai-assistant-overlay').className = 'open';
    setTimeout(function () { _$('ai-input').focus(); }, 150);
  }

  function _closeAssistant() {
    var overlay = _$('ai-assistant-overlay');
    if (overlay) overlay.className = '';
    _currentQuestion = null;
    _chatHistory = [];
  }

  function _sendQuestion() {
    var input = _$('ai-input');
    var question = (input.value || '').trim();
    if (!question) { showToast('Please type a question.'); return; }

    var apiKey = _readKey();
    if (!apiKey) {
      showToast('⚠ Configure your Gemini API key in AI Settings');
      _openSettings();
      return;
    }

    // ── System prompt: fixed AI persona (never changes per question) ─
    // Separated from user content so the AI listens better to what the
    // user actually asked, not the surrounding instruction scaffolding.
    var systemPrompt = _buildSysPrompt();

    // ── Build conversation contents ──────────────────────────────
    var contents = _chatHistory.map(function (msg) {
      return { role: msg.role, parts: [{ text: msg.text }] };
    });
    // Always include the current question in context so the AI never loses
    // sight of the question details, even after multiple follow-up turns.
    contents.push({ role: 'user', parts: [{ text: _buildUserPrompt(_currentQuestion, question) }] });

    var model = _getSavedModel();
    if (!modelIsAvailable(model)) model = MODELS[0][0];
    var attempts = buildGeminiAttempts(model);

    var sendBtn = _$('ai-send-btn');
    var errorEl = _$('ai-chat-error');

    // Append user message to UI + history
    _appendChatMsg('user', question);
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;
    errorEl.className = '';
    errorEl.textContent = '';
    _showThinking();

    tryGeminiChatRequests(systemPrompt, contents, apiKey, attempts)
      .then(function (text) {
        _appendChatMsg('model', text);
      })
      .catch(function (err) {
        var thinkingEl = _$('ai-thinking-msg');
        if (thinkingEl) thinkingEl.remove();
        errorEl.className = 'show';
        errorEl.textContent = '⚠ ' + friendlyAiError(err);
      })
      .finally(function () {
        sendBtn.disabled = false;
        _$('ai-input').focus();
      });
  }

  function _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── AI Settings Sub-Modal ────────────────────────────────────── */
  function _renderSettingsHTML() {
    _injectCSS();
    if (_$('ai-settings-overlay')) return;

    var div = document.createElement('div');
    div.id = 'ai-settings-overlay';
    div.innerHTML =
      '<div id="ai-settings-modal">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">' +
          '<h3 style="margin:0">⚙ AI Settings</h3>' +
          '<button class="icon-btn" id="ai-settings-close" title="Close">✕</button>' +
        '</div>' +
        '<div class="field-box">' +
          '<label class="field-label" for="ai-key-input">Gemini API Key</label>' +
          '<div class="api-row">' +
            '<input id="ai-key-input" type="password" autocomplete="off" placeholder="Enter your Gemini API key">' +
          '</div>' +
          '<div class="field-note">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--accent)">AI Studio</a>. AI assistant requires a key.</div>' +
          '<div class="btn-row">' +
            '<button class="btn-primary" id="ai-key-save">Save</button>' +
            '<button class="btn-secondary" id="ai-key-clear">Clear</button>' +
            '<button class="btn-secondary" id="ai-key-test">Test Connection</button>' +
          '</div>' +
          '<div id="ai-settings-status" style="font-size:.8rem;margin-top:6px"></div>' +
        '</div>' +
        '<div class="field-box">' +
          '<label class="field-label" for="ai-model-select">AI Model</label>' +
          '<select id="ai-model-select" style="width:100%;padding:.5rem .7rem;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-size:.85rem"></select>' +
        '</div>' +
        '<div class="field-box">' +
          '<label class="field-label">Max Wait</label>' +
          '<div class="field-row">' +
            '<select id="ai-max-wait" style="flex:1;padding:.5rem .7rem;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-size:.85rem">' +
              '<option value="15">15 seconds</option>' +
              '<option value="30">30 seconds</option>' +
              '<option value="60">60 seconds</option>' +
              '<option value="0">No limit</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="field-box">' +
          '<label class="field-label">Retry on Failure</label>' +
          '<div class="field-row">' +
            '<select id="ai-retry-level" style="flex:1;padding:.5rem .7rem;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-size:.85rem">' +
              '<option value="fast">Fast (1 attempt)</option>' +
              '<option value="balanced">Balanced (2 attempts)</option>' +
              '<option value="thorough">Thorough (3 attempts)</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);

    // Populate model dropdown
    var modelSelect = _$('ai-model-select');
    MODELS.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m[0];
      opt.textContent = m[1];
      modelSelect.appendChild(opt);
    });

    // Load saved values
    var savedModel = _getSavedModel();
    if (modelIsAvailable(savedModel)) modelSelect.value = savedModel;

    _$('ai-key-input').value = _readKey();
    _$('ai-max-wait').value = localStorage.getItem(_SK.maxWait) || '15';
    _$('ai-retry-level').value = _getRetryLevel();

    // Bind events
    _$('ai-settings-close').addEventListener('click', _closeSettings);
    _$('ai-key-save').addEventListener('click', _saveSettingsKey);
    _$('ai-key-clear').addEventListener('click', _clearSettingsKey);
    _$('ai-key-test').addEventListener('click', _testSettingsKey);
    _$('ai-model-select').addEventListener('change', function () {
      localStorage.setItem(_SK.model, this.value);
    });
    _$('ai-max-wait').addEventListener('change', function () {
      localStorage.setItem(_SK.maxWait, this.value);
    });
    _$('ai-retry-level').addEventListener('change', function () {
      localStorage.setItem(_SK.retry, this.value);
    });
    div.addEventListener('click', function (e) {
      if (e.target === div) _closeSettings();
    });
  }

  function _openSettings() {
    _renderSettingsHTML();
    _$('ai-key-input').value = _readKey();
    _$('ai-settings-status').textContent = '';
    _$('ai-settings-overlay').className = 'open';
    setTimeout(function () { _$('ai-key-input').focus(); }, 100);
    // Sync current values
    var savedModel = _getSavedModel();
    var ms = _$('ai-model-select');
    if (modelIsAvailable(savedModel)) ms.value = savedModel;
    _$('ai-max-wait').value = localStorage.getItem(_SK.maxWait) || '15';
    _$('ai-retry-level').value = _getRetryLevel();
  }

  function _closeSettings() {
    var overlay = _$('ai-settings-overlay');
    if (overlay) overlay.className = '';
  }

  function _saveSettingsKey() {
    var value = (_$('ai-key-input').value || '').trim();
    _writeKey(value || '');
    showToast(value ? 'API key saved.' : 'API key cleared.');
    _closeSettings();
  }

  function _clearSettingsKey() {
    _writeKey('');
    _$('ai-key-input').value = '';
    _$('ai-settings-status').textContent = '';
    showToast('API key cleared.');
    _closeSettings();
  }

  function _testSettingsKey() {
    var value = (_$('ai-key-input').value || '').trim();
    if (!value) {
      _$('ai-settings-status').textContent = '✗ No key entered.';
      return;
    }
    _$('ai-settings-status').textContent = 'Testing...';
    fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': value } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.models && data.models.length) {
          _$('ai-settings-status').textContent = '✓ Key is valid (' + data.models.length + ' models available).';
        } else {
          _$('ai-settings-status').textContent = '✗ Unexpected response. Check the key.';
        }
      })
      .catch(function () {
        _$('ai-settings-status').textContent = '✗ Connection failed. Check key or network.';
      });
  }

  /* ── Study Notes ──────────────────────────────────────────────── */
  var _notesGenerated = false;
  var _notesRendered = false;

  function maybeRenderNotesCard(questions, answers) {
    if (!_hasApiKey()) return;

    _injectCSS();
    var container = _$('study-notes-placeholder');
    if (!container) return;

    var wrongResult = _buildNotesPrompt(questions, answers);
    if (!wrongResult || wrongResult.count === 0) return;

    container.innerHTML =
      '<div id="study-notes-card">' +
        '<div id="study-notes-header">' +
          '<span>📚 Study Notes <span style="font-weight:400;font-size:.75rem;color:var(--text-muted);margin-left:.5rem">(' + wrongResult.count + ' mistakes)</span></span>' +
          '<span class="arrow" id="notes-arrow">▼</span>' +
        '</div>' +
        '<div id="study-notes-body">' +
          '<div class="notes-loading" id="notes-loading"><div class="spinner"></div><span>Generating study notes...</span></div>' +
          '<div class="notes-error" id="notes-error" style="display:none"></div>' +
          '<div class="notes-content" id="notes-content"></div>' +
        '</div>' +
      '</div>';

    _notesGenerated = false;
    _notesRendered = false;

    _$('study-notes-header').addEventListener('click', function () {
      var body = _$('study-notes-body');
      var arrow = _$('notes-arrow');
      if (body.className === 'open') {
        body.className = '';
        arrow.className = 'arrow';
        return;
      }
      body.className = 'open';
      arrow.className = 'arrow open';
      if (!_notesGenerated) {
        _generateNotes(questions, answers);
      }
    });
  }

  var _notesQuestions = null;
  var _notesAnswers = null;

  function _generateNotes(questions, answers) {
    if (!_hasApiKey()) return;
    _notesGenerated = true;
    _notesQuestions = questions;
    _notesAnswers = answers;

    var wrongResult = _buildNotesPrompt(questions, answers);
    if (!wrongResult) return;

    var apiKey = _readKey();
    var model = _getSavedModel();
    if (!modelIsAvailable(model)) model = MODELS[0][0];
    var attempts = buildGeminiAttempts(model);

    _$('notes-loading').style.display = 'flex';
    _$('notes-error').style.display = 'none';
    _$('notes-content').innerHTML = '';

    tryGeminiRequests('You are a medical education tutor. Create concise study notes.', wrongResult.prompt, apiKey, attempts)
      .then(function (text) {
        _$('notes-loading').style.display = 'none';
        _$('notes-content').innerHTML = _renderMarkdown(text);
        _$('notes-content').setAttribute('dir', 'auto');
        // Add regenerate button
        var regenBtn = document.createElement('button');
        regenBtn.className = 'regenerate-btn';
        regenBtn.textContent = '🔄 Regenerate';
        regenBtn.addEventListener('click', function () {
          _notesGenerated = false;
          _generateNotes(_notesQuestions, _notesAnswers);
        });
        _$('notes-content').appendChild(regenBtn);
      })
      .catch(function (err) {
        _$('notes-loading').style.display = 'none';
        _$('notes-error').style.display = 'block';
        _$('notes-error').innerHTML = '⚠ ' + _escapeHtml(friendlyAiError(err)) + ' <span class="retry-btn" id="notes-retry-btn">Retry</span>';
        _$('notes-retry-btn').addEventListener('click', function () {
          _notesGenerated = false;
          _generateNotes(_notesQuestions, _notesAnswers);
        });
      });
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.AiAssistant = {
    openAssistant: _openAssistant,
    maybeRenderNotesCard: maybeRenderNotesCard,
    hasApiKey: _hasApiKey,
    openSettings: _openSettings
  };

})();
