/* ================================================================
   bank-engine.js  —  Shared engine for all question-bank files.
   Load this after defining BANK_CONFIG and QUESTION_BANK globals.
   ================================================================ */
(function () {
  'use strict';

  /* ── Compute base path from our own script URL ──────────────── */
  var ENGINE_BASE = EngineShared.ENGINE_BASE || (window.__QUIZ_ENGINE_BASE || '');

  // Bridge EngineShared functions to global scope for onclick="" attributes in template
  window.toggleTheme = EngineShared.toggleTheme;
  window.navigateToIndex = EngineShared.navigateToIndex;
  window.updateThemeIcon = EngineShared.updateThemeIcon;

  /* ── Inject CSS (bank-specific overrides) ────────────────────── */
  var _style = document.createElement('style');
  _style.textContent = `
.theme-btn-fixed {
  position: fixed;
  top: 1.1rem;
  right: 1.25rem;
  width: 36px; height: 36px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted);
  transition: all var(--transition);
  font-size: 1rem;
  z-index: 10;
}
.theme-btn-fixed:hover { color: var(--text); border-color: var(--accent); }

#start-screen { padding: 1.5rem; gap: 1rem; }
.start-card h1 { text-align: center; }
.start-card .subtitle { text-align: center; }
.start-icon { width: 60px; height: 60px; font-size: 1.7rem; }

.bank-stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.65rem;
  margin-bottom: 0.75rem;
}
.bank-stat-box {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem 0.5rem;
  text-align: center;
  transition: border-color var(--transition);
}
.bank-stat-box:hover { border-color: var(--accent); }
.bank-stat-box .bsv { font-size: 1.35rem; font-weight: 700; color: var(--accent); display: block; line-height: 1; margin-bottom: 0.2rem; }
.bank-stat-box .bsl { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }

.coverage-wrap { margin-bottom: 1.25rem; }
.coverage-label { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.4rem; }
.coverage-bar { height: 6px; background: var(--surface2); border-radius: 3px; overflow: hidden; border: 1px solid var(--border); }
.coverage-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.35s ease-out; }

.order-section { margin-bottom: 1.25rem; }

.mode-section { margin-bottom: 1rem; }
.mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.mode-label { cursor: pointer; }
.mode-option {
  padding: 0.5rem;
  border-radius: var(--radius);
  border: 1.5px solid var(--border);
  background: var(--surface2);
  transition: border-color var(--transition), background var(--transition);
  text-align: center;
}
.mode-option:hover { border-color: var(--accent); }
.mode-option .mo-title { font-weight: 600; font-size: 0.8rem; }
.mode-option .mo-sub { display: none; }
.mode-selected {
  border-color: var(--accent) !important;
  background: var(--accent-dim) !important;
}

.reset-bank-btn {
  width: 100%;
  margin-top: 0.65rem;
  padding: 0.65rem;
  border-radius: var(--radius);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 500;
  transition: all var(--transition);
}
.reset-bank-btn:hover { border-color: var(--wrong); color: var(--wrong); }
`;
  document.head.appendChild(_style);

  /* ── Inject Animation System v2 ────────────────────────────── */
  var _animStyle = document.createElement('style');
  _animStyle.textContent = '/* ════════════════════════════════════════════════════════════════\n   SMOOTH ANIMATION SYSTEM  v2\n   Easing · Entrance · Hover · Press · Modal · Ripple\n════════════════════════════════════════════════════════════════ */\n\n/* ── Easing tokens ──────────────────────────────────────────── */\n:root {\n  --ease-out    : cubic-bezier(0.16, 1, 0.3, 1);\n  --ease-spring : cubic-bezier(0.34, 1.56, 0.64, 1);\n  --ease-in-out : cubic-bezier(0.65, 0, 0.35, 1);\n  --transition  : 0.22s cubic-bezier(0.16, 1, 0.3, 1);\n}\n\n/* ── Screen transitions ────────────────────────────────────── */\n@keyframes screenFadeIn {\n  from { opacity: 0; }\n  to   { opacity: 1; }\n}\n\n/* ── Start screen entrance ─────────────────────────────────── */\n@keyframes slideDown {\n  from { opacity: 0; transform: translateY(-18px); }\n  to   { opacity: 1; transform: translateY(0); }\n}\n@keyframes fadeUp {\n  from { opacity: 0; transform: translateY(24px); }\n  to   { opacity: 1; transform: translateY(0); }\n}\n@keyframes iconPop {\n  0%   { transform: scale(0.7) rotate(-8deg); opacity: 0; }\n  60%  { transform: scale(1.15) rotate(4deg); }\n  100% { transform: scale(1)    rotate(0deg); opacity: 1; }\n}\n\n.topbar { animation: slideDown 0.45s var(--ease-out) both; }\n#start-screen .start-card { animation: fadeUp 0.55s 0.1s var(--ease-out) both; }\n#start-screen .start-icon { animation: iconPop 0.5s 0.2s var(--ease-spring) both; }\n\n/* ── Card hover effects ────────────────────────────────────── */\n.start-card {\n  transition:\n    transform      0.32s var(--ease-out),\n    box-shadow     0.32s var(--ease-out),\n    border-color   0.28s var(--ease-out) !important;\n}\n.start-card:hover {\n  transform   : translateY(-5px) scale(1.008);\n  box-shadow  : 0 16px 40px rgba(0,0,0,0.45);\n}\n\n.start-icon {\n  transition: transform 0.35s var(--ease-spring) !important;\n}\n.start-card:hover .start-icon {\n  transform : scale(1.08) rotate(-4deg);\n}\n\n/* ── Button effects ─────────────────────────────────────────── */\n.btn-start, .btn-nav, .btn-restart {\n  position  : relative;\n  overflow  : hidden;\n  transition:\n    opacity    0.22s var(--ease-out),\n    transform  0.22s var(--ease-out),\n    box-shadow 0.22s var(--ease-out) !important;\n}\n.btn-start:hover, .btn-nav.primary:hover, .btn-restart:hover {\n  opacity   : 0.92 !important;\n  transform : translateY(-2px) !important;\n  box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 40%, transparent);\n}\n.btn-start:active, .btn-nav:active, .btn-restart:active {\n  transform : scale(0.97) translateY(0px) !important;\n  transition-duration: 0.09s !important;\n}\n\n/* ── Ripple wave ────────────────────────────────────────────── */\n@keyframes ripple {\n  to { transform: scale(5); opacity: 0; }\n}\n.ripple-wave {\n  position      : absolute;\n  border-radius : 50%;\n  width         : 60px;\n  height        : 60px;\n  margin-top    : -30px;\n  margin-left   : -30px;\n  background    : rgba(255, 255, 255, 0.22);\n  transform     : scale(0);\n  animation     : ripple 0.55s var(--ease-out) forwards;\n  pointer-events: none;\n}\n\n/* ── Icon buttons ───────────────────────────────────────────── */\n.icon-btn, .hub-back-btn, .theme-btn-fixed {\n  transition: all 0.22s var(--ease-out) !important;\n}\n.hub-back-btn:hover, .theme-btn-fixed:hover {\n  transform: translateY(-1px);\n  color: var(--text) !important;\n  border-color: var(--accent) !important;\n}\n.icon-btn:active, .hub-back-btn:active, .theme-btn-fixed:active {\n  transform      : scale(0.87) !important;\n  transition-duration: 0.08s !important;\n}\n\n/* ── Theme toggle spin ──────────────────────────────────────── */\n@keyframes spinPop {\n  0%   { transform: rotate(0deg)   scale(1);    }\n  40%  { transform: rotate(200deg) scale(0.85); }\n  70%  { transform: rotate(320deg) scale(1.1);  }\n  100% { transform: rotate(360deg) scale(1);    }\n}\n.theme-spinning {\n  animation: spinPop 0.5s var(--ease-spring) forwards !important;\n}\n\n/* ── Option hover effects ───────────────────────────────────── */\n.option-label {\n  transition:\n    transform    0.2s var(--ease-out),\n    border-color 0.2s var(--ease-out),\n    background   0.2s var(--ease-out) !important;\n}\n.option-label:hover {\n  transform   : translateX(4px);\n  border-color: var(--accent) !important;\n}\n\n/* ── Nav button effects ─────────────────────────────────────── */\n.nav-btn {\n  transition:\n    transform    0.15s var(--ease-out),\n    border-color 0.2s var(--ease-out),\n    background   0.2s var(--ease-out) !important;\n}\n.nav-btn:hover {\n  transform   : scale(1.08);\n  border-color: var(--accent) !important;\n}\n.nav-btn:active {\n  transform      : scale(0.95) !important;\n  transition-duration: 0.08s !important;\n}\n\n/* ── Flag button pulse ──────────────────────────────────────── */\n@keyframes badgePulse {\n  0%   { transform: scale(1);    }\n  50%  { transform: scale(1.15); }\n  100% { transform: scale(1);    }\n}\n.flag-btn.active svg {\n  animation: badgePulse 0.4s var(--ease-spring);\n}\n\n/* ── Modal effects ──────────────────────────────────────────── */\n.modal-overlay {\n  transition: opacity 0.25s var(--ease-out) !important;\n}\n.modal {\n  animation: modalIn 0.38s var(--ease-spring) both !important;\n}\n@keyframes modalIn {\n  from { opacity: 0; transform: translateY(28px) scale(0.93); }\n  to   { opacity: 1; transform: translateY(0)    scale(1);    }\n}\n\n/* ── Result item animations ─────────────────────────────────── */\n.result-item {\n  animation: fadeUp 0.4s var(--ease-out) both;\n}\n.result-item:nth-child(1) { animation-delay: 0.05s; }\n.result-item:nth-child(2) { animation-delay: 0.1s; }\n.result-item:nth-child(3) { animation-delay: 0.15s; }\n.result-item:nth-child(4) { animation-delay: 0.2s; }\n.result-item:nth-child(5) { animation-delay: 0.25s; }\n.result-item:nth-child(n+6) { animation-delay: 0.3s; }\n\n/* ── Stat box hover ─────────────────────────────────────────── */\n.bank-stat-box, .meta-item {\n  transition:\n    transform    0.2s var(--ease-out),\n    border-color 0.2s var(--ease-out) !important;\n}\n.bank-stat-box:hover, .meta-item:hover {\n  transform   : translateY(-2px);\n  border-color: var(--accent) !important;\n}\n\n/* ── Timer warning pulse ────────────────────────────────────── */\n@keyframes pulse {\n  0%, 100% { opacity: 1; }\n  50%      { opacity: 0.6; }\n}\n\n/* ── Respect prefers-reduced-motion ─────────────────────────── */\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration  : 0.01ms !important;\n    animation-delay     : 0ms    !important;\n    transition-duration : 0.01ms !important;\n  }\n}';
  document.head.appendChild(_animStyle);

  document.body.innerHTML = `
<!-- ═══════════════════════════ START SCREEN ═══════════════════════════ -->
<div id="start-screen" class="screen active">
  <a href="#" class="hub-back-btn" onclick="navigateToIndex(event); return false;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
    Back to Hub
  </a>
  <button class="theme-btn-fixed theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme">☀</button>

  <div class="start-card">
<div class="start-icon" id="start-icon">🗃️</div>
    <h1 id="bank-title">Question Bank</h1>
    <p class="subtitle" id="bank-subtitle">A smart question bank that shows you fresh questions every session.</p>

    <!-- Coverage stats -->
    <div class="bank-stats-row">
      <div class="bank-stat-box">
        <span class="bsv" id="stat-covered">0</span>
        <span class="bsl">Covered</span>
      </div>
      <div class="bank-stat-box">
        <span class="bsv" id="stat-total">0</span>
        <span class="bsl">In Bank</span>
      </div>
      <div class="bank-stat-box">
        <span class="bsv" id="stat-sessions">0</span>
        <span class="bsl">Sessions</span>
      </div>
    </div>

    <!-- Coverage bar -->
    <div class="coverage-wrap">
      <div class="coverage-label">
        <span>Bank Coverage</span>
        <span id="coverage-pct">0%</span>
      </div>
      <div class="coverage-bar">
        <div class="coverage-fill" id="coverage-fill" style="width: 0%"></div>
      </div>
    </div>

    <!-- Question count -->
    <div class="q-count-section">
      <div class="section-label">Number of Questions <span style="color:var(--text-muted);font-size:0.75rem;font-weight:400;margin-left:0.35rem">(qs)</span></div>
      <div class="time-controls">
        <button class="time-adj-btn" onclick="adjustCount(-5)">−5</button>
        <input type="number" id="q-count-input" class="time-input" min="1" value="20" oninput="onCustomCount(this.value)">
        <button class="time-adj-btn" onclick="adjustCount(5)">+5</button>
      </div>
    </div>

    <!-- Time selector (exam mode only) -->
    <div class="time-section" id="time-section">
      <div class="section-label">Time Limit <span style="color:var(--text-muted);font-size:0.75rem;font-weight:400;margin-left:0.35rem">(min)</span></div>
      <div class="time-controls">
        <button class="time-adj-btn" onclick="adjustTime(-5)">−5</button>
        <input type="number" id="time-input" class="time-input" min="1" max="300" value="30">
        <button class="time-adj-btn" onclick="adjustTime(5)">+5</button>
      </div>
    </div>

    <!-- Mode selection -->
    <div class="mode-section">

      <div class="mode-grid">
        <label class="mode-label">
          <input type="radio" name="quiz-mode" value="exam" checked>
          <div class="mode-option mode-selected">
            <div class="mo-title">📝 Exam Mode</div>
          </div>
        </label>
        <label class="mode-label">
          <input type="radio" name="quiz-mode" value="learning">
          <div class="mode-option">
            <div class="mo-title">📚 Learning Mode</div>
          </div>
        </label>
      </div>
    </div>

    <!-- Question order -->
    <div class="order-section">
      <div class="section-label">Question Order</div>
      <div class="mode-grid">
        <label class="mode-label">
          <input type="radio" name="quiz-order" value="sequential" checked>
          <div class="mode-option mode-order-selected">
            <div class="mo-title">📋 Sequential</div>
          </div>
        </label>
        <label class="mode-label">
          <input type="radio" name="quiz-order" value="random">
          <div class="mode-option">
            <div class="mo-title">🔀 Random</div>
          </div>
        </label>
      </div>
    </div>

    <button class="btn-start" onclick="startQuiz()">Start Session →</button>
    <button class="reset-bank-btn" onclick="resetBankProgress()">🗑 Reset Bank Progress</button>
  </div>
</div>

<!-- ═══════════════════════════ QUIZ SCREEN ═══════════════════════════ -->
<div id="quiz-screen" class="screen">
  <div class="topbar">
    <div class="topbar-title" id="topbar-title">Question Bank</div>
    <div class="timer-wrap" id="timer-display">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span id="timer-text">00:00</span>
    </div>
    <div class="topbar-actions">
      <div class="icon-btn hl-mode-btn" role="button" tabindex="0" onclick="toggleHighlighterMode()" title="Highlighter Mode (H)">🖍<span class="hl-last-dot" style="background:rgba(255,213,79,0.8);"></span><div class="hl-color-picker" id="hl-color-picker-1"><button class="hl-color-btn cb-1 selected" onclick="hlSelectColor(1); event.stopPropagation();" title="Yellow (1)"></button><button class="hl-color-btn cb-2" onclick="hlSelectColor(2); event.stopPropagation();" title="Green (2)"></button><button class="hl-color-btn cb-3" onclick="hlSelectColor(3); event.stopPropagation();" title="Blue (3)"></button><button class="hl-color-btn cb-4" onclick="hlSelectColor(4); event.stopPropagation();" title="Red (4)"></button><button class="hl-erase-btn" onclick="hlSelectColor(0); event.stopPropagation();" title="Eraser">🧹</button><button class="hl-close-btn" onclick="disableHighlighterMode(); event.stopPropagation();" title="Close Highlighter">✕</button></div></div>
      <button class="icon-btn" onclick="openAiAssistant()" title="Ask AI (needs internet)">🤖</button>
      <a href="#" class="icon-btn" title="Back to Hub" onclick="navigateToIndex(event); return false;">🏠</a>
      <button class="icon-btn theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme">☀</button>
      <button class="icon-btn danger" onclick="confirmResetProgress()" title="Reset Progress">↻</button>
    </div>
  </div>
  <div class="progress-bar-wrap">
    <div class="progress-bar-fill" id="progress-fill" style="width:0%"></div>
  </div>
  <div class="quiz-body">
    <div class="question-area" id="question-area"></div>
    <div class="nav-pane" id="nav-pane">
      <div class="nav-pane-header">
        <h3>Navigation</h3>
        <div class="legend">
          <div class="legend-item"><div class="dot current"></div> Current</div>
          <div class="legend-item"><div class="dot answered"></div> <span id="legend-text-answered">Answered</span></div>
          <div class="legend-item" id="legend-wrong" style="display:none;"><div class="dot wrong"></div> Wrong</div>
          <div class="legend-item"><div class="dot flagged"></div> Flagged</div>
          <div class="legend-item"><div class="dot unanswered"></div> Skipped</div>
        </div>
      </div>
      <div class="nav-grid-wrap"><div class="nav-grid" id="nav-grid"></div></div>
      <div class="nav-stats">
        <div class="stat-item"><div class="sv green" id="stat-answered">0</div><div class="sl">Done</div></div>
        <div class="stat-item"><div class="sv blue"  id="stat-flagged-q">0</div><div class="sl">Flagged</div></div>
        <div class="stat-item"><div class="sv muted" id="stat-skipped">0</div><div class="sl">Skipped</div></div>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════════════ RESULTS SCREEN ═══════════════════════════ -->
<div id="result-screen" class="screen">
  <div class="result-topbar">
    <h2>📊 Session Results</h2>
    <div class="topbar-actions">
      <div class="icon-btn hl-mode-btn" role="button" tabindex="0" onclick="toggleHighlighterMode()" title="Highlighter Mode (H)">🖍<span class="hl-last-dot" style="background:rgba(255,213,79,0.8);"></span><div class="hl-color-picker" id="hl-color-picker-2"><button class="hl-color-btn cb-1 selected" onclick="hlSelectColor(1); event.stopPropagation();" title="Yellow (1)"></button><button class="hl-color-btn cb-2" onclick="hlSelectColor(2); event.stopPropagation();" title="Green (2)"></button><button class="hl-color-btn cb-3" onclick="hlSelectColor(3); event.stopPropagation();" title="Blue (3)"></button><button class="hl-color-btn cb-4" onclick="hlSelectColor(4); event.stopPropagation();" title="Red (4)"></button><button class="hl-erase-btn" onclick="hlSelectColor(0); event.stopPropagation();" title="Eraser">🧹</button><button class="hl-close-btn" onclick="disableHighlighterMode(); event.stopPropagation();" title="Close Highlighter">✕</button></div></div>
      <button class="icon-btn" onclick="openAiAssistant()" title="Ask AI (needs internet)">🤖</button>
      <a href="#" class="icon-btn" title="Back to Hub" onclick="navigateToIndex(event); return false;">🏠</a>
      <button class="icon-btn theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme">☀</button>
    </div>
  </div>
  <div class="result-body">
    <div class="score-banner">
      <div class="score-circle">
        <div class="pct" id="res-pct">0%</div>
        <div class="lbl">Score</div>
      </div>
      <div class="score-details">
        <h3 id="res-grade">Loading…</h3>
        <div class="score-grid">
          <div class="score-stat"><div class="n green" id="res-correct">0</div><div class="t">Correct</div></div>
          <div class="score-stat"><div class="n red"   id="res-wrong">0</div><div class="t">Wrong</div></div>
          <div class="score-stat"><div class="n blue"  id="res-flagged">0</div><div class="t">Flagged</div></div>
          <div class="score-stat"><div class="n muted" id="res-skipped">0</div><div class="t">Skipped</div></div>
          <div class="score-stat"><div class="n" id="res-time">—</div><div class="t">Time Used</div></div>
        </div>
      </div>
    </div>

    <!-- PDF Export Section -->
    <div class="pdf-export-section">
      <div class="export-options">
        <label class="export-option">
          <input type="checkbox" name="export-all" checked onchange="onExportFilterChange(this)">
          <span class="export-checkbox-visual">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="export-label">All</span>
          <span class="export-badge" id="badge-all">0</span>
        </label>
        <label class="export-option">
          <input type="checkbox" name="export-wrong" onchange="onExportFilterChange(this)">
          <span class="export-checkbox-visual">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="export-label">Wrong</span>
          <span class="export-badge" id="badge-wrong">0</span>
        </label>
        <label class="export-option">
          <input type="checkbox" name="export-flagged" onchange="onExportFilterChange(this)">
          <span class="export-checkbox-visual">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="export-label">Flagged</span>
          <span class="export-badge" id="badge-flagged">0</span>
        </label>
      </div>
      <button class="btn-export-pdf" onclick="exportToPDF()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        Export to PDF
      </button>
    </div>

    <div class="result-tabs">
      <button class="tab-btn active" onclick="filterResults('all', this)">All Questions</button>
      <button class="tab-btn" onclick="filterResults('correct', this)">✓ Correct</button>
      <button class="tab-btn" onclick="filterResults('wrong', this)">✗ Wrong</button>
      <button class="tab-btn" onclick="filterResults('skipped', this)">— Skipped</button>
      <button class="tab-btn" onclick="filterResults('flagged', this)">⚑ Flagged</button>
    </div>
    <div class="result-list" id="result-list"></div>
    <div class="result-actions">
      <button class="btn-restart" onclick="onNewSessionClick(event)">↺ New Session</button>
      <a href="#" class="btn-restart btn-secondary" onclick="navigateToIndex(event); return false;">🏠 Return to Hub</a>
    </div>
  </div>
</div>

<!-- Modal -->
<div class="modal-overlay" id="submit-modal">
  <div class="modal">
    <h3>Submit Quiz?</h3>
    <p>You have <span class="modal-unanswered" id="modal-unanswered">—</span> unanswered question(s). Are you sure?</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Go Back</button>
      <button class="btn-confirm" onclick="confirmSubmit()">Submit Now</button>
    </div>
  </div>
</div>

<!-- Reset Confirm Modal -->
<div class="modal-overlay" id="reset-modal">
  <div class="modal">
    <h3>Reset Progress?</h3>
    <p>Are you sure you want to reset your progress? This cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeResetModal()">Go Back</button>
      <button class="btn-confirm danger" onclick="confirmResetAction()">Reset Now</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<!-- ════════════════════════════════════════════════════════════════
     ▼ BANK CONFIGURATION — Edit below
═══════════════════════════════════════════════════════════════════ -->`;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(ENGINE_BASE + 'sw.js').catch(function () {});
    });
  }
})();

/* ================================================================
   BANK ENGINE
   ================================================================ */
/* ══════════════════════════════════════════════════
   QUESTION BANK ENGINE
══════════════════════════════════════════════════ */
const KEYS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];

// Session questions (selected subset from bank for this session)
let SESSION_QUESTIONS = [];
// Bank indices corresponding to SESSION_QUESTIONS — saved so restore skips re-selection
let SESSION_QUESTION_INDICES = [];
// Set to true after initUI() completes — prevents adjustCount/setCount/onCustomCount
// from wiping saved progress during page initialisation
let uiReady = false;

// Quiz state
let state = {
  current:   0,
  answers:   {},
  flagged:   {},
  highlights: {},  // { qIndex: [ { part, start, end, color, optIndex? } ] } — uses GLOBAL bank index
  strikethrough: {}, // { qIndex: { optIndex: true } } — uses GLOBAL bank index
  isHighlighterMode: false,
  timerSecs: 0,
  elapsed:   0,
  timerID:   null,
  submitted: false,
  mode:      'exam',
};
let timerPaused = false;
let lastTime = Date.now();
let _hlCache = {};           // memoized highlight state per qIndex
let _hlLastColor = 1;        // last selected highlight color (1-4), default Yellow
let _hlPickerOpen = false;   // color picker dropdown open state
let _hoveredOption = -1;     // option index currently hovered (-1 = none)
let _ctxStrikeDone = false;  // flag to prevent double-toggle (mousedown + contextmenu)
let submitTimeout = null;  // tracks the setTimeout(confirmSubmit) from timer expiry

/* ════════════════════════════════════════════════════════════════
   HIGHLIGHT & STRIKETHROUGH SYSTEM
   NOTE: qIndex in highlights/strikethrough uses GLOBAL bank index
   (SESSION_QUESTION_INDICES[sessionIdx]) so highlights persist
   across different randomized sessions.
════════════════════════════════════════════════════════════════ */

function _hlGlobalIdx(sessionIdx) {
  return SESSION_QUESTION_INDICES[sessionIdx];
}

/* ── HIGHLIGHTER MODE TOGGLE ───────────────────────────────── */
var _hlInitialized = false;  // lazy-load guard: listeners registered once

// Lazy-init: register all highlighter event listeners on first activation
function _hlInit() {
  if (_hlInitialized) return;
  _hlInitialized = true;

  /* ── SMART LABEL CLICK HANDLING ──────── */
  document.addEventListener('click', function(e) {
    if (!state.isHighlighterMode || state.submitted) return;
    var optLabel = e.target.closest('.option-label');
    if (!optLabel) return;
    if (e.target.closest('input[type=radio]')) return;
    if (_hlJustApplied) {
      e.preventDefault();
      e.stopPropagation();
      _hlJustApplied = false;
      return;
    }
  }, true);

  /* ── AUTO-HIGHLIGHT: MOUSE-UP + TOUCH-END + SELECTION-CHANGE ─ */
  // Desktop: mouseup triggers auto-highlight
  document.addEventListener('mouseup', function(e) {
    if (e.button !== 0) return;
    if (!state.isHighlighterMode || state.submitted) return;
    clearTimeout(_hlSelectionTimer);
    _hlSelectionTimer = setTimeout(_hlAutoApply, 50);
  });

  // selectionchange backup (long debounce — only fires after user pauses/stops)
  document.addEventListener('selectionchange', function() {
    if (!state.isHighlighterMode || state.submitted) return;
    clearTimeout(_hlSelectionTimer);
    _hlSelectionTimer = setTimeout(_hlAutoApply, 600);
  });

  // Touch: apply after finger lifts — give browser time to finalize selection
  document.addEventListener('touchend', function(e) {
    if (!state.isHighlighterMode || state.submitted) return;
    clearTimeout(_hlSelectionTimer);
    _hlSelectionTimer = setTimeout(_hlAutoApply, 150);
  });

  /* ── RIGHT-CLICK / LONG-PRESS: DIRECT STRIKETHROUGH ──────── */
  document.addEventListener('mousedown', function(e) {
    _ctxStrikeDone = false;
    if (_hlPickerOpen) {
      var isPickerClick = e.target.closest('.hl-color-picker') || e.target.closest('.hl-mode-btn');
      if (!isPickerClick) _closeAllPickers();
    }
    if (e.button === 2 && state.isHighlighterMode && !state.submitted) {
      var optLabel = e.target.closest('.option-label');
      if (optLabel && optLabel.dataset.optIdx !== undefined) {
        e.preventDefault();
        _ctxStrikeDone = true;
        toggleStrikethrough(state.current, parseInt(optLabel.dataset.optIdx));
      }
    }
  });

  document.addEventListener('contextmenu', function(e) {
    if (!state.isHighlighterMode || state.submitted) return;
    e.preventDefault();
    if (_ctxStrikeDone) { _ctxStrikeDone = false; return; }
    var optLabel = e.target.closest('.option-label');
    if (optLabel && optLabel.dataset.optIdx !== undefined) {
      toggleStrikethrough(state.current, parseInt(optLabel.dataset.optIdx));
    }
  });

  /* ── TRACK HOVERED OPTION FOR S KEY ──────────────────────── */
  document.addEventListener('mouseover', function(e) {
    var optLabel = e.target.closest('.option-label');
    if (optLabel && optLabel.dataset.optIdx !== undefined) {
      _hoveredOption = parseInt(optLabel.dataset.optIdx);
      return;
    }
    _hoveredOption = -1;
  });
  document.addEventListener('mouseout', function(e) {
    var optLabel = e.target.closest('.option-label');
    if (optLabel) _hoveredOption = -1;
  });
}

// First click on highlighter button → activate mode
// Subsequent clicks while active → toggle color picker (NOT deactivate)
// Click ✕ in picker → deactivate
function toggleHighlighterMode() {
  if (!state.isHighlighterMode) {
    _hlInit();
    state.isHighlighterMode = true;
    document.body.classList.add('highlighter-active');
    document.querySelectorAll('.hl-mode-btn').forEach(function(b) {
      b.classList.add('active');
    });
    if (!state.submitted) renderQuestion(state.current);
    EngineShared.showToast('🖍 Highlighter ON');
  } else {
    _togglePicker();
  }
}

// Explicitly disable highlighter mode (called by ✕ close button)
function disableHighlighterMode() {
  if (!state.isHighlighterMode) return;
  state.isHighlighterMode = false;
  document.body.classList.remove('highlighter-active');
  document.querySelectorAll('.hl-mode-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  _closeAllPickers();
  if (!state.submitted) renderQuestion(state.current);
  EngineShared.showToast('Highlighter OFF');
}

// Toggle color picker visibility
function _togglePicker() {
  var anyVisible = false;
  document.querySelectorAll('.hl-color-picker').forEach(function(p) {
    if (p.classList.contains('visible')) anyVisible = true;
  });
  if (anyVisible) {
    _closeAllPickers();
  } else {
    document.querySelectorAll('.hl-color-picker').forEach(function(p) {
      p.classList.add('visible');
    });
    _hlPickerOpen = true;
  }
}

/* ── COLOR PICKER (next to topbar icon) ────────────────────── */
function _syncPickerUI() {
  document.querySelectorAll('.hl-color-picker').forEach(function(picker) {
    picker.querySelectorAll('.hl-color-btn').forEach(function(btn) {
      var m = btn.className.match(/cb-(\d)/);
      btn.classList.toggle('selected', m && parseInt(m[1]) === _hlLastColor);
    });
  });
  var dotColors = { 1: 'rgba(255,213,79,0.8)', 2: 'rgba(129,199,132,0.8)', 3: 'rgba(100,181,246,0.8)', 4: 'rgba(239,154,154,0.8)' };
  document.querySelectorAll('.hl-mode-btn .hl-last-dot').forEach(function(dot) {
    dot.style.background = dotColors[_hlLastColor] || dotColors[1];
  });
}

function hlSelectColor(colorNum) {
  if (colorNum === 0) {
    _hlLastColor = 0;
  } else {
    _hlLastColor = colorNum;
  }
  _syncPickerUI();
}

function _closeAllPickers() {
  document.querySelectorAll('.hl-color-picker').forEach(function(p) { p.classList.remove('visible'); });
  _hlPickerOpen = false;
}

/* ── SELECTION OFFSET CALCULATION (tag-aware) ──────────────── */
function _getTextOffsetRelativeTo(container, node, offset) {
  var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
  var total = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) return total + offset;
    total += walker.currentNode.textContent.length;
  }
  return -1;
}

function _getSelectionParts() {
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  var range = sel.getRangeAt(0);
  var questionArea = document.getElementById('question-area');
  if (!questionArea || !questionArea.contains(range.commonAncestorContainer)) return null;

  var part = null, optIndex = -1;
  var qText = questionArea.querySelector('.q-text');
  if (qText && qText.contains(range.commonAncestorContainer)) part = 'question';

  if (!part) {
    var optTexts = questionArea.querySelectorAll('.option-text');
    for (var i = 0; i < optTexts.length; i++) {
      if (optTexts[i].contains(range.commonAncestorContainer)) {
        part = 'option'; optIndex = i; break;
      }
    }
  }

  if (!part) {
    var expl = questionArea.querySelector('.explanation-box');
    if (expl && expl.contains(range.commonAncestorContainer)) part = 'explanation';
  }

  if (!part) return null;

  var container;
  if (part === 'question') container = qText;
  else if (part === 'option') container = questionArea.querySelectorAll('.option-text')[optIndex];
  else container = questionArea.querySelector('.explanation-box');
  if (!container) return null;

  var startOffset = _getTextOffsetRelativeTo(container, range.startContainer, range.startOffset);
  var endOffset   = _getTextOffsetRelativeTo(container, range.endContainer, range.endOffset);
  if (startOffset < 0 || endOffset < 0 || startOffset === endOffset) return null;

  return { part: part, optIndex: optIndex, start: startOffset, end: endOffset };
}

/* ── AUTO-HIGHLIGHT HELPERS ─────────────────────────────────── */
var _hlJustApplied = false;  // set true when highlight is applied, resets after 100ms
var _hlSelectionTimer = null;

// Helper: check if current selection is inside question area
function _isSelectionInQuestionArea() {
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  var questionArea = document.getElementById('question-area');
  if (!questionArea) return false;
  return questionArea.contains(sel.getRangeAt(0).commonAncestorContainer);
}

function _hlAutoApply() {
  if (!state.isHighlighterMode || state.submitted) return;
  if (!_isSelectionInQuestionArea()) return;
  _hlJustApplied = true;
  setTimeout(function() { _hlJustApplied = false; }, 100);
  if (_hlLastColor === 0) {
    hlEraseSelection();
  } else {
    hlApplyColor(_hlLastColor);
  }
}

/* ── HIGHLIGHT APPLY / ERASE (uses global bank index) ──────── */
function hlApplyColor(colorNum) {
  if (!state.isHighlighterMode) return;
  var info = _getSelectionParts();
  if (!info) { window.getSelection().removeAllRanges(); return; }
  var gIdx = _hlGlobalIdx(state.current);
  if (gIdx === undefined) { window.getSelection().removeAllRanges(); return; }
  if (!state.highlights[gIdx]) state.highlights[gIdx] = [];
  state.highlights[gIdx].push({
    part: info.part, optIndex: info.optIndex,
    start: info.start, end: info.end, color: colorNum
  });
  _hlLastColor = colorNum;
  _syncPickerUI();
  delete _hlCache[gIdx];
  window.getSelection().removeAllRanges();
  renderQuestion(state.current);
  EngineShared.debounceSave(saveProgress);
}

function hlEraseSelection() {
  if (!state.isHighlighterMode) return;
  var info = _getSelectionParts();
  if (!info) { window.getSelection().removeAllRanges(); return; }
  var gIdx = _hlGlobalIdx(state.current);
  if (gIdx === undefined) { window.getSelection().removeAllRanges(); return; }
  var hlList = state.highlights[gIdx];
  if (!hlList) { window.getSelection().removeAllRanges(); return; }
  state.highlights[gIdx] = hlList.filter(function(hl) {
    if (hl.part !== info.part) return true;
    if (hl.part === 'option' && hl.optIndex !== info.optIndex) return true;
    return !(hl.start < info.end && hl.end > info.start);
  });
  if (state.highlights[gIdx].length === 0) delete state.highlights[gIdx];
  delete _hlCache[gIdx];
  window.getSelection().removeAllRanges();
  renderQuestion(state.current);
  EngineShared.debounceSave(saveProgress);
}

function clearAllHighlights(sessionIdx) {
  var gIdx = _hlGlobalIdx(sessionIdx);
  if (gIdx !== undefined) {
    delete state.highlights[gIdx];
    delete _hlCache[gIdx];
  }
  renderQuestion(sessionIdx);
  EngineShared.debounceSave(saveProgress);
  EngineShared.showToast('Highlights cleared');
}

/* ── STRIKETHROUGH TOGGLE (uses global bank index) ─────────── */
function toggleStrikethrough(sessionIdx, optIdx) {
  var gIdx = _hlGlobalIdx(sessionIdx);
  if (gIdx === undefined) return;
  if (!state.strikethrough[gIdx]) state.strikethrough[gIdx] = {};
  state.strikethrough[gIdx][optIdx] = !state.strikethrough[gIdx][optIdx];
  if (!state.strikethrough[gIdx][optIdx]) delete state.strikethrough[gIdx][optIdx];
  renderQuestion(sessionIdx);
  EngineShared.debounceSave(saveProgress);
}

/* ── TAG-AWARE HIGHLIGHT INJECTION ─────────────────────────── */
function _applyHighlightsToHTML(html, hlList, part, optIndex) {
  var relevant = hlList.filter(function(hl) {
    if (hl.part !== part) return false;
    if (part === 'option' && hl.optIndex !== optIndex) return false;
    return true;
  });
  if (relevant.length === 0) return html;
  relevant.sort(function(a, b) { return a.start - b.start || a.end - b.end; });

  var result = [], textIdx = 0, i = 0;
  var pendingOpens = [];
  var hlQueue = relevant.slice();

  while (i < html.length) {
    if (html[i] === '<') {
      var tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) tagEnd = html.length - 1;
      result.push(html.substring(i, tagEnd + 1));
      i = tagEnd + 1;
      continue;
    }
    while (pendingOpens.length > 0 && pendingOpens[pendingOpens.length - 1].end <= textIdx) {
      result.push('</mark>');
      pendingOpens.pop();
    }
    while (hlQueue.length > 0 && hlQueue[0].start <= textIdx) {
      var hl = hlQueue.shift();
      result.push('<mark class="q-highlight hl-color-' + hl.color + '">');
      pendingOpens.push({ end: hl.end, color: hl.color });
      pendingOpens.sort(function(a, b) { return b.end - a.end; });
    }
    if (html[i] === '&') {
      var entityEnd = html.indexOf(';', i);
      if (entityEnd !== -1 && entityEnd - i < 8) {
        result.push(html.substring(i, entityEnd + 1));
        textIdx++; i = entityEnd + 1; continue;
      }
    }
    result.push(html[i]);
    textIdx++; i++;
  }
  while (pendingOpens.length > 0) { result.push('</mark>'); pendingOpens.pop(); }
  return result.join('');
}

function applyBulkHighlights(sessionIdx) {
  var gIdx = _hlGlobalIdx(sessionIdx);
  if (gIdx === undefined) return;
  if (_hlCache[gIdx]) return;
  var hlList = state.highlights[gIdx] || [];
  var stMap = state.strikethrough[gIdx] || {};
  if (hlList.length === 0 && Object.keys(stMap).length === 0) return;

  var area = document.getElementById('question-area');
  if (!area) return;

  var qText = area.querySelector('.q-text');
  if (qText && hlList.length) qText.innerHTML = _applyHighlightsToHTML(qText.innerHTML, hlList, 'question');

  var optTexts = area.querySelectorAll('.option-text');
  optTexts.forEach(function(el, i) {
    if (hlList.length) el.innerHTML = _applyHighlightsToHTML(el.innerHTML, hlList, 'option', i);
  });

  var expl = area.querySelector('.explanation-box');
  if (expl && hlList.length) expl.innerHTML = _applyHighlightsToHTML(expl.innerHTML, hlList, 'explanation');

  var optLabels = area.querySelectorAll('.option-label');
  optLabels.forEach(function(el, i) {
    if (stMap[i]) el.classList.add('strikethrough');
  });

  if (state.isHighlighterMode) {
    optLabels.forEach(function(label, i) {
      var existing = label.querySelector('.st-toggle-btn');
      if (existing) { existing.classList.toggle('active', !!stMap[i]); return; }
      var btn = document.createElement('button');
      btn.className = 'st-toggle-btn' + (stMap[i] ? ' active' : '');
      btn.title = 'Strikethrough (S)';
      btn.textContent = '✕';
      btn.onclick = (function(ci) { return function(e) { e.preventDefault(); e.stopPropagation(); toggleStrikethrough(state.current, ci); }; })(i);
      label.appendChild(btn);
    });
  }

  _hlCache[gIdx] = true;
}

/* ── PDF HIGHLIGHT HELPER ──────────────────────────────────── */
function _hlToPDFHTML(text, hlList, part) {
  var relevant = hlList.filter(function(hl) { return hl.part === part; });
  if (relevant.length === 0) return text;
  relevant.sort(function(a, b) { return a.start - b.start; });
  var pdfColors = { 1: '#ffd54f', 2: '#81c784', 3: '#64b5f6', 4: '#ef9a9a' };
  var result = '', last = 0;
  relevant.forEach(function(hl) {
    if (hl.start > last) result += text.substring(last, hl.start);
    result += '<span style="background:' + (pdfColors[hl.color] || '#ffd54f') + ';border-radius:2px;padding:0 2px;">';
    result += text.substring(Math.max(last, hl.start), hl.end);
    result += '</span>';
    last = hl.end;
  });
  if (last < text.length) result += text.substring(last);
  return result;
}

// Start screen config
let selectedCount = 20;

/* ─── SESSION PROGRESS STORAGE ─────────────────────────────────────
   Tracks quiz session progress (answers, flags, timer) across page reloads.
──────────────────────────────────────────────────────────────── */
const STORAGE_VERSION = 'v1';
const STORAGE_KEY = `quiz_progress_${STORAGE_VERSION}_${(BANK_CONFIG.uid || window.location.pathname).replace(/[^a-zA-Z0-9]/g, '_')}`;
let pendingRestoreData = null;
let restoreToastTimeout = null;
let restoreScreenTimeout = null;  // tracks the setTimeout inside doRestoreProgress
let pendingTransitionTimeout = null;  // tracks screen transition timeouts to prevent race conditions

function saveProgress() {
  if (state.submitted) return;

  const hasAnswers = Object.keys(state.answers || {}).length > 0;
  const hasFlags = Object.values(state.flagged || {}).some(v => v === true);
  const hasTime = (state.elapsed || 0) > 10;
  const hasHighlights = Object.keys(state.highlights || {}).length > 0;
  const hasStrikethrough = Object.keys(state.strikethrough || {}).length > 0;
  if (!hasAnswers && !hasFlags && !hasTime && !hasHighlights && !hasStrikethrough) return;

  const saveData = {
    version: STORAGE_VERSION,
    quizTitle: BANK_CONFIG.title,
    totalQuestions: SESSION_QUESTIONS.length,
    questionCount: selectedCount,
    sessionIndices: SESSION_QUESTION_INDICES,
    current: state.current,
    answers: state.answers,
    flagged: state.flagged,
    highlights: state.highlights,
    strikethrough: state.strikethrough,
    elapsed: state.elapsed,
    timerSecs: state.timerSecs,
    mode: state.mode,
    timestamp: Date.now(),
    savedAt: Date.now()
  };

  try {
    if (!isValidSaveData(saveData)) {
      console.warn('Invalid save data, skipping save');
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      console.warn('LocalStorage quota exceeded, clearing old saves...');
      clearOldSaves();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
      } catch (retryError) {
        console.error('Failed to save progress even after cleanup:', retryError);
        EngineShared.showToast('Storage full! Clear tracker data to save progress.', [
          { label: 'Go to Menu', primary: true, onClick: EngineShared.navigateToIndex }
        ]);
      }
    } else {
      console.error('Error saving progress:', e);
    }
  }
}

function isValidSaveData(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.current !== 'number' || data.current < 0) return false;
  if (!data.answers || typeof data.answers !== 'object') return false;
  if (!data.flagged || typeof data.flagged !== 'object') return false;
  if (typeof data.timerSecs !== 'number' || data.timerSecs < 0) return false;
  if (!['exam', 'learning'].includes(data.mode)) return false;
  if (typeof data.questionCount !== 'number' || data.questionCount < 1) return false;
  if (typeof data.totalQuestions !== 'number' || data.totalQuestions < 1) return false;
  if (!Array.isArray(data.sessionIndices) || data.sessionIndices.length === 0) return false;
  if (data.sessionIndices.some(i => typeof i !== 'number' || i < 0 || i >= QUESTION_BANK.length)) return false;
  if (data.highlights && typeof data.highlights !== 'object') return false;
  if (data.strikethrough && typeof data.strikethrough !== 'object') return false;
  return true;
}

function clearOldSaves() {
  try {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('quiz_progress_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (now - data.timestamp > maxAge) localStorage.removeItem(key);
        } catch (e) { localStorage.removeItem(key); }
      }
    });
  } catch (e) { console.error('Error clearing old saves:', e); }
}

function clearProgress() {
  localStorage.removeItem(STORAGE_KEY);
}

function checkSavedProgress() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    if (data.version !== STORAGE_VERSION) { localStorage.removeItem(STORAGE_KEY); return; }
    if (data.quizTitle !== BANK_CONFIG.title) { localStorage.removeItem(STORAGE_KEY); return; }
    if (!isValidSaveData(data)) { localStorage.removeItem(STORAGE_KEY); return; }
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - data.timestamp > maxAge) { localStorage.removeItem(STORAGE_KEY); return; }
    pendingRestoreData = data;
    EngineShared.showToast("📂 Previous progress found!", [
      { label: "Restore", primary: true, onClick: function() { clearTimeout(restoreToastTimeout); doRestoreProgress(pendingRestoreData); } },
      { label: "Dismiss", primary: false, onClick: function() { clearTimeout(restoreToastTimeout); pendingRestoreData = null; clearProgress(); } }
    ]);
    restoreToastTimeout = setTimeout(function() { pendingRestoreData = null; clearProgress(); var toast = document.getElementById('toast'); if (toast) toast.classList.remove('show'); }, 15000);
  } catch(e) { console.error('Error checking saved progress:', e); localStorage.removeItem(STORAGE_KEY); }
}

function doRestoreProgress(data) {
  if (!data.savedAt) data.savedAt = data.timestamp;
  selectedCount = data.questionCount || 20;
  var inp = document.getElementById('q-count-input');
  if (inp) inp.value = selectedCount;
  SESSION_QUESTION_INDICES = data.sessionIndices;
  SESSION_QUESTIONS = data.sessionIndices.map(i => QUESTION_BANK[i]);
  for (const [qIdx, optIdx] of Object.entries(data.answers)) {
    const qIndex = parseInt(qIdx);
    if (qIndex >= 0 && qIndex < SESSION_QUESTIONS.length) {
      const optCount = SESSION_QUESTIONS[qIndex].options.length;
      if (optIdx < 0 || optIdx >= optCount) delete data.answers[qIdx];
    } else { delete data.answers[qIdx]; }
  }
  state.current = Math.min(data.current, SESSION_QUESTIONS.length - 1);
  state.answers = data.answers;
  state.flagged = data.flagged || {};
  state.highlights = data.highlights || {};
  state.strikethrough = data.strikethrough || {};
  state.elapsed = data.elapsed || 0;
  state.timerSecs = (data.mode === 'learning') ? 0 : (data.timerSecs || 0);
  state.mode = data.mode;
  state.submitted = false;
  if (restoreScreenTimeout) clearTimeout(restoreScreenTimeout);
  restoreScreenTimeout = setTimeout(function() {
    restoreScreenTimeout = null;
    document.documentElement.style.setProperty('--q-count', SESSION_QUESTIONS.length);
    document.getElementById('timer-display').classList.remove('hidden');
    showScreen('quiz-screen');
    buildNavGrid();
    updateNavGrid();
    renderQuestion(state.current);
    updateTimerDisplay();
    startTimer();
  }, 500);
}

/* ─── BANK PROGRESS STORAGE ───────────────────────────────────── */
const BANK_PROGRESS_KEY = `bank_progress_v1_${(BANK_CONFIG.uid || 'default').replace(/[^a-zA-Z0-9]/g,'_')}`;

function getBankProgress() {
  try {
    const raw = localStorage.getItem(BANK_PROGRESS_KEY);
    if (!raw) return { shownIndices: [], totalSessions: 0, cycleCount: 0 };
    const p = JSON.parse(raw);
    return {
      shownIndices:   Array.isArray(p.shownIndices)   ? p.shownIndices   : [],
      totalSessions:  typeof p.totalSessions === 'number' ? p.totalSessions : 0,
      cycleCount:     typeof p.cycleCount    === 'number' ? p.cycleCount    : 0,
    };
  } catch(e) {
    return { shownIndices: [], totalSessions: 0, cycleCount: 0 };
  }
}

function saveBankProgress(progress) {
  try {
    localStorage.setItem(BANK_PROGRESS_KEY, JSON.stringify(progress));
  } catch(e) {
    console.error('Failed to save bank progress:', e);
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      EngineShared.showToast('Storage full! Clear tracker data to save bank progress.', [
        { label: 'Go to Menu', primary: true, onClick: EngineShared.navigateToIndex }
      ]);
    }
  }
}

function resetBankProgress() {
  if (!confirm('Reset all bank progress? This will forget which questions you have already seen.')) return;
  localStorage.removeItem(BANK_PROGRESS_KEY);
  updateStartScreenStats();
  EngineShared.showToast('🔄 Bank progress reset!');
}

/* ─── QUESTION SELECTION ───────────────────────────────────── */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function selectSessionQuestions(count, order = 'sequential') {
  const bankSize = QUESTION_BANK.length;
  const progress = getBankProgress();

  const allIndices = Array.from({ length: bankSize }, (_, i) => i);
  let unshown = allIndices.filter(i => !progress.shownIndices.includes(i));

  const maxAllowed = unshown.length > 0 ? unshown.length : bankSize;
  const n = Math.min(count, maxAllowed);

  let picked;

  if (unshown.length === 0) {
    progress.cycleCount++;
    progress.shownIndices = [];
    unshown = [...allIndices];
    saveBankProgress(progress);
    EngineShared.showToast(`🎉 Full cycle complete! Starting fresh — cycle ${progress.cycleCount + 1}`);
    picked = order === 'sequential'
      ? unshown.sort((a, b) => a - b).slice(0, n)
      : shuffle(unshown).slice(0, n);
  } else {
    picked = order === 'sequential'
      ? unshown.sort((a, b) => a - b).slice(0, n)
      : shuffle(unshown).slice(0, n);
  }

  progress.shownIndices = [...new Set([...progress.shownIndices, ...picked])];
  progress.totalSessions++;
  saveBankProgress(progress);

  SESSION_QUESTION_INDICES = picked;
  return picked.map(i => QUESTION_BANK[i]);
}

function updateStartScreenStats() {
  const progress = getBankProgress();
  const bankSize = QUESTION_BANK.length;
  const covered  = progress.shownIndices.length;
  const pct      = bankSize > 0 ? Math.round(covered / bankSize * 100) : 0;
  const remaining = bankSize - covered;

  if (pct === 100 && covered > 0) {
    progress.cycleCount++;
    progress.shownIndices = [];
    saveBankProgress(progress);
    EngineShared.showToast(`🎉 Full cycle complete! Starting fresh — cycle ${progress.cycleCount + 1}`);
    const newCovered = 0;
    document.getElementById('stat-covered').textContent  = newCovered;
    document.getElementById('stat-total').textContent    = bankSize;
    document.getElementById('stat-sessions').textContent = progress.totalSessions;
    document.getElementById('coverage-fill').style.width = '0%';
    document.getElementById('coverage-pct').textContent  = '0%';
    const inp = document.getElementById('q-count-input');
    selectedCount = Math.min(selectedCount || 20, bankSize);
    inp.value = selectedCount;
    inp.max = 0;
    inp.placeholder = 0;
    const plusBtn = inp.parentElement.querySelector('.time-adj-btn:last-child');
    if (plusBtn) { plusBtn.textContent = '+5'; plusBtn.disabled = false; plusBtn.style.opacity = ''; }
    return;
  }

  document.getElementById('stat-covered').textContent  = covered;
  document.getElementById('stat-total').textContent    = bankSize;
  document.getElementById('stat-sessions').textContent = progress.totalSessions;
  document.getElementById('coverage-fill').style.width = pct + '%';
  document.getElementById('coverage-pct').textContent  = pct + '%';

  const inp = document.getElementById('q-count-input');
  const currentVal = parseInt(inp.value) || selectedCount || 20;
  const maxAllowed = remaining;
  inp.max = maxAllowed;
  inp.placeholder = maxAllowed;

  if (covered === 0) {
    selectedCount = Math.min(selectedCount || 20, bankSize);
    inp.value = selectedCount;
  } else if (currentVal > maxAllowed) {
    inp.value = maxAllowed;
    selectedCount = maxAllowed;
  }

  const plusBtn = inp.parentElement.querySelector('.time-adj-btn:last-child');
  if (plusBtn) {
    plusBtn.textContent = currentVal >= maxAllowed ? 'max' : '+5';
    plusBtn.disabled = currentVal >= maxAllowed;
    plusBtn.style.opacity = currentVal >= maxAllowed ? '0.4' : '';
  }
}

function adjustCount(delta) {
  const inp = document.getElementById('q-count-input');
  const bankSize = QUESTION_BANK.length;
  const progress = getBankProgress();
  const remaining = Math.max(1, bankSize - progress.shownIndices.length);
  const maxAllowed = remaining;

  const cur = parseInt(inp.value) || selectedCount || 20;
  const newVal = Math.max(1, Math.min(maxAllowed, cur + delta));
  inp.value = newVal;
  selectedCount = newVal;
  autoSetTime(newVal);

  const plusBtn = inp.parentElement.querySelector('.time-adj-btn:last-child');
  if (plusBtn) {
    plusBtn.textContent = newVal >= maxAllowed ? 'max' : '+5';
    plusBtn.disabled = newVal >= maxAllowed;
    plusBtn.style.opacity = newVal >= maxAllowed ? '0.4' : '';
  }

  if (uiReady) clearProgress();
}

function setCount(n) {
  const bankSize = QUESTION_BANK.length;
  const progress = getBankProgress();
  const remaining = Math.max(1, bankSize - progress.shownIndices.length);
  const maxAllowed = remaining;

  if (n === -1) n = maxAllowed;
  n = Math.max(1, Math.min(n, maxAllowed));
  selectedCount = n;

  document.getElementById('q-count-input').value = n;
  autoSetTime(n);

  const inp = document.getElementById('q-count-input');
  const plusBtn = inp.parentElement.querySelector('.time-adj-btn:last-child');
  if (plusBtn) {
    plusBtn.textContent = n >= maxAllowed ? 'max' : '+5';
    plusBtn.disabled = n >= maxAllowed;
    plusBtn.style.opacity = n >= maxAllowed ? '0.4' : '';
  }

  if (uiReady) clearProgress();
}

function onCustomCount(val) {
  const bankSize = QUESTION_BANK.length;
  const progress = getBankProgress();
  const remaining = Math.max(1, bankSize - progress.shownIndices.length);
  const maxAllowed = remaining;

  let n = parseInt(val) || 1;
  n = Math.max(1, Math.min(n, maxAllowed));
  selectedCount = n;

  const inp = document.getElementById('q-count-input');
  inp.value = n;
  autoSetTime(n);

  const plusBtn = inp.parentElement.querySelector('.time-adj-btn:last-child');
  if (plusBtn) {
    plusBtn.textContent = n >= maxAllowed ? 'max' : '+5';
    plusBtn.disabled = n >= maxAllowed;
    plusBtn.style.opacity = n >= maxAllowed ? '0.4' : '';
  }

  if (uiReady) clearProgress();
}

function autoSetTime(n) {
  const autoMins = Math.max(1, n);
  document.getElementById('time-input').value = autoMins;
}

function adjustTime(delta) {
  const inp = document.getElementById('time-input');
  const cur = parseInt(inp.value) || 10;
  inp.value = Math.max(1, Math.min(300, cur + delta));
}

/* ─── MODE SELECTION ────────────────────────────────────────── */
document.querySelectorAll('input[name="quiz-mode"]').forEach(input => {
  input.addEventListener('change', function() {
    document.querySelectorAll('input[name="quiz-mode"]').forEach(r => {
      const opt = r.closest('label').querySelector('.mode-option');
      opt.classList.remove('mode-selected');
      opt.style.borderColor = '';
      opt.style.background  = '';
    });
    const selected = this.closest('label').querySelector('.mode-option');
    selected.classList.add('mode-selected');
    const timeSec = document.getElementById('time-section');
    timeSec.style.display = this.value === 'exam' ? '' : 'none';
  });
});
(function() {
  const checked = document.querySelector('input[name="quiz-mode"]:checked');
  if (checked) {
    const opt = checked.closest('label').querySelector('.mode-option');
    opt.classList.add('mode-selected');
    opt.style.borderColor = 'var(--accent)';
    opt.style.background  = 'var(--accent-dim)';
  }
})();

/* ─── ORDER SELECTION ───────────────────────────────────────── */
document.querySelectorAll('input[name="quiz-order"]').forEach(input => {
  input.addEventListener('change', function() {
    document.querySelectorAll('input[name="quiz-order"]').forEach(r => {
      const opt = r.closest('label').querySelector('.mode-option');
      opt.classList.remove('mode-order-selected');
      opt.style.borderColor = '';
      opt.style.background  = '';
    });
    const selected = this.closest('label').querySelector('.mode-option');
    selected.classList.add('mode-order-selected');
    selected.style.borderColor = 'var(--accent)';
    selected.style.background  = 'var(--accent-dim)';
  });
});
(function() {
  const checked = document.querySelector('input[name="quiz-order"]:checked');
  if (checked) {
    const opt = checked.closest('label').querySelector('.mode-option');
    opt.classList.add('mode-order-selected');
    opt.style.borderColor = 'var(--accent)';
    opt.style.background  = 'var(--accent-dim)';
  }
})();

/* ─── INIT UI ────────────────────────────────────────────────── */
function initUI() {
  document.title = BANK_CONFIG.title;
  document.getElementById('bank-title').textContent    = BANK_CONFIG.title;
  document.getElementById('bank-subtitle').textContent = BANK_CONFIG.description;
  document.getElementById('topbar-title').textContent  = BANK_CONFIG.title;
  if (BANK_CONFIG.icon) {
    document.getElementById('start-icon').textContent = BANK_CONFIG.icon;
  }

  const bankSize = QUESTION_BANK.length;
  const progress = getBankProgress();

  const covered = progress.shownIndices.length;
  const pct = bankSize > 0 ? Math.round(covered / bankSize * 100) : 0;
  if (pct === 100 && covered > 0) {
    progress.cycleCount++;
    progress.shownIndices = [];
    saveBankProgress(progress);
    EngineShared.showToast(`🎉 Full cycle complete! Starting fresh — cycle ${progress.cycleCount + 1}`);
  }

  const remaining = Math.max(1, bankSize - progress.shownIndices.length);
  const capCount = document.getElementById('q-count-input');

  capCount.max = remaining;
  capCount.placeholder = remaining;

  const defaultCount = Math.min(20, remaining);
  adjustCount(0);

  updateStartScreenStats();

  const savedTheme = localStorage.getItem('quiz-theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  EngineShared.updateThemeIcon();

  uiReady = true;
}

/* ─── START QUIZ ─────────────────────────────────────────────── */
function startQuiz() {
  const mode = document.querySelector('input[name="quiz-mode"]:checked').value;
  const order = document.querySelector('input[name="quiz-order"]:checked').value;
  const timeMins = parseInt(document.getElementById('time-input').value) || 30;
  let count = selectedCount;

  clearProgress();

  SESSION_QUESTIONS = selectSessionQuestions(count, order);

  state.current   = 0;
  state.answers   = {};
  state.flagged   = {};
  state.elapsed   = 0;
  state.submitted = false;
  state.mode      = mode;
  state.timerSecs = timeMins * 60;

  document.documentElement.style.setProperty('--q-count', SESSION_QUESTIONS.length);

  showScreen('quiz-screen');

  document.getElementById('timer-display').classList.remove('hidden');

  if (mode === 'learning') {
    document.getElementById('legend-text-answered').textContent = 'Correct';
    document.getElementById('legend-wrong').style.display = 'flex';
  } else {
    document.getElementById('legend-text-answered').textContent = 'Answered';
    document.getElementById('legend-wrong').style.display = 'none';
  }

  buildNavGrid();
  updateNavGrid();
  renderQuestion(0);
  startTimer();
}

/* ─── SCREEN MANAGER ─────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    if (s.style.opacity === '0') s.style.opacity = '';
  });
  const target = document.getElementById(id);
  if (target.style.opacity === '0') target.style.opacity = '';

  if (id === 'start-screen') {
    const animEls = target.querySelectorAll('.start-card, .start-icon');
    animEls.forEach(el => { el.style.animation = 'none'; });
    void target.offsetHeight;
    animEls.forEach(el => { el.style.animation = ''; });
  }

  target.classList.add('active');
  if (id === 'start-screen') updateStartScreenStats();
}

/* ─── TIMER ──────────────────────────────────────────────────── */
function startTimer() {
  if (state.timerID) clearInterval(state.timerID);
  timerPaused = false;
  lastTime = Date.now();
  state.timerID = setInterval(() => {
    if (!timerPaused && (state.timerSecs > 0 || state.mode === 'learning')) {
      const now = Date.now();
      const delta = Math.floor((now - lastTime) / 1000);
      if (delta >= 1) {
        state.elapsed   += delta;
        lastTime = now;
        if (state.mode !== 'learning') {
          state.timerSecs -= delta;
          if (state.timerSecs <= 0) {
            state.timerSecs = 0;
            stopTimer();
            EngineShared.showToast("⏰ Time's up! Submitting…");
            submitTimeout = setTimeout(confirmSubmit, 1500);
          }
        }
        updateTimerDisplay();
      }
    }
  }, 500);
}

function stopTimer() {
  if (state.timerID) { clearInterval(state.timerID); state.timerID = null; }
  if (submitTimeout) { clearTimeout(submitTimeout); submitTimeout = null; }
  timerPaused = true;
}

function updateTimerDisplay() {
  const secs = state.mode === 'learning'
    ? (state.elapsed || 0)
    : Math.max(0, state.timerSecs || 0);
  const m = Math.floor(secs / 60), s = secs % 60;
  document.getElementById('timer-text').textContent =
    String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  const el = document.getElementById('timer-display');
  if (state.mode !== 'learning' && secs < 120) {
    el.classList.add('warn');
  } else {
    el.classList.remove('warn');
  }
}

/* ─── RENDER QUESTION ────────────────────────────────────────── */
function renderQuestion(idx) {
  state.current = idx;
  const q        = SESSION_QUESTIONS[idx];
  const isLast   = idx === SESSION_QUESTIONS.length - 1;
  const sel      = state.answers[idx];
  const isLearning  = state.mode === 'learning';
  const isAnswered  = sel !== undefined;

  const done = Object.keys(state.answers).length;
  document.getElementById('progress-fill').style.width =
    (done / SESSION_QUESTIONS.length * 100) + '%';

  const area = document.getElementById('question-area');
  area.innerHTML = `
    <div class="q-header">
      <span class="q-number-badge">Q ${idx+1} / ${SESSION_QUESTIONS.length}</span>
      <div class="q-text">${q.question}</div>
      <div class="q-actions">
        <button class="flag-btn ${state.flagged[idx]?'active':''}" onclick="toggleFlag(${idx})" id="flag-btn-${idx}">
          <svg width="13" height="13" viewBox="0 0 24 24"
               fill="${state.flagged[idx]?'currentColor':'none'}"
               stroke="currentColor" stroke-width="2.2">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
            <line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
          ${state.flagged[idx] ? 'Flagged' : 'Flag'}
        </button>
        ${state.isHighlighterMode && state.highlights[_hlGlobalIdx(idx)] && state.highlights[_hlGlobalIdx(idx)].length > 0 ? '<button class="flag-btn" onclick="clearAllHighlights('+idx+')" title="Clear all highlights for this question" style="font-size:0.75rem;">✕ Clear</button>' : ''}
      </div>
    </div>

    <div class="options-list">
      ${q.options.map((opt, i) => {
        let extra = '', keyStyle = '';
        if (isLearning && isAnswered) {
          if (i === q.correct) {
            extra = 'border-color: var(--correct) !important; background: var(--correct-bg) !important; pointer-events: none;';
            keyStyle = 'background: var(--correct) !important; color: white !important; border-color: var(--correct) !important;';
          } else if (sel === i) {
            extra = 'border-color: var(--wrong) !important; background: var(--wrong-bg) !important; pointer-events: none;';
            keyStyle = 'background: var(--wrong) !important; color: white !important; border-color: var(--wrong) !important;';
          } else {
            extra = 'pointer-events: none;';
          }
        }
        return `
          <input type="radio" name="q_opt" id="opt_${i}" value="${i}"
                 ${sel===i?'checked':''} ${isLearning && isAnswered ? 'disabled' : ''}
                 onchange="selectAnswer(${idx},${i})">
          <label class="option-label" for="opt_${i}" data-opt-idx="${i}" style="${extra}">
            <span class="option-key" style="${keyStyle}">${KEYS[i]}</span>
            <span class="option-text">${opt}</span>
          </label>`;
      }).join('')}
    </div>

    ${(isLearning && isAnswered) ? `
      <div class="explanation-box" style="margin-top: 1rem;">
        <strong>${sel === q.correct ? '✅ Correct!' : '❌ Incorrect'}</strong>
        ${q.explanation}
      </div>` : ''}

    <div class="q-nav-btns">
      ${idx > 0         ? `<button class="btn-nav" onclick="goTo(${idx-1})">← Previous</button>` : ''}
      ${!isLast         ? `<button class="btn-nav primary" onclick="nextQuestion()">Next →</button>` : ''}
      ${isLast          ? `<button class="btn-nav submit-btn" onclick="attemptSubmit()">✓ Submit</button>` : ''}
    </div>`;

  updateNavGrid(idx);
  updateNavStats();
  area.scrollTop = 0;

  delete _hlCache[_hlGlobalIdx(idx)];
  applyBulkHighlights(idx);
}

/* ─── ANSWER SELECTION ───────────────────────────────────────── */
function selectAnswer(qIdx, optIdx) {
  if (state.mode === 'learning' && state.answers[qIdx] !== undefined) return;
  state.answers[qIdx] = optIdx;
  EngineShared.debounceSave(saveProgress);
  updateNavGrid(qIdx);
  updateNavStats();
  if (state.mode === 'learning') {
    renderQuestion(qIdx);
    return;
  }
  var done = 0;
  for (var k in state.answers) { if (state.answers.hasOwnProperty(k)) done++; }
  document.getElementById('progress-fill').style.width = (done / SESSION_QUESTIONS.length * 100) + '%';
}

/* ─── NAVIGATION ─────────────────────────────────────────────── */
function nextQuestion() {
  if (state.current < SESSION_QUESTIONS.length - 1) renderQuestion(state.current + 1);
}
function goTo(idx) { renderQuestion(idx); }

/* ─── FLAG ───────────────────────────────────────────────────── */
function toggleFlag(idx) {
  state.flagged[idx] = !state.flagged[idx];
  const btn = document.getElementById(`flag-btn-${idx}`);
  if(btn) {
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="${state.flagged[idx]?'currentColor':'none'}" stroke="currentColor" stroke-width="2.2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
      ${state.flagged[idx] ? 'Flagged' : 'Flag'}
    `;
    btn.classList.toggle('active', state.flagged[idx]);
  }
  updateNavGrid(idx);
  updateNavStats();
  EngineShared.debounceSave(saveProgress);
  EngineShared.showToast(state.flagged[idx] ? `⚑ Question ${idx+1} flagged` : `Question ${idx+1} unflagged`);
}

/* ─── NAV GRID ───────────────────────────────────────────────── */
function buildNavGrid() {
  const grid = document.getElementById('nav-grid');
  grid.innerHTML = SESSION_QUESTIONS.map((_, i) =>
    `<button class="nav-btn" id="nav-btn-${i}" onclick="goTo(${i})">${i+1}</button>`
  ).join('');
}

let lastCurrentIdx = -1;

function updateNavGrid(changedIdx) {
  const updateNode = (i) => {
    if (i < 0 || i >= SESSION_QUESTIONS.length) return;
    const btn = document.getElementById(`nav-btn-${i}`);
    if (!btn) return;
    var isFlagged = !!state.flagged[i];
    var isCurrent = (i === state.current);
    var isAnswered = state.answers[i] !== undefined;
    var isWrong = isAnswered && state.mode === 'learning' && state.answers[i] !== SESSION_QUESTIONS[i].correct;
    btn.className = 'nav-btn' + (isCurrent ? ' current' : isWrong ? ' wrong' : isAnswered ? ' answered' : '') + (isFlagged && !isCurrent ? ' flagged' : '');

    var existingDot = btn.querySelector('.flag-dot');
    if (isFlagged) {
      if (!existingDot) {
        var dot = document.createElement('span');
        dot.className = 'flag-dot';
        btn.appendChild(dot);
      }
    } else if (existingDot) {
      existingDot.remove();
    }
  };

  if (changedIdx === undefined) {
    SESSION_QUESTIONS.forEach((_, i) => updateNode(i));
  } else {
    const indicesToUpdate = new Set([state.current, lastCurrentIdx]);
    if (changedIdx !== null) indicesToUpdate.add(changedIdx);
    indicesToUpdate.forEach(i => updateNode(i));
  }

  lastCurrentIdx = state.current;
}

function updateNavStats() {
  var answered = 0, flagged = 0;
  for (var k in state.answers) { if (state.answers.hasOwnProperty(k)) answered++; }
  for (var k in state.flagged) { if (state.flagged[k]) flagged++; }
  document.getElementById('stat-answered').textContent  = answered;
  document.getElementById('stat-flagged-q').textContent = flagged;
  document.getElementById('stat-skipped').textContent   = SESSION_QUESTIONS.length - answered;
}

/* ─── SUBMIT ─────────────────────────────────────────────────── */
function attemptSubmit() {
  if (submitTimeout) { clearTimeout(submitTimeout); submitTimeout = null; }

  if (state.mode === 'learning') { confirmSubmit(); return; }
  const unanswered = SESSION_QUESTIONS.length - Object.keys(state.answers).length;
  if (unanswered > 0) {
    document.getElementById('modal-unanswered').textContent = unanswered;
    document.getElementById('submit-modal').classList.add('open');
  } else {
    confirmSubmit();
  }
}
function closeModal() { document.getElementById('submit-modal').classList.remove('open'); }
function confirmSubmit() {
  if (state.submitted) return;
  state.submitted = true;
  clearInterval(saveIntervalId);
  if (pendingTransitionTimeout) {
    clearTimeout(pendingTransitionTimeout);
    pendingTransitionTimeout = null;
  }
  closeModal();
  stopTimer();
  EngineTracker.saveTrackerData({
    config: window.BANK_CONFIG,
    questions: window.SESSION_QUESTIONS || window.QUESTION_BANK,
    state: state,
    keys: KEYS,
    sessionIndices: typeof SESSION_QUESTION_INDICES !== 'undefined' ? SESSION_QUESTION_INDICES : null,
    questionBank: typeof QUESTION_BANK !== 'undefined' ? QUESTION_BANK : null,
    onNavigate: EngineShared.navigateToIndex,
    onToast: EngineShared.showToast
  });
  clearProgress();
  buildResults();
  showScreen('result-screen');
}

/* ─── NEW SESSION BUTTON ─────────────────────────────────────── */
function onNewSessionClick(event) {
  event.preventDefault();

  const progress = getBankProgress();
  const bankSize = QUESTION_BANK.length;
  const covered = progress.shownIndices.length;
  const pct = bankSize > 0 ? Math.round(covered / bankSize * 100) : 0;

  if (pct === 100) {
    progress.cycleCount++;
    progress.shownIndices = [];
    saveBankProgress(progress);
    EngineShared.showToast(`🎉 Full cycle complete! Starting fresh — cycle ${progress.cycleCount + 1}`);
    showScreen('start-screen');
    return;
  }

  showScreen('start-screen');
}

/* ─── BUILD RESULTS ──────────────────────────────────────────── */
function buildResults() {
  let correct = 0, wrong = 0, skipped = 0;
  SESSION_QUESTIONS.forEach((q, i) => {
    const ans = state.answers[i];
    if (ans === undefined) skipped++;
    else if (ans === q.correct) correct++;
    else wrong++;
  });
  const total   = SESSION_QUESTIONS.length;
  const pct     = Math.round(correct / total * 100);
  const flagged = Object.values(state.flagged).filter(Boolean).length;
  const em = Math.floor(state.elapsed/60), es = state.elapsed%60;
  const timeStr = String(em).padStart(2,'0') + ':' + String(es).padStart(2,'0');

  document.getElementById('res-pct').textContent     = pct + '%';
  document.getElementById('res-correct').textContent = correct;
  document.getElementById('res-wrong').textContent   = wrong;
  document.getElementById('res-flagged').textContent = flagged;
  document.getElementById('res-skipped').textContent = skipped;
  document.getElementById('res-time').textContent    = timeStr;

  let grade = '';
  if (pct>=90) grade='🏆 Outstanding!';
  else if(pct>=75) grade='🌟 Great Work!';
  else if(pct>=60) grade='👍 Good Effort!';
  else if(pct>=40) grade='📚 Keep Studying!';
  else grade='💪 Don\'t Give Up!';
  document.getElementById('res-grade').textContent = grade;

  var notesPlaceholder = document.getElementById('study-notes-placeholder');
  if (!notesPlaceholder) {
    notesPlaceholder = document.createElement('div');
    notesPlaceholder.id = 'study-notes-placeholder';
    var scoreBanner = document.querySelector('.score-banner');
    if (scoreBanner && scoreBanner.parentNode) {
      scoreBanner.parentNode.insertBefore(notesPlaceholder, scoreBanner.nextSibling);
    }
  }
  if (localStorage.getItem('gemini_api_key')) {
    EngineShared.ensureAiAssistant(function() { AiAssistant.maybeRenderNotesCard(SESSION_QUESTIONS, state.answers); });
  }

  renderResultItems('all');
  updateExportBadges();
}

let renderResultItemsRafId = null;

function renderResultItems(filter) {
  const list = document.getElementById('result-list');
  list.innerHTML = '';

  if (renderResultItemsRafId) {
    cancelAnimationFrame(renderResultItemsRafId);
    renderResultItemsRafId = null;
  }

  let i = 0;
  let itemsRendered = 0;

  function renderChunk() {
    const chunkEnd = Math.min(i + 20, SESSION_QUESTIONS.length);

    for (; i < chunkEnd; i++) {
      const q = SESSION_QUESTIONS[i];
      const ans = state.answers[i];
      const isCorrect = ans === q.correct;
      const isSkipped = ans === undefined;
      const isFlagged = state.flagged[i];
      let statusClass = isSkipped ? 'skipped' : (isCorrect ? 'correct' : 'wrong');
      let show = filter === 'all'
        || (filter === 'correct' && isCorrect && !isSkipped)
        || (filter === 'wrong'   && !isCorrect && !isSkipped)
        || (filter === 'skipped' && isSkipped)
        || (filter === 'flagged' && isFlagged);
      if (!show) continue;

      itemsRendered++;

      const icon = isSkipped ? '—' : (isCorrect ? '✓' : '✗');
      const userOpt = ans !== undefined ? q.options[ans] : 'Not answered';
      const corrOpt = q.options[q.correct];

      const el = document.createElement('div');
      el.className = `result-item ${statusClass}`;
      el.innerHTML = `
        <div class="result-item-header" onclick="toggleResultItem(this)">
          <div class="result-status-icon">${icon}</div>
          <div class="result-q-meta">
            <div class="result-q-num">Question ${i+1}${isFlagged?' · ⚑ Flagged':''}</div>
            <div class="result-q-text">${q.question}</div>
          </div>
          <div class="expand-arrow">▼</div>
        </div>
        <div class="result-item-body">
          ${!isSkipped ? `
            <div class="answer-row your-answer ${isCorrect?'is-correct':''}">
              <span class="ar-label">Your Answer</span>
              <span>${KEYS[ans]}. ${userOpt}</span>
            </div>` : ''}
          ${!isCorrect ? `
            <div class="answer-row correct-answer">
              <span class="ar-label">Correct Answer</span>
              <span>${KEYS[q.correct]}. ${corrOpt}</span>
            </div>` : ''}
          <div class="explanation-box">
            <strong>Explanation</strong>
            ${q.explanation}
          </div>
        </div>`;
      list.appendChild(el);
    }

    if (i < SESSION_QUESTIONS.length) {
      renderResultItemsRafId = requestAnimationFrame(renderChunk);
    } else {
      if (itemsRendered === 0) {
        list.innerHTML = `<div style="color:var(--text-muted);font-size:0.9rem;padding:1rem 0;">No questions in this category.</div>`;
      }
      renderResultItemsRafId = null;
    }
  }

  renderResultItemsRafId = requestAnimationFrame(renderChunk);
}

function toggleResultItem(header) {
  header.classList.toggle('open');
  header.nextElementSibling.classList.toggle('open');
}
function filterResults(filter, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderResultItems(filter);
}

/* ─── CONFIRM RESET (mid-quiz) ───────────────────────────────── */
function confirmResetProgress() {
  document.getElementById('reset-modal').classList.add('open');
}

function closeResetModal() {
  document.getElementById('reset-modal').classList.remove('open');
}

function confirmResetAction() {
  clearInterval(saveIntervalId);
  stopTimer();
  state.submitted = false;
  state.current = 0;
  state.answers = {};
  state.flagged = {};
  state.highlights = {};
  state.strikethrough = {};
  state.isHighlighterMode = false;
  _hlCache = {};
  document.body.classList.remove('highlighter-active');
  document.querySelectorAll('.hl-mode-btn').forEach(function(b) { b.classList.remove('active'); });
  state.elapsed = 0;

  const progress = getBankProgress();
  if (progress.totalSessions > 0) progress.totalSessions--;
  if (SESSION_QUESTION_INDICES && SESSION_QUESTION_INDICES.length > 0) {
    const sessionSet = new Set(SESSION_QUESTION_INDICES);
    progress.shownIndices = progress.shownIndices.filter(i => !sessionSet.has(i));
  }
  saveBankProgress(progress);

  clearProgress();

  pendingRestoreData = null;
  if (restoreToastTimeout) { clearTimeout(restoreToastTimeout); restoreToastTimeout = null; }
  if (restoreScreenTimeout) { clearTimeout(restoreScreenTimeout); restoreScreenTimeout = null; }

  closeResetModal();
  showScreen('start-screen');
}

function openAiAssistant() {
  var q = SESSION_QUESTIONS[state.current];
  if (!q) return;
  EngineShared.ensureAiAssistant(function() { AiAssistant.openAssistant(q); });
}

// Auto-save every 5 seconds
let saveIntervalId = setInterval(saveProgress, 5000);

// Save progress before page unload (tab close, refresh, navigation)
window.addEventListener('beforeunload', function() {
  if (!state.submitted) saveProgress();
});

/* ─── VISIBILITY CHANGE ──────────────────────────────────────── */
window.addEventListener('visibilitychange', () => {
  if (document.hidden && !state.submitted) {
    stopTimer();
  } else if (!document.hidden && !state.submitted && state.timerID === null
             && document.getElementById('quiz-screen').classList.contains('active')) {
    startTimer();
  }
});

/* ── KEYBOARD SHORTCUTS ─────────────────────────────────────── */
EngineShared.setupShortcuts({
  isActive: function() { return document.getElementById('quiz-screen')?.classList.contains('active'); },
  onPrev: function() { if (state.current > 0) renderQuestion(state.current - 1); },
  onNext: function() { if (state.current < SESSION_QUESTIONS.length - 1) renderQuestion(state.current + 1); },
  onFlag: function() { toggleFlag(state.current); },
  onToggleHighlighter: toggleHighlighterMode,
  onStrikethrough: function() {
    var q = SESSION_QUESTIONS[state.current];
    if (q) {
      if (_hoveredOption >= 0) { toggleStrikethrough(state.current, _hoveredOption); return; }
      var gIdx = _hlGlobalIdx(state.current);
      var stMap = (gIdx !== undefined && state.strikethrough[gIdx]) || {};
      for (var i = 0; i < q.options.length; i++) {
        if (!stMap[i]) { toggleStrikethrough(state.current, i); return; }
      }
      if (gIdx !== undefined) state.strikethrough[gIdx] = {};
      renderQuestion(state.current);
    }
  },
  onSubmit: function() { attemptSubmit(); },
  onEscape: function() { closeModal(); closeResetModal(); closeKbHelp(); },
  onHelp: function() { toggleKbHelp(); }
});

// Color selector keys (1-4) in highlighter mode
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.key >= '1' && e.key <= '4') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    var quizActive = document.getElementById('quiz-screen')?.classList.contains('active');
    if (quizActive) {
      e.preventDefault(); e.stopImmediatePropagation();
      _hlLastColor = parseInt(e.key);
      _syncPickerUI();
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && state.isHighlighterMode) hlApplyColor(_hlLastColor);
    }
  }
});

/* ── PDF EXPORT ─────────────────────────────────────────────── */
function onExportFilterChange(checkbox) {
  const allCb     = document.querySelector('input[name="export-all"]');
  const wrongCb   = document.querySelector('input[name="export-wrong"]');
  const flaggedCb = document.querySelector('input[name="export-flagged"]');
  if (checkbox.name === 'export-all' && checkbox.checked) {
    wrongCb.checked = false; flaggedCb.checked = false;
  } else if (checkbox.name !== 'export-all' && checkbox.checked) {
    allCb.checked = false;
  }
  if (!allCb.checked && !wrongCb.checked && !flaggedCb.checked) allCb.checked = true;
}

function updateExportBadges() {
  const qs = (typeof SESSION_QUESTIONS !== 'undefined' && SESSION_QUESTIONS && SESSION_QUESTIONS.length)
    ? SESSION_QUESTIONS : QUESTIONS;
  let allC = 0, wrongC = 0, flaggedC = 0;
  qs.forEach((q, i) => {
    const ans = state.answers[i];
    allC++;
    if (ans !== undefined && ans !== q.correct) wrongC++;
    if (state.flagged[i]) flaggedC++;
  });
  document.getElementById('badge-all').textContent     = allC;
  document.getElementById('badge-wrong').textContent   = wrongC;
  document.getElementById('badge-flagged').textContent = flaggedC;
}

function exportToPDF() {
  const allCb     = document.querySelector('input[name="export-all"]');
  const wrongCb   = document.querySelector('input[name="export-wrong"]');
  const flaggedCb = document.querySelector('input[name="export-flagged"]');

  let filter = 'all';
  if (!allCb.checked) {
    if (wrongCb.checked && !flaggedCb.checked)      filter = 'wrong';
    else if (flaggedCb.checked && !wrongCb.checked) filter = 'flagged';
    else if (wrongCb.checked && flaggedCb.checked)  filter = 'wrong+flagged';
  }

  EngineShared.showToast('Generating PDF...');

  const qs      = (typeof SESSION_QUESTIONS !== 'undefined' && SESSION_QUESTIONS && SESSION_QUESTIONS.length)
    ? SESSION_QUESTIONS : QUESTIONS;
  const title   = document.title || 'Quiz Results';
  const pct     = document.getElementById('res-pct').textContent;
  const grade   = document.getElementById('res-grade').textContent;
  const correct = document.getElementById('res-correct').textContent;
  const wrongN  = document.getElementById('res-wrong').textContent;
  const skipped = document.getElementById('res-skipped').textContent;
  const timeEl  = document.getElementById('res-time');
  const timeUsed = timeEl ? timeEl.textContent : '--';

  const filterLabels = { 'all': 'All Questions', 'wrong': 'Wrong Answers', 'flagged': 'Flagged Questions', 'wrong+flagged': 'Wrong + Flagged' };

  const toExport = [];
  qs.forEach((q, i) => {
    const ans       = state.answers[i];
    const isCorrect = ans === q.correct;
    const isSkipped = ans === undefined;
    const isFlagged = !!state.flagged[i];
    const show = filter === 'all'
      || (filter === 'wrong'         && !isCorrect && !isSkipped)
      || (filter === 'flagged'       && isFlagged)
      || (filter === 'wrong+flagged' && ((!isCorrect && !isSkipped) || isFlagged));
    if (show) toExport.push({ q, i, ans, isCorrect, isSkipped, isFlagged });
  });

  var container = document.createElement('div');

  var currentChunkHtml = '<h1 style="font-size:22px;margin:0 0 4px;font-family:Georgia,serif;">' + title + '</h1>'
    + '<p style="color:#78716c;margin:0 0 16px;font-size:13px;">Quiz Results &mdash; ' + new Date().toLocaleDateString() + '</p>'
    + '<div style="background:#f8f6f1;border-radius:12px;padding:18px 20px;margin-bottom:22px;border:1px solid #d0ccc5;display:flex;gap:18px;align-items:center;flex-wrap:wrap;">'
    +   '<div style="width:84px;height:84px;border-radius:50%;border:4px solid #c27803;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;background:rgba(194,120,3,.10);">'
    +     '<div style="font-size:20px;font-weight:700;color:#c27803;line-height:1;">' + pct + '</div>'
    +     '<div style="font-size:9px;color:#78716c;text-transform:uppercase;letter-spacing:.04em;">Score</div>'
    +   '</div>'
    +   '<div style="flex:1;min-width:180px;">'
    +     '<h2 style="font-family:Georgia,serif;font-size:17px;margin:0 0 10px;">' + grade + '</h2>'
    +     '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#16a34a;">' + correct + '</div><div style="font-size:10px;color:#78716c;">Correct</div></div>'
    +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#dc2626;">' + wrongN  + '</div><div style="font-size:10px;color:#78716c;">Wrong</div></div>'
    +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#78716c;">' + skipped + '</div><div style="font-size:10px;color:#78716c;">Skipped</div></div>'
    +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;">' + timeUsed + '</div><div style="font-size:10px;color:#78716c;">Time</div></div>'
    +     '</div>'
    +   '</div>'
    + '</div>'
    + '<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin:0 0 12px;">'
    +   (filterLabels[filter] || 'Questions') + ' (' + toExport.length + ')'
    + '</h3>';

  var questionsPerChunk = 15;

  toExport.forEach(function(item, idx) {
    var q = item.q, i = item.i, ans = item.ans;
    var isCorrect = item.isCorrect, isSkipped = item.isSkipped, isFlagged = item.isFlagged;
    var sc   = isSkipped ? '#78716c' : (isCorrect ? '#16a34a' : '#dc2626');
    var icon = isSkipped ? '-' : (isCorrect ? 'OK' : 'X');
    var bgH  = isSkipped ? '#f8f6f1' : (isCorrect ? 'rgba(22,163,74,.06)' : 'rgba(220,38,38,.06)');
    var gIdx = SESSION_QUESTION_INDICES[i];
    var stMap = (gIdx !== undefined && state.strikethrough[gIdx]) || {};
    var uAns = ans !== undefined ? (KEYS[ans] + '. ' + (stMap[ans] ? '<span style="text-decoration:line-through;opacity:0.5;">' + q.options[ans] + '</span>' : q.options[ans])) : 'Not answered';
    var cAns = KEYS[q.correct] + '. ' + (stMap[q.correct] ? '<span style="text-decoration:line-through;opacity:0.5;">' + q.options[q.correct] + '</span>' : q.options[q.correct]);
    currentChunkHtml += '<div style="border:1.5px solid ' + sc + ';border-radius:10px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid;">'
      +   '<div style="padding:12px 15px;background:' + bgH + ';">'
      +     '<div style="display:flex;gap:10px;align-items:flex-start;">'
      +       '<div style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;background:rgba(0,0,0,.06);color:' + sc + ';">' + icon + '</div>'
      +       '<div>'
      +         '<div style="font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Q' + (i+1) + (isFlagged ? ' &bull; Flagged' : '') + '</div>'
      +         '<div style="font-size:14px;font-weight:500;line-height:1.5;">' + _hlToPDFHTML(q.question, (gIdx !== undefined && state.highlights[gIdx]) || [], 'question') + '</div>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div style="padding:10px 15px 12px;border-top:1px solid #e5e0db;">';
    if (!isSkipped) {
      currentChunkHtml += '<div style="background:' + (isCorrect ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)') + ';border-radius:6px;padding:7px 11px;margin-bottom:7px;font-size:12px;"><span style="font-size:10px;text-transform:uppercase;font-weight:700;opacity:.6;margin-right:8px;">Your Answer</span>' + uAns + '</div>';
    }
    if (!isCorrect) {
      currentChunkHtml += '<div style="background:rgba(22,163,74,.08);border-radius:6px;padding:7px 11px;margin-bottom:7px;font-size:12px;"><span style="font-size:10px;text-transform:uppercase;font-weight:700;opacity:.6;margin-right:8px;">Correct Answer</span>' + cAns + '</div>';
    }
    if (q.explanation) {
      currentChunkHtml += '<div style="background:#f8f6f1;border-left:3px solid #c27803;border-radius:0 6px 6px 0;padding:9px 11px;font-size:12px;color:#44403c;line-height:1.6;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#1c1917;margin-bottom:3px;">Explanation</div>' + q.explanation + '</div>';
    }
    currentChunkHtml += '</div></div>';

    if ((idx + 1) % questionsPerChunk === 0 || idx === toExport.length - 1) {
      var chunkDiv = document.createElement('div');
      chunkDiv.innerHTML = '<div style="font-family:Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#1c1917;">' + currentChunkHtml + '</div>';
      container.appendChild(chunkDiv);
      currentChunkHtml = '';
    }
  });

  var filename = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_results.pdf';
  var opt = {
    margin:      [10, 10, 10, 10],
    filename:    filename,
    image:       { type: 'jpeg', quality: 0.97 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  function runExport() {
    if (typeof html2pdf === 'undefined') {
      EngineShared.showToast('PDF library still loading, try again in a moment');
      return;
    }
    try {
      var children = Array.from(container.children);
      if (children.length === 0) return;

      var worker = html2pdf().set(opt).from(children[0]).toPdf();

      children.slice(1).forEach(function(child) {
        worker = worker.get('pdf').then(function(pdf) {
          pdf.addPage();
        }).from(child).toContainer().toCanvas().toPdf();
      });

      worker.save().catch(function(err) { console.error('PDF export error:', err); });
    } catch (err) { console.error('PDF export error:', err); }
  }

  if (typeof html2pdf !== 'undefined') {
    runExport();
  } else {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.onload  = runExport;
    s.onerror = function() { EngineShared.showToast('Failed to load PDF library'); };
    document.head.appendChild(s);
  }
}

/* ─── BOOT ───────────────────────────────────────────────────── */
initUI();
checkSavedProgress();

/* ================================================================
   TRACKER DASHBOARD & KEYBOARD HELP
   ================================================================ */
window.removeTrackerItem = function(uid, qIdx) {
  try {
    var raw = localStorage.getItem(EngineTracker.getStorageKey(uid));
    if (!raw) return;
    var data = JSON.parse(raw);
    data.wrong   = (data.wrong   || []).filter(function(q) { return q.idx !== qIdx; });
    data.flagged = (data.flagged || []).filter(function(q) { return q.idx !== qIdx; });
    data.wrongCount   = data.wrong.length;
    data.flaggedCount = data.flagged.length;

    if (!data.wrong.length && !data.flagged.length) {
      localStorage.removeItem(EngineTracker.getStorageKey(uid));
      var keys = EngineTracker.getSafeTrackerKeys();
      localStorage.setItem('quiz_tracker_keys', JSON.stringify(keys.filter(function(k) { return k !== uid; })));
    } else {
      localStorage.setItem(EngineTracker.getStorageKey(uid), JSON.stringify(data));
    }
    renderDashboard();
    EngineTracker.updateDashboardBadge();
  } catch(e) { console.error('Remove tracker item error:', e); }
};

window.clearAllTrackerData = function() {
  if (!confirm('Clear all tracked questions? This cannot be undone.')) return;
  try {
    var keys = EngineTracker.getSafeTrackerKeys();
    keys.forEach(function(uid) { localStorage.removeItem(EngineTracker.getStorageKey(uid)); });
    localStorage.removeItem('quiz_tracker_keys');
    renderDashboard();
    EngineTracker.updateDashboardBadge();
  } catch(e) { console.error('Clear tracker error:', e); }
};

var currentScope = 'quiz';
var currentScopePath = '';

window.switchDashScope = function(scope, path) {
  currentScope = scope;
  currentScopePath = path;
  var tabs = document.querySelectorAll('.dash-scope-tab');
  tabs.forEach(function(tab) {
    tab.classList.toggle('active', tab.getAttribute('data-scope') === scope);
  });
  renderDashboard();
};

function renderDashboard() {
  var data = EngineTracker.getTrackerDataForScope(currentScope, currentScopePath);
  var totalWrong = 0, totalFlagged = 0;

  data.forEach(function(d) {
    totalWrong   += (d.wrong || []).length;
    totalFlagged += (d.flagged || []).length;
  });

  document.getElementById('dash-total-wrong').textContent   = totalWrong;
  document.getElementById('dash-total-flagged').textContent = totalFlagged;
  document.getElementById('dash-total-quizzes').textContent = data.length;

  var body = document.getElementById('dash-body');

  if (!data.length) {
    body.innerHTML = '<div class="dash-empty"><div class="dash-empty-icon">📋</div><p>No tracked questions yet.<br>Complete a quiz to start tracking wrong and flagged questions.</p></div>';
    return;
  }

  data.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

  var html = '';
  data.forEach(function(d) {
    var wrongItems   = d.wrong || [];
    var flaggedItems = d.flagged || [];
    var wrongIdxs    = {};
    wrongItems.forEach(function(q) { wrongIdxs[q.idx] = true; });
    var uniqueFlagged = flaggedItems.filter(function(q) { return !wrongIdxs[q.idx]; });
    if (!wrongItems.length && !uniqueFlagged.length) return;

    var dateStr = d.timestamp
      ? new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    html += '<div class="dash-quiz-group">';
    html += '<div class="dash-quiz-title">' + (d.title || 'Unknown Quiz');
    if (wrongItems.length)   html += ' <span class="quiz-badge wrong-badge">' + wrongItems.length + ' wrong</span>';
    if (flaggedItems.length) html += ' <span class="quiz-badge flag-badge">' + flaggedItems.length + ' flagged</span>';
    if (dateStr)             html += ' <span style="font-size:0.7rem;color:var(--text-muted);font-weight:400;margin-left:auto;">' + dateStr + '</span>';
    html += '</div>';

    wrongItems.forEach(function(q) {
      var isAlsoFlagged = flaggedItems.some(function(f) { return f.idx === q.idx; });
      html += buildDashQItem(d.uid, q, isAlsoFlagged ? 'Wrong + Flagged' : 'Wrong', 'wrong', '✗');
    });

    uniqueFlagged.forEach(function(q) {
      html += buildDashQItem(d.uid, q, 'Flagged', 'flagged', '⚑');
    });

    html += '</div>';
  });

  body.innerHTML = html || '<div class="dash-empty"><div class="dash-empty-icon">✅</div><p>No wrong or flagged questions tracked. Great job!</p></div>';
}

function buildDashQItem(uid, q, typeLabel, iconClass, iconText) {
  var esc = (q.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return '<div class="dash-q-item">'
    + '<div class="dash-q-icon ' + iconClass + '">' + iconText + '</div>'
    + '<div class="dash-q-content">'
    +   '<div class="dash-q-num">Q' + ((q.idx || 0) + 1) + ' · ' + typeLabel + '</div>'
    +   '<div class="dash-q-text">' + esc + '</div>'
    + '</div>'
    + '<button class="dash-q-remove" onclick="removeTrackerItem(\'' + uid + '\',' + (q.idx || 0) + ')" title="Remove">✕</button>'
    + '</div>';
}

window.exportTrackerToPDF = function() {
  var data = EngineTracker.getTrackerDataForScope(currentScope, currentScopePath);
  if (!data.length) { EngineShared.showToast('No tracked questions to export.'); return; }

  var totalWrong = 0, totalFlagged = 0;
  data.forEach(function(d) { totalWrong += (d.wrong || []).length; totalFlagged += (d.flagged || []).length; });

  var scopeLabel = currentScope === 'quiz' ? 'This Quiz' : (currentScope === 'folder' ? currentScopePath : 'All Quizzes');
  var now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  var container = document.createElement('div');

  var currentChunkHtml = '<h1 style="font-size:22px;margin:0 0 4px;font-family:Georgia,serif;">📊 Question Tracker</h1>'
    + '<p style="color:#78716c;margin:0 0 4px;font-size:13px;">Scope: ' + scopeLabel + ' &mdash; ' + now + '</p>'
    + '<div style="background:#f8f6f1;border-radius:12px;padding:18px 20px;margin-bottom:22px;border:1px solid #d0ccc5;display:flex;gap:18px;align-items:center;flex-wrap:wrap;">'
    +   '<div style="flex:1;min-width:180px;">'
    +     '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#dc2626;">' + totalWrong + '</div><div style="font-size:10px;color:#78716c;">Wrong</div></div>'
    +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#2563eb;">' + totalFlagged + '</div><div style="font-size:10px;color:#78716c;">Flagged</div></div>'
    +       '<div style="background:#fff;border:1px solid #d0ccc5;border-radius:8px;padding:7px 12px;text-align:center;min-width:62px;"><div style="font-size:16px;font-weight:700;color:#16a34a;">' + data.length + '</div><div style="font-size:10px;color:#78716c;">Quizzes</div></div>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  var itemsCount = 0;
  var itemsPerChunk = 15;

  data.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

  data.forEach(function(d) {
    var wrongItems   = d.wrong || [];
    var flaggedItems = d.flagged || [];
    var wrongIdxs    = {};
    wrongItems.forEach(function(q) { wrongIdxs[q.idx] = true; });
    var uniqueFlagged = flaggedItems.filter(function(q) { return !wrongIdxs[q.idx]; });

    if (!wrongItems.length && !uniqueFlagged.length) return;

    currentChunkHtml += '<h3 style="font-size:14px;margin:18px 0 8px;font-family:Georgia,serif;">' + (d.title || 'Quiz') + '</h3>';

    var allItems = [];
    wrongItems.forEach(function(q) {
      var alsoFlagged = flaggedItems.some(function(f) { return f.idx === q.idx; });
      allItems.push({ q: q, type: alsoFlagged ? 'Wrong + Flagged' : 'Wrong', color: '#dc2626', bg: 'rgba(220,38,38,.06)' });
    });
    uniqueFlagged.forEach(function(q) {
      allItems.push({ q: q, type: 'Flagged', color: '#2563eb', bg: 'rgba(37,99,235,.06)' });
    });

    allItems.forEach(function(item) {
      var q = item.q;
      currentChunkHtml += '<div style="border:1.5px solid ' + item.color + ';border-radius:10px;margin-bottom:12px;overflow:hidden;page-break-inside:avoid;">'
        +   '<div style="padding:12px 15px;background:' + item.bg + ';">'
        +     '<div style="display:flex;gap:10px;align-items:flex-start;">'
        +       '<div style="width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0;background:rgba(0,0,0,.06);color:' + item.color + ';">' + (item.type === 'Flagged' ? '⚑' : '✗') + '</div>'
        +       '<div>'
        +         '<div style="font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Q' + ((q.idx || 0) + 1) + ' · ' + item.type + '</div>'
        +         '<div style="font-size:14px;font-weight:500;line-height:1.5;">' + q.text + '</div>'
        +       '</div>'
        +     '</div>'
        +   '</div>'
        +   '<div style="padding:10px 15px 12px;border-top:1px solid #e5e0db;">'
        +     '<div style="background:rgba(220,38,38,.08);border-radius:6px;padding:7px 11px;margin-bottom:7px;font-size:12px;"><span style="font-size:10px;text-transform:uppercase;font-weight:700;opacity:.6;margin-right:8px;">Your Answer</span>' + q.yourAnswer + '</div>'
        +     '<div style="background:rgba(22,163,74,.08);border-radius:6px;padding:7px 11px;margin-bottom:7px;font-size:12px;"><span style="font-size:10px;text-transform:uppercase;font-weight:700;opacity:.6;margin-right:8px;">Correct Answer</span>' + q.correctAnswer + '</div>';
      if (q.explanation) {
        currentChunkHtml += '<div style="background:#f8f6f1;border-left:3px solid #c27803;border-radius:0 6px 6px 0;padding:9px 11px;font-size:12px;color:#44403c;line-height:1.6;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#1c1917;margin-bottom:3px;">Explanation</div>' + q.explanation + '</div>';
      }
      currentChunkHtml += '</div></div>';
      itemsCount++;

      if (itemsCount >= itemsPerChunk) {
        var chunkDiv = document.createElement('div');
        chunkDiv.innerHTML = '<div style="font-family:Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#1c1917;">' + currentChunkHtml + '</div>';
        container.appendChild(chunkDiv);
        currentChunkHtml = '';
        itemsCount = 0;
      }
    });
  });

  if (currentChunkHtml) {
    var chunkDiv = document.createElement('div');
    chunkDiv.innerHTML = '<div style="font-family:Arial,sans-serif;max-width:780px;margin:0 auto;padding:20px;color:#1c1917;">' + currentChunkHtml + '</div>';
    container.appendChild(chunkDiv);
  }

  var filename = 'question_tracker_' + scopeLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf';
  var opt = { margin: [10,10,10,10], filename: filename, image: { type: 'jpeg', quality: 0.97 }, html2canvas: { scale: 2, useCORS: true, logging: false }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };

  function runExport() {
    var children = Array.from(container.children);
    if (children.length === 0) return;
    var worker = html2pdf().set(opt).from(children[0]).toPdf();
    children.slice(1).forEach(function(child) {
      worker = worker.get('pdf').then(function(pdf) { pdf.addPage(); }).from(child).toContainer().toCanvas().toPdf();
    });
    worker.save().catch(function() {});
  }

  if (typeof html2pdf !== 'undefined') {
    runExport();
  } else {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.onload  = runExport;
    s.onerror = function() { EngineShared.showToast('Failed to load PDF library'); };
    document.head.appendChild(s);
  }
};

EngineTracker.updateDashboardBadge();

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS & HELP CARD
   ═══════════════════════════════════════════════════════════ */

/* Inject CSS for keyboard help card */
var _kbStyle = document.createElement('style');
_kbStyle.textContent = `
.kb-help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  z-index: 2000;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  opacity: 0;
  transition: opacity 0.2s ease-out;
}
.kb-help-overlay.open {
  display: flex;
  opacity: 1;
}
.kb-help-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1.5rem 1.75rem;
  max-width: 440px;
  width: 100%;
  box-shadow: 0 6px 32px rgba(0,0,0,0.4);
  position: relative;
}
.kb-help-card h3 {
  font-family: 'Playfair Display', serif;
  font-size: 1.2rem;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.kb-help-card .kb-close-btn {
  position: absolute;
  top: 0.85rem;
  right: 0.85rem;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition);
  font-size: 0.85rem;
}
.kb-help-card .kb-close-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.kb-shortcut-list {
  display: grid;
  gap: 0.5rem;
}
.kb-shortcut-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.4rem 0;
}
.kb-shortcut-item:not(:last-child) {
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.5rem;
}
.kb-keys {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
  min-width: 90px;
}
.kb-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 0.35rem;
  border-radius: 4px;
  background: var(--surface2);
  border: 1px solid var(--border);
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text);
  font-family: 'Outfit', sans-serif;
}
.kb-desc {
  font-size: 0.82rem;
  color: var(--text-muted);
  flex: 1;
}
.kb-hint {
  margin-top: 0.85rem;
  padding: 0.5rem 0.75rem;
  background: var(--accent-dim);
  border-radius: 6px;
  font-size: 0.75rem;
  color: var(--text-muted);
  text-align: center;
}
.kb-hint strong { color: var(--accent); }
`;
document.head.appendChild(_kbStyle);

var _kbHelpHTML = '';
_kbHelpHTML += '<div class="kb-help-overlay" id="kb-help-overlay" onclick="if(event.target===this)closeKbHelp()">';
_kbHelpHTML += '  <div class="kb-help-card">';
_kbHelpHTML += '    <button class="kb-close-btn" onclick="closeKbHelp()">✕</button>';
_kbHelpHTML += '    <h3>⌨️ Keyboard Shortcuts</h3>';
_kbHelpHTML += '    <div class="kb-shortcut-list">';

_kbHelpHTML += '      <div class="kb-shortcut-item">';
_kbHelpHTML += '        <div class="kb-keys"><span class="kb-key">←</span><span class="kb-key">→</span></div>';
_kbHelpHTML += '        <div class="kb-desc">Previous / Next question</div>';
_kbHelpHTML += '      </div>';
_kbHelpHTML += '      <div class="kb-shortcut-item">';
_kbHelpHTML += '        <div class="kb-keys"><span class="kb-key">F</span></div>';
_kbHelpHTML += '        <div class="kb-desc">Toggle flag</div>';
_kbHelpHTML += '      </div>';
_kbHelpHTML += '      <div class="kb-shortcut-item">';
_kbHelpHTML += '        <div class="kb-keys"><span class="kb-key">H</span></div>';
_kbHelpHTML += '        <div class="kb-desc">Toggle highlighter mode</div>';
_kbHelpHTML += '      </div>';
_kbHelpHTML += '      <div class="kb-shortcut-item">';
_kbHelpHTML += '        <div class="kb-keys"><span class="kb-key">1</span><span class="kb-key">2</span><span class="kb-key">3</span><span class="kb-key">4</span></div>';
_kbHelpHTML += '        <div class="kb-desc">Highlight color (Yellow / Green / Blue / Red)</div>';
_kbHelpHTML += '      </div>';
_kbHelpHTML += '      <div class="kb-shortcut-item">';
_kbHelpHTML += '        <div class="kb-keys"><span class="kb-key">S</span></div>';
_kbHelpHTML += '        <div class="kb-desc">Strikethrough (highlighter mode)</div>';
_kbHelpHTML += '      </div>';
_kbHelpHTML += '      <div class="kb-shortcut-item">';
_kbHelpHTML += '        <div class="kb-keys"><span class="kb-key">Enter</span></div>';
_kbHelpHTML += '        <div class="kb-desc">Submit quiz</div>';
_kbHelpHTML += '      </div>';

_kbHelpHTML += '    </div>';
_kbHelpHTML += '    <div class="kb-hint">Press <strong>/</strong> to show/hide this help</div>';
_kbHelpHTML += '  </div>';
_kbHelpHTML += '</div>';

var _kbDiv = document.createElement('div');
_kbDiv.innerHTML = _kbHelpHTML;
document.body.appendChild(_kbDiv);

window.openKbHelp = function() {
  var overlay = document.getElementById('kb-help-overlay');
  if (overlay) overlay.classList.add('open');
};
window.closeKbHelp = function() {
  var overlay = document.getElementById('kb-help-overlay');
  if (overlay) overlay.classList.remove('open');
};
function toggleKbHelp() {
  var overlay = document.getElementById('kb-help-overlay');
  if (overlay && overlay.classList.contains('open')) {
    closeKbHelp();
  } else {
    openKbHelp();
  }
}

/* ── Animation Helpers ─────────────────────────────────────── */
(function () {
  'use strict';

  /* 1. Ripple effect for primary buttons */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.btn-start, .btn-nav.primary, .btn-restart');
    if (!btn) return;
    var wave = document.createElement('span');
    wave.className = 'ripple-wave';
    var r = btn.getBoundingClientRect();
    wave.style.left = (e.clientX - r.left) + 'px';
    wave.style.top  = (e.clientY - r.top)  + 'px';
    btn.appendChild(wave);
    wave.addEventListener('animationend', function () { wave.remove(); });
  });

  /* 2. Theme toggle spin */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.theme-toggle-btn, #theme-toggle');
    if (!btn) return;
    btn.classList.remove('theme-spinning');
    void btn.offsetWidth;
    btn.classList.add('theme-spinning');
    btn.addEventListener('animationend', function () {
      btn.classList.remove('theme-spinning');
    }, { once: true });
  });

  /* 3. Smooth screen transitions */
  var _origShowScreen = window.showScreen;
  if (_origShowScreen) {
    window.showScreen = function (id) {
      var current = document.querySelector('.screen.active');
      var target = document.getElementById(id);
      if (current === target || !current) {
        _origShowScreen(id);
        return;
      }
      current.style.opacity = '0';
      setTimeout(function () {
        current.classList.remove('active');
        current.style.opacity = '';
        _origShowScreen(id);
      }, 150);
    };
  }
})();
