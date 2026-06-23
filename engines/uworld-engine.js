(function() {
  'use strict';

  var ENGINE_BASE = EngineShared.ENGINE_BASE || (window.__QUIZ_ENGINE_BASE || '');

  window.toggleTheme = EngineShared.toggleTheme;
  window.navigateToIndex = EngineShared.navigateToIndex;
  window.updateThemeIcon = EngineShared.updateThemeIcon;

  /* ═══════════════════════════════════════════
     STYLESHEET INJECTION (UWorld Skin — overrides)
     ═══════════════════════════════════════════ */
  var _style = document.createElement('style');
  _style.textContent = `
/* ── UWorld Theme variables (override engine-shared defaults) ── */
:root {
  --bg: #0b0f19;
  --bg-pane: #0d1117;
  --bg-explanation: #0f172a;
  --surface: #1e293b;
  --surface2: #334155;
  --border: #334155;
  --border-dim: rgba(71, 85, 105, 0.4);
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --accent: #1396f4;
  --accent-dim: rgba(19, 150, 244, 0.15);
  --coverage-start: #38bdf8;
  
  --correct: #10b981;
  --correct-bg: rgba(16, 185, 129, 0.12);
  --wrong: #ef4444;
  --wrong-bg: rgba(239, 68, 68, 0.12);
  --flagged: #f59e0b;
  --flagged-bg: rgba(245, 158, 11, 0.12);
  
  --header-bg: #004976;
  --footer-bg: #002d4b;
  --opt-circle-border: #475569;
  
  --font-sans: 'Inter', sans-serif;
  --font-display: 'Outfit', sans-serif;
  --transition: 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  --ease-out    : cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring : cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-in-out : cubic-bezier(0.65, 0, 0.35, 1);
}

[data-theme="light"] {
  --bg: #f5f7fa;
  --bg-pane: #ffffff;
  --bg-explanation: #eef2f7;
  --surface: #dde3ec;
  --surface2: #c8d0dc;
  --border: #c0cad8;
  --border-dim: rgba(160, 174, 192, 0.45);
  --text: #1a2332;
  --text-muted: #5a6a7e;
  --accent: #0066b8;
  --accent-dim: rgba(0, 102, 184, 0.12);
  --coverage-start: #0ea5e9;
  --opt-circle-border: #8899aa;
  --header-bg: #0066b8;
  --footer-bg: #004f8c;
  --correct: #0a9b6e;
  --correct-bg: rgba(10, 155, 110, 0.10);
  --wrong: #d93535;
  --wrong-bg: rgba(217, 53, 53, 0.10);
  --flagged: #d97706;
  --flagged-bg: rgba(217, 119, 6, 0.10);
}

/* ── START SCREEN CUSTOM STYLING ───────────────────────────────── */
#start-screen {
  background: radial-gradient(circle at top, #0f172a 0%, #020617 100%);
  align-items: center; justify-content: center;
  overflow-y: auto; padding: 40px 20px;
}
[data-theme="light"] #start-screen {
  background: radial-gradient(circle at top, #f1f5f9 0%, #cbd5e1 100%);
}

.start-card {
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid var(--border);
  backdrop-filter: blur(16px);
  border-radius: 20px;
  padding: 40px;
  max-width: 680px; width: 100%;
  box-sizing: border-box;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  text-align: center;
}
[data-theme="light"] .start-card {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 20px 40px rgba(0,0,0,0.1);
}

.start-icon {
  font-size: 3.5rem; margin-bottom: 16px;
  filter: drop-shadow(0 4px 10px rgba(19, 150, 244, 0.4));
}
.start-card h1 {
  font-family: var(--font-display);
  font-size: 2.2rem; margin: 0 0 8px;
  color: var(--text); font-weight: 700;
}
.start-card .subtitle {
  color: var(--text-muted); font-size: 1.05rem; margin: 0 0 32px;
}

/* Stats Row */
.bank-stats-row {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 16px; margin-bottom: 28px;
}
.bank-stat-box {
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid var(--border);
  border-radius: 12px; padding: 14px;
  text-align: center;
}
[data-theme="light"] .bank-stat-box {
  background: rgba(241, 245, 249, 0.7);
}
.bank-stat-box .bsv {
  display: block; font-size: 1.6rem; font-weight: 700;
  color: var(--accent); font-family: var(--font-display);
}
.bank-stat-box .bsl {
  font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;
}

/* Coverage Bar */
.coverage-wrap {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid var(--border-dim);
  border-radius: 12px; padding: 16px; margin-bottom: 32px;
}
[data-theme="light"] .coverage-wrap {
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid var(--border);
}
.coverage-label {
  display: flex; justify-content: space-between;
  font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;
}
[data-theme="light"] .coverage-label {
  color: var(--text);
}
.coverage-bar {
  background: var(--surface); border-radius: 6px; height: 10px; overflow: hidden;
}
[data-theme="light"] .coverage-bar {
  background: var(--surface2);
}
.coverage-fill {
  background: linear-gradient(90deg, var(--coverage-start), var(--accent));
  height: 100%; border-radius: 6px; transition: width 0.6s ease;
}

/* Setting section */
.setting-section {
  text-align: left; margin-bottom: 20px;
}
.section-label {
  font-size: 0.9rem; font-weight: 600; color: var(--text-muted);
  margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;
}
.time-controls {
  display: flex; gap: 8px; align-items: center;
}
.time-adj-btn {
  background: var(--surface); border: 1px solid var(--border);
  color: var(--text); border-radius: 8px;
  width: 44px; height: 44px; font-size: 0.95rem; font-weight: 600;
  cursor: pointer; transition: all var(--transition);
}
.time-adj-btn:hover {
  background: var(--surface2); border-color: var(--accent); color: var(--accent);
}
.time-input {
  flex-grow: 1; height: 44px; text-align: center;
  background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border);
  color: var(--text); font-size: 1.1rem; font-weight: 600; border-radius: 8px;
  font-family: var(--font-display);
}
[data-theme="light"] .time-input {
  background: #ffffff;
}

/* Mode grid */
.mode-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.mode-label {
  cursor: pointer; position: relative; display: block;
}
.mode-label input[type="radio"] {
  display: none;
}
.mode-option {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px; text-align: center;
  font-weight: 600; font-size: 0.95rem; color: var(--text-muted);
  transition: all var(--transition);
}
.mode-option:hover {
  border-color: var(--accent); color: var(--text);
}
.mode-selected {
  background: var(--accent-dim) !important;
  border-color: var(--accent) !important;
  color: var(--text) !important;
  box-shadow: 0 0 0 1px var(--accent);
}

.btn-start {
  background: var(--accent); color: #ffffff;
  font-family: var(--font-display); font-size: 1.15rem; font-weight: 700;
  border: none; border-radius: 12px; width: 100%; padding: 14px;
  cursor: pointer; margin-top: 24px; box-shadow: 0 4px 14px var(--accent-dim);
  transition: all var(--transition);
}
.btn-start:hover {
  opacity: 0.95; transform: translateY(-2px);
}
.reset-bank-btn {
  background: transparent; border: none; color: var(--text-muted);
  font-size: 0.85rem; font-weight: 500; cursor: pointer;
  margin-top: 16px; transition: color var(--transition);
}
.reset-bank-btn:hover {
  color: var(--wrong);
}

.hub-back-btn {
  position: absolute; top: 24px; left: 24px;
  display: flex; align-items: center; gap: 6px;
  color: var(--text-muted); text-decoration: none; font-weight: 500;
  font-size: 0.9rem; padding: 8px 14px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg-pane);
  transition: all var(--transition);
}
.hub-back-btn:hover {
  border-color: var(--accent); color: var(--text);
}
.theme-btn-fixed {
  position: absolute; top: 24px; right: 24px;
  background: var(--bg-pane); border: 1px solid var(--border);
  color: var(--text-muted); width: 38px; height: 38px; border-radius: 8px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all var(--transition);
}
.theme-btn-fixed:hover {
  border-color: var(--accent); color: var(--text);
}

/* ── CBT PLAYER SHELL ─────────────────────────────────────────── */
.cbt-header {
  background: var(--header-bg); height: 50px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px; box-sizing: border-box;
  color: #ffffff; z-index: 100;
}
.cbt-header-left {
  display: flex; align-items: center; gap: 16px;
}
.cbt-header-status {
  font-size: 0.9rem; font-weight: 600;
}
.cbt-header-status span {
  opacity: 0.6; font-weight: 400; margin-left: 6px;
}
.cbt-mark-btn {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.85rem; font-weight: 600; cursor: pointer;
  color: #ffffff; padding: 4px 10px;
  border-radius: 4px; border: 1px solid rgba(255,255,255,0.25);
  transition: all var(--transition);
  position: relative;
  background: rgba(255,255,255,0.08);
}
.cbt-mark-btn:hover {
  background: rgba(255,255,255,0.1);
}
.cbt-mark-btn.active {
  background: var(--flagged-bg); border-color: var(--flagged); color: var(--flagged);
  box-shadow: 0 0 0 1px var(--flagged);
}
.cbt-mark-btn.active::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--flagged);
  opacity: 0.1;
  border-radius: 4px;
  pointer-events: none;
}
.cbt-mark-btn.active:hover {
  background: var(--flagged-bg);
  opacity: 0.9;
}

.cbt-header-center {
  display: flex; align-items: center; gap: 4px;
}
.cbt-nav-arrow {
  background: transparent; border: none; color: #ffffff;
  padding: 4px 12px; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; font-size: 0.65rem; font-weight: bold;
  opacity: 0.85; transition: opacity var(--transition);
}
.cbt-nav-arrow:hover {
  opacity: 1;
}
.cbt-nav-arrow svg {
  margin-bottom: 2px;
}

.cbt-header-right {
  display: flex; align-items: center; gap: 12px;
}
.cbt-utility-btn {
  background: transparent; border: none; color: #ffffff;
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer; font-size: 0.65rem; font-weight: 600;
  opacity: 0.8; transition: opacity var(--transition);
}
.cbt-utility-btn:hover {
  opacity: 1;
}
.cbt-utility-btn svg {
  margin-bottom: 4px; height: 16px; width: 16px;
}

/* Zoom widget */
.zoom-controls {
  display: flex; border: 1px solid rgba(255,255,255,0.25);
  border-radius: 4px; overflow: hidden; background: rgba(0,0,0,0.15);
}
.zoom-btn {
  background: transparent; border: none; color: #ffffff;
  padding: 4px 10px; font-size: 0.75rem; font-weight: 600; cursor: pointer;
  opacity: 0.6; transition: all var(--transition);
}
.zoom-btn:hover {
  opacity: 0.9; background: rgba(255,255,255,0.06);
}
.zoom-btn.active {
  opacity: 1; background: rgba(255,255,255,0.15);
}

/* Split screen container */
.cbt-split-container {
  display: grid; grid-template-columns: 55% 45%;
  height: 100%;
  flex: 1; width: auto; overflow: hidden;
  background: var(--bg);
}
.cbt-split-container.collapsed-explanation {
  grid-template-columns: 100% 0%;
}

.cbt-left-pane {
  overflow-y: auto; padding: 32px 40px; box-sizing: border-box;
  background: var(--bg-pane); display: flex; flex-direction: column;
}
.cbt-right-pane {
  overflow-y: auto; padding: 32px 40px; box-sizing: border-box;
  background: var(--bg-explanation); border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
}

/* Line Numbering Vignette */
.vignette-wrap {
  display: flex; gap: 16px; margin-bottom: 24px; position: relative;
}
.line-number-gutter {
  width: 32px; text-align: right; color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace; font-size: 0.95rem;
  user-select: none; border-right: 1px solid var(--border-dim);
  padding-right: 10px; flex-shrink: 0; opacity: 0.45;
}
.vignette-text {
  flex-grow: 1; line-height: 1.6; font-size: 1.05rem;
  font-family: var(--font-sans); color: var(--text);
  outline: none; text-align: justify;
}

/* Question Prompt */
.question-prompt {
  font-size: 1.1rem; font-weight: 600; line-height: 1.65;
  margin-bottom: 28px; padding-left: 48px; box-sizing: border-box;
  color: var(--text);
}

/* Zoom Levels */
.zoom-s .vignette-text { font-size: 0.95rem; }
.zoom-s .question-prompt { font-size: 1.0rem; }
.zoom-s .option-text { font-size: 0.9rem; }
.zoom-s .explanation-box { font-size: 0.9rem; }

.zoom-m .vignette-text { font-size: 1.05rem; }
.zoom-m .question-prompt { font-size: 1.1rem; }
.zoom-m .option-text { font-size: 1.0rem; }
.zoom-m .explanation-box { font-size: 1.0rem; }

.zoom-l .vignette-text { font-size: 1.15rem; }
.zoom-l .question-prompt { font-size: 1.2rem; }
.zoom-l .option-text { font-size: 1.1rem; }
.zoom-l .explanation-box { font-size: 1.1rem; }

/* Option choice card */
.options-wrap {
  display: flex; flex-direction: column; gap: 12px;
  padding-left: 48px; box-sizing: border-box; margin-bottom: 30px;
}
.option-card {
  display: flex; align-items: center;
  padding: 14px 18px; border: 1.5px solid var(--border);
  border-radius: 8px; background: var(--bg);
  cursor: pointer; transition: all 0.15s ease;
  position: relative; overflow: hidden;
}
.option-card:hover {
  border-color: var(--accent);
}
.option-circle {
  width: 24px; height: 24px; border-radius: 50%;
  border: 1.5px solid var(--opt-circle-border);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.85rem; font-weight: 700; margin-right: 16px;
  flex-shrink: 0; background: var(--bg-pane);
  transition: all 0.15s ease;
  color: var(--text-muted);
}
.option-text {
  font-size: 1.0rem; color: var(--text); flex-grow: 1;
  line-height: 1.5;
}
.option-strike-btn {
  width: 24px; height: 24px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--border);
  display: none; align-items: center; justify-content: center;
  color: var(--text-muted); font-size: 0.7rem; cursor: pointer;
  transition: all var(--transition); flex-shrink: 0; margin-left: 12px;
  z-index: 5;
}
.option-strike-btn:hover {
  border-color: var(--wrong); color: var(--wrong); background: var(--wrong-bg);
}
.option-card:hover .option-strike-btn {
  display: flex;
}
.option-strike-btn.active {
  display: flex !important;
  background: var(--wrong-bg); border-color: var(--wrong); color: var(--wrong);
}

/* Strikethrough card state */
.option-card.strikethrough {
  border-color: var(--border-dim); opacity: 0.45;
}
.option-card.strikethrough .option-text {
  text-decoration: line-through;
}

/* Selecting card state */
.option-card.selected {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.option-card.selected .option-circle {
  border-color: var(--accent); background: var(--accent); color: #ffffff;
}

/* Tutor mode feedback card states */
.option-card.feedback-correct {
  border-color: var(--correct) !important;
  background: var(--correct-bg) !important;
}
.option-card.feedback-correct .option-circle {
  border-color: var(--correct) !important;
  background: var(--correct) !important;
  color: #ffffff !important;
}
.option-card.feedback-correct .option-circle::after {
  content: '✓'; font-size: 0.8rem;
}
.option-card.feedback-correct .option-circle span {
  display: none;
}

.option-card.feedback-incorrect {
  border-color: var(--wrong) !important;
  background: var(--wrong-bg) !important;
}
.option-card.feedback-incorrect .option-circle {
  border-color: var(--wrong) !important;
  background: var(--wrong) !important;
  color: #ffffff !important;
}
.option-card.feedback-incorrect .option-circle::after {
  content: '✕'; font-size: 0.8rem;
}
.option-card.feedback-incorrect .option-circle span {
  display: none;
}

/* Submission Tutor Stats Bar */
.tutor-stats-bar {
  display: flex; align-items: center; border: 1.5px solid var(--border);
  background: var(--bg-explanation); border-radius: 10px;
  overflow: hidden; margin-top: auto; animation: fadeUp 0.3s var(--ease-out);
}
.tutor-stats-indicator {
  width: 8px; align-self: stretch; flex-shrink: 0;
}
.tutor-stats-indicator.correct { background: var(--correct); }
.tutor-stats-indicator.incorrect { background: var(--wrong); }

.tutor-stats-body {
  flex-grow: 1; display: grid; grid-template-columns: repeat(4, 1fr);
  padding: 16px 24px; box-sizing: border-box; text-align: center; gap: 16px;
}
.tutor-stat-item .tsv {
  display: block; font-size: 1.35rem; font-weight: 700; font-family: var(--font-display);
  color: var(--text);
}
.tutor-stat-item .tsv.correct { color: var(--correct); }
.tutor-stat-item .tsv.incorrect { color: var(--wrong); }
.tutor-stat-item .tsl {
  font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;
}

/* Explanation pane details */
.explanation-header {
  font-family: var(--font-display); font-size: 1.3rem; font-weight: 700;
  margin-bottom: 18px; border-bottom: 2px solid var(--border);
  padding-bottom: 10px; display: flex; align-items: center; justify-content: space-between;
}
.explanation-header .eh-status {
  font-size: 0.85rem; font-weight: 600; padding: 4px 10px; border-radius: 6px;
}
.eh-status.correct { background: var(--correct-bg); color: var(--correct); }
.eh-status.incorrect { background: var(--wrong-bg); color: var(--wrong); }

.explanation-body {
  line-height: 1.65; font-size: 1.0rem; color: var(--text);
}
.explanation-body p {
  margin: 0 0 16px;
}
.explanation-body strong {
  color: var(--text); font-weight: 600;
}

/* Choices breakdown list */
.choice-breakdown {
  margin-top: 28px; padding-top: 20px; border-top: 1px dashed var(--border);
}
.choice-breakdown-title {
  font-family: var(--font-display); font-weight: 700; font-size: 1.05rem;
  margin-bottom: 12px; color: var(--accent);
}
.breakdown-row {
  margin-bottom: 12px; display: flex; gap: 8px; line-height: 1.6;
}
.breakdown-row .br-key {
  font-weight: 700; color: var(--text); flex-shrink: 0; min-width: 80px;
}
.breakdown-row.correct .br-key {
  color: var(--correct);
}

/* High-yield references list */
.expl-references {
  margin-top: 32px; padding: 18px; background: rgba(30, 41, 59, 0.4);
  border: 1.5px solid rgba(71, 85, 105, 0.5); border-radius: 8px;
}
[data-theme="light"] .expl-references {
  background: rgba(241, 245, 249, 0.6);
  border: 1.5px solid rgba(160, 174, 192, 0.6);
}
.expl-references li {
  color: var(--text-muted);
}
.expl-references a {
  color: var(--accent); text-decoration: none; font-weight: 500;
}
.expl-references a:hover {
  text-decoration: underline;
}
.expl-references-title {
  font-family: var(--font-display); font-weight: 700; font-size: 0.95rem;
  margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);
}
.expl-references ul {
  margin: 0; padding-left: 20px;
}

/* ── CBT TIMER FOOTER ─────────────────────────────────────────── */
.cbt-footer {
  background: var(--footer-bg); height: 50px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; box-sizing: border-box;
  color: #ffffff; z-index: 100; border-top: 1px solid rgba(255,255,255,0.1);
}
.cbt-footer-left {
  display: flex; align-items: center; gap: 20px;
}
.cbt-timer {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.95rem; font-weight: 600; font-family: 'JetBrains Mono', monospace;
}
.cbt-timer.warn {
  color: var(--wrong); animation: pulse 1s infinite;
}
.cbt-lock-btn {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
  color: #ffffff; padding: 4px 12px; border-radius: 4px; cursor: pointer;
  font-size: 0.8rem; font-weight: 600; transition: all var(--transition);
}
.cbt-lock-btn:hover {
  background: rgba(255,255,255,0.15);
}

.cbt-footer-right {
  display: flex; align-items: center; gap: 12px;
}
.cbt-end-btn {
  background: var(--wrong); color: #ffffff;
  border: none; border-radius: 16px; padding: 6px 18px;
  font-size: 0.85rem; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3);
  transition: all var(--transition);
}
.cbt-end-btn:hover {
  opacity: 0.9; transform: translateY(-1px);
}

/* ── FLOATING CALCULATOR ──────────────────────────────────────── */
.floating-calc {
  position: absolute; top: 120px; right: 80px;
  width: 220px; background: var(--surface); border: 1.5px solid var(--border);
  border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,0.5);
  z-index: 10000; overflow: hidden; display: none;
  font-family: 'JetBrains Mono', monospace;
}
[data-theme="light"] .floating-calc { box-shadow: 0 12px 30px rgba(0,0,0,0.15); }
.calc-header {
  background: var(--surface2); padding: 8px 12px; cursor: move;
  display: flex; align-items: center; justify-content: space-between;
  font-weight: 700; font-size: 0.8rem; color: var(--text);
  user-select: none; -webkit-user-select: none;
}
.calc-close {
  cursor: pointer; opacity: 0.7; transition: opacity 0.15s; font-size: 0.9rem;
}
.calc-close:hover {
  opacity: 1; color: var(--wrong);
}
.calc-screen {
  width: 100%; height: 46px; background: var(--bg); border: none;
  padding: 8px 14px; font-size: 1.35rem; text-align: right;
  color: var(--accent); box-sizing: border-box; font-weight: 500;
  outline: none;
}
.calc-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  background: var(--border); padding: 1px;
}
.calc-btn {
  background: var(--surface); border: none; color: var(--text); height: 38px;
  font-size: 0.95rem; font-weight: 500; cursor: pointer;
  transition: background 0.1s;
}
.calc-btn:hover {
  background: var(--surface2);
}
.calc-btn.op {
  background: var(--bg); color: var(--accent);
}
.calc-btn.op:hover {
  background: var(--surface);
}
.calc-btn.equals {
  background: var(--accent); color: #ffffff; grid-column: span 2;
}
.calc-btn.equals:hover {
  opacity: 0.9;
}
.calc-btn.clear {
  color: var(--wrong);
}

/* ── SLIDING DRAWERS ──────────────────────────────────────────── */
.cbt-drawer {
  position: absolute; top: 50px; right: -450px;
  width: 440px; height: calc(100vh - 50px - 50px);
  background: var(--bg-pane); border-left: 2px solid var(--border);
  box-shadow: -10px 0 30px rgba(0,0,0,0.3);
  z-index: 500; display: flex; flex-direction: column;
  transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.cbt-drawer.open {
  right: 0;
}
.drawer-header {
  padding: 16px 20px; border-bottom: 1.5px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg-explanation);
  border: 1.5px solid var(--border-dim);
}
.drawer-title {
  font-family: var(--font-display); font-weight: 700; font-size: 1.15rem;
  color: var(--text);
}
.drawer-close {
  background: transparent; border: none; color: var(--text-muted);
  font-size: 1.2rem; cursor: pointer; transition: color var(--transition);
}
.drawer-close:hover {
  color: var(--wrong);
}
.drawer-content {
  flex-grow: 1; overflow-y: auto; padding: 20px; box-sizing: border-box;
}

/* Lab values tab container */
.lab-tabs {
  display: flex; gap: 4px; border-bottom: 1px solid var(--border);
  margin-bottom: 16px; padding-bottom: 8px;
}
.lab-tab-btn {
  background: transparent; border: none; color: var(--text-muted);
  font-size: 0.85rem; font-weight: 600; padding: 6px 12px; cursor: pointer;
  border-radius: 6px; transition: all var(--transition);
}
.lab-tab-btn:hover {
  color: var(--text); background: var(--accent-dim);
}
.lab-tab-btn.active {
  color: var(--accent); background: var(--accent-dim);
}

.lab-search-input {
  width: 100%; height: 38px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--text); padding: 0 12px; margin-bottom: 16px;
  box-sizing: border-box; outline: none; font-size: 0.9rem;
}
.lab-search-input:focus {
  border-color: var(--accent);
}

.lab-table-wrap {
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
}
.lab-table {
  width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;
}
.lab-table th {
  background: var(--bg-explanation); padding: 10px 12px;
  border-bottom: 1px solid var(--border); font-weight: 600; color: var(--text-muted);
}
.lab-table td {
  padding: 10px 12px; border-bottom: 1px solid var(--border-dim);
  line-height: 1.45; color: var(--text);
}
.lab-table tr:last-child td {
  border-bottom: none;
}
.lab-table tr:hover td {
  background: var(--accent-dim);
}

/* Notepad styles */
.notepad-textarea {
  width: 100%; height: 260px; background: var(--bg);
  border: 1.5px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 14px; box-sizing: border-box;
  font-family: inherit; font-size: 0.95rem; line-height: 1.5;
  outline: none; resize: none; margin-bottom: 16px;
}
.notepad-textarea:focus {
  border-color: var(--accent);
}
.notepad-save-btn {
  background: var(--accent); color: #ffffff; font-weight: 700;
  border: none; border-radius: 8px; padding: 10px 20px;
  cursor: pointer; font-size: 0.9rem; transition: opacity var(--transition);
}
.notepad-save-btn:hover {
  opacity: 0.9;
}

/* ── UWORLD LEFT SIDEBAR & HIGH-FIDELITY LAYOUT ────────────────── */
.cbt-main-layout {
  display: flex;
  flex-direction: row;
  flex: 1;
  width: 100vw;
  height: calc(100vh - 50px - 50px);
  overflow: hidden;
  position: relative;
}
.cbt-nav-pane {
  width: 46px;
  height: 100%;
  background: var(--bg-pane);
  border-right: 1.5px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.2s ease, opacity 0.2s ease;
  overflow: hidden;
  z-index: 90;
}
.cbt-nav-pane.collapsed {
  width: 0 !important;
  border-right: none !important;
  opacity: 0;
  pointer-events: none;
}
.cbt-nav-grid-wrap {
  flex-grow: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
}
.cbt-nav-grid-wrap::-webkit-scrollbar {
  width: 3px;
}
.cbt-nav-grid-wrap::-webkit-scrollbar-thumb {
  background: var(--border-dim);
  border-radius: 1.5px;
}
.cbt-nav-grid {
  display: flex;
  flex-direction: column;
  width: 100%;
}
.cbt-nav-btn {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 6px;
  height: 32px;
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--border-dim);
  background: var(--bg-pane);
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  position: relative;
  transition: all 0.1s ease;
  box-sizing: border-box;
}
.cbt-nav-btn:nth-child(odd) {
  background: var(--cbt-sidebar-odd, var(--bg-pane));
}
.cbt-nav-btn:nth-child(even) {
  background: var(--cbt-sidebar-even, var(--surface));
}
[data-theme="light"] .cbt-nav-btn:nth-child(odd) {
  background: var(--bg-pane);
}
[data-theme="light"] .cbt-nav-btn:nth-child(even) {
  background: var(--surface);
}
.cbt-nav-btn:hover {
  background: var(--border-dim) !important;
  color: var(--text);
}
.cbt-nav-btn.current {
  background: var(--accent) !important;
  color: #ffffff !important;
}
.cbt-nav-btn.current .unanswered-dot {
  color: rgba(255, 255, 255, 0.8) !important;
}
.cbt-nav-btn.current .marked-triangle {
  color: #ffffff !important;
}
.cbt-nav-btn.answered {
  color: var(--text);
}
.cbt-nav-btn.answered .unanswered-dot {
  display: none !important;
}
.cbt-nav-btn .unanswered-dot {
  color: var(--flagged);
  font-size: 1.25rem;
  margin-right: 2px;
  line-height: 1;
  display: inline-block;
  flex-shrink: 0;
  width: 8px;
}
.cbt-nav-btn .q-num {
  flex-grow: 1;
  text-align: left;
  padding-left: 2px;
}
.cbt-nav-btn .marked-triangle {
  color: var(--flagged);
  font-size: 0.6rem;
  display: none;
  margin-left: auto;
  flex-shrink: 0;
}
.cbt-nav-btn.flagged .marked-triangle {
  display: inline-block !important;
}

/* ── LIGHT MODE OVERRIDES: Drawers ────────────────────────────────── */
[data-theme="light"] .cbt-drawer { box-shadow: -10px 0 30px rgba(0,0,0,0.08); }
[data-theme="light"] .drawer-header { border-color: var(--border); }

/* ── LIGHT MODE OVERRIDES: Option strike btn in highlighter mode ─── */
[data-theme="light"] .option-strike-btn { background: var(--surface2); }

.hl-color-btn {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.12s ease;
}
.hl-color-btn:hover {
  transform: scale(1.15);
}
.hl-color-btn.hl-c1 { background: rgba(255,213,79,0.7); }
.hl-color-btn.hl-c2 { background: rgba(129,199,132,0.7); }
.hl-color-btn.hl-c3 { background: rgba(244,143,177,0.7); }
.hl-color-btn.hl-c4 { background: rgba(100,181,246,0.7); }

.hl-erase-btn {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  color: var(--text-muted);
  transition: all 0.12s ease;
}
.hl-erase-btn:hover {
  border-color: var(--wrong);
  color: var(--wrong);
}
.hl-erase-btn.active {
  background: var(--wrong-bg);
  border-color: var(--wrong);
  color: var(--wrong);
}
.hl-close-btn {
  width: 22px;
  height: 22px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 2px;
  transition: all 0.12s ease;
}
.hl-close-btn:hover {
  background: var(--wrong-bg);
  color: var(--wrong);
}

.hl-color-picker {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 6px;
  z-index: 9001;
  display: none;
  align-items: center;
  gap: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 5px 7px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);
}
.hl-color-picker.visible {
  display: flex !important;
}

.highlighter-active .vignette-text,
.highlighter-active .question-prompt,
.highlighter-active .option-text,
.highlighter-active .explanation-body {
  cursor: text !important;
  user-select: text !important;
  -webkit-user-select: text !important;
}

/* ── RESULTS OVERRIDES ────────────────────────────────────────── */
.result-topbar {
  background: var(--header-bg); height: 50px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; box-sizing: border-box; color: #ffffff;
  flex-shrink: 0;
}
.result-topbar h2 {
  font-family: var(--font-display); font-size: 1.15rem; font-weight: 700; margin: 0;
  letter-spacing: -0.01em;
}
.topbar-actions {
  display: flex; align-items: center; gap: 8px;
}
.result-body {
  flex-grow: 1; overflow-y: auto; padding: 32px 40px; box-sizing: border-box;
  background: var(--bg-pane); display: flex; flex-direction: column; align-items: center;
}

.score-banner {
  background: var(--surface); border: 1.5px solid var(--border);
  border-radius: 16px; padding: 28px 36px; display: flex; gap: 32px;
  align-items: center; max-width: 780px; width: 100%; box-sizing: border-box;
  margin-bottom: 24px;
}
[data-theme="light"] .score-banner {
  background: var(--bg-pane);
  box-shadow: 0 2px 12px rgba(0,0,0,0.07);
}
.score-circle {
  width: 110px; height: 110px; border-radius: 50%;
  border: 4px solid var(--accent); display: flex; flex-direction: column;
  align-items: center; justify-content: center; background: var(--accent-dim);
  flex-shrink: 0;
}
.score-circle .pct {
  font-family: var(--font-display); font-size: 1.9rem; font-weight: 700;
  color: var(--accent); line-height: 1;
}
.score-circle .lbl {
  font-size: 0.72rem; text-transform: uppercase; color: var(--text-muted);
  letter-spacing: 0.06em; margin-top: 3px; font-weight: 600;
}
.score-details {
  flex-grow: 1;
}
.score-details h3 {
  font-family: var(--font-display); font-size: 1.3rem; font-weight: 700;
  margin: 0 0 14px; color: var(--text);
}
.score-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
}
.score-stat {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 10px; padding: 9px 10px; text-align: center;
}
[data-theme="light"] .score-stat {
  background: var(--bg-explanation);
}
.score-stat .n {
  display: block; font-size: 1.2rem; font-weight: 700; font-family: var(--font-display);
  color: var(--text);
}
.score-stat .n.green { color: var(--correct); }
.score-stat .n.red { color: var(--wrong); }
.score-stat .n.blue { color: var(--accent); }
.score-stat .n.muted { color: var(--text-muted); }
.score-stat .n.time { color: var(--accent); }
.score-stat .t {
  font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; font-weight: 500;
}

/* PDF export styling */
.pdf-export-section {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px 20px; max-width: 780px; width: 100%;
  box-sizing: border-box; margin-bottom: 24px;
}
[data-theme="light"] .pdf-export-section {
  background: var(--bg-pane);
}
.export-options {
  display: flex; gap: 20px;
}
.export-option {
  display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9rem;
}
.export-option input {
  display: none;
}
.export-checkbox-visual {
  width: 18px; height: 18px; border: 1.5px solid var(--border);
  border-radius: 4px; display: flex; align-items: center; justify-content: center;
  transition: all var(--transition);
}
.export-checkbox-visual svg {
  width: 12px; height: 12px; stroke: #ffffff; stroke-width: 3.5; fill: none; display: none;
}
.export-option input:checked + .export-checkbox-visual {
  background: var(--accent); border-color: var(--accent);
}
.export-option input:checked + .export-checkbox-visual svg {
  display: block;
}
.export-label {
  font-weight: 600;
  color: var(--text);
}
.export-badge {
  background: var(--surface); color: var(--text-muted); font-weight: 600;
  font-size: 0.75rem; padding: 2px 6px; border-radius: 6px;
}

.btn-export-pdf {
  background: var(--surface); border: 1.5px solid var(--border);
  color: var(--text); border-radius: 8px; padding: 8px 18px;
  font-size: 0.9rem; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; gap: 8px; transition: all var(--transition);
}
.btn-export-pdf:hover {
  border-color: var(--accent); color: var(--accent);
}

/* Results tabs and list */
.result-tabs {
  display: flex; gap: 6px; border-bottom: 1.5px solid var(--border);
  max-width: 780px; width: 100%; box-sizing: border-box; margin-bottom: 20px;
}
.tab-btn {
  background: transparent; border: none; color: var(--text-muted);
  font-size: 0.9rem; font-weight: 600; padding: 10px 16px; cursor: pointer;
  border-bottom: 2.5px solid transparent; transition: all var(--transition);
}
.tab-btn:hover {
  color: var(--text);
}
.tab-btn.active {
  color: var(--accent); border-bottom-color: var(--accent);
}

.result-list {
  max-width: 780px; width: 100%; display: flex; flex-direction: column; gap: 12px;
  margin-bottom: 32px;
}
.result-item {
  border: 1.5px solid var(--border); border-radius: 10px; background: var(--bg);
  overflow: hidden; transition: all var(--transition);
}
.result-item-header {
  display: flex; align-items: center; padding: 14px 20px; cursor: pointer; gap: 14px;
}
.result-item-header:hover {
  background: var(--accent-dim);
}
.result-status-icon {
  width: 24px; height: 24px; border-radius: 6px; display: flex;
  align-items: center; justify-content: center; font-weight: 700; font-size: 0.95rem;
}
.result-item.correct .result-status-icon { background: var(--correct-bg); color: var(--correct); }
.result-item.wrong .result-status-icon { background: var(--wrong-bg); color: var(--wrong); }
.result-item.skipped .result-status-icon { background: var(--surface); color: var(--text-muted); }

.result-q-meta {
  flex-grow: 1;
}
.result-q-num {
  font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);
  letter-spacing: 0.05em; font-weight: 600; margin-bottom: 2px;
}
.result-q-text {
  font-size: 0.95rem; line-height: 1.45; font-weight: 500;
  color: var(--text);
}
.expand-arrow {
  font-size: 0.75rem; color: var(--text-muted); transition: transform 0.2s;
}
.result-item-header.open .expand-arrow {
  transform: rotate(180deg);
}

.result-item-body {
  display: none; padding: 18px 20px; border-top: 1.5px solid var(--border);
  background: var(--bg-explanation); line-height: 1.6; font-size: 0.95rem;
  color: var(--text);
}
.result-item-body.open {
  display: block;
}
.answer-row {
  padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-dim);
  margin-bottom: 8px; font-weight: 500;
  color: var(--text);
}
.answer-row.your-answer { background: var(--wrong-bg); border-color: var(--wrong); }
.answer-row.your-answer.is-correct { background: var(--correct-bg); border-color: var(--correct); }
.answer-row.correct-answer { background: var(--correct-bg); border-color: var(--correct); }
.ar-label {
  font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted);
  font-weight: 700; margin-right: 8px; opacity: 0.7;
}
.result-item-body .explanation-box {
  background: var(--surface2);
  border-left: 3px solid var(--accent);
  border-radius: 0 8px 8px 0;
  color: var(--text-muted);
  line-height: 1.6;
}
.result-item-body .explanation-box strong {
  color: var(--text);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: block;
  margin-bottom: 4px;
}
.result-item-body .explanation-box p {
  margin: 0;
  color: var(--text-muted);
}

.result-actions {
  display: flex; gap: 16px; max-width: 780px; width: 100%;
}
.btn-restart {
  flex-grow: 1; background: var(--accent); color: #ffffff;
  font-family: var(--font-display); font-size: 1.15rem; font-weight: 700;
  border: none; border-radius: 12px; padding: 14px; text-align: center;
  text-decoration: none; cursor: pointer; transition: all var(--transition);
}
.btn-restart:hover {
  opacity: 0.95; transform: translateY(-2px);
}
.btn-restart.btn-secondary {
  background: var(--surface); color: var(--text); border: 1.5px solid var(--border);
}
.btn-restart.btn-secondary:hover {
  background: var(--surface2); border-color: var(--accent);
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
`;
  document.head.appendChild(_style);

  /* ── Inject Animation System v2 (ported from bank-engine) ─── */
  var _animStyle = document.createElement('style');
  _animStyle.textContent = `
/* ── Easing tokens ──────────────────────────────────────────── */
/* (already in :root above) */

/* ── Screen transitions ─────────────────────────────────────── */
@keyframes screenFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Start screen entrance ──────────────────────────────────── */
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-18px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes iconPop {
  0%   { transform: scale(0.7) rotate(-8deg); opacity: 0; }
  60%  { transform: scale(1.15) rotate(4deg); }
  100% { transform: scale(1)    rotate(0deg); opacity: 1; }
}

#start-screen .start-card { animation: fadeUp 0.55s 0.05s var(--ease-out) both; }
#start-screen .start-icon { animation: iconPop 0.5s 0.15s var(--ease-spring) both; }

/* ── Card hover ─────────────────────────────────────────────── */
.start-card {
  transition:
    transform  0.32s var(--ease-out),
    box-shadow 0.32s var(--ease-out),
    border-color 0.28s var(--ease-out) !important;
}
.start-card:hover {
  transform  : translateY(-4px) scale(1.006);
  box-shadow : 0 20px 50px rgba(0,0,0,0.4);
}
.start-icon {
  transition: transform 0.35s var(--ease-spring) !important;
}
.start-card:hover .start-icon { transform: scale(1.1) rotate(-5deg); }

/* ── Stat box hover ─────────────────────────────────────────── */
.bank-stat-box {
  transition:
    transform    0.2s var(--ease-out),
    border-color 0.2s var(--ease-out) !important;
}
.bank-stat-box:hover {
  transform   : translateY(-2px);
  border-color: var(--accent) !important;
}

/* ── Button effects ─────────────────────────────────────────── */
.btn-start, .btn-restart {
  position : relative;
  overflow : hidden;
  transition:
    opacity    0.22s var(--ease-out),
    transform  0.22s var(--ease-out),
    box-shadow 0.22s var(--ease-out) !important;
}
.btn-start:hover, .btn-restart:hover {
  opacity   : 0.92 !important;
  transform : translateY(-2px) !important;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent);
}
.btn-start:active, .btn-restart:active {
  transform : scale(0.97) translateY(0) !important;
  transition-duration: 0.09s !important;
}

/* ── Ripple wave ────────────────────────────────────────────── */
@keyframes ripple {
  to { transform: scale(5); opacity: 0; }
}
.ripple-wave {
  position      : absolute;
  border-radius : 50%;
  width         : 60px;
  height        : 60px;
  margin-top    : -30px;
  margin-left   : -30px;
  background    : rgba(255, 255, 255, 0.22);
  transform     : scale(0);
  animation     : ripple 0.55s var(--ease-out) forwards;
  pointer-events: none;
}

/* ── Option card hover ──────────────────────────────────────── */
.option-card {
  transition:
    transform    0.18s var(--ease-out),
    border-color 0.18s var(--ease-out),
    background   0.18s var(--ease-out),
    opacity      0.18s var(--ease-out) !important;
}
.option-card:not(.selected):not(.feedback-correct):not(.feedback-incorrect):hover {
  transform    : translateX(3px);
  border-color : var(--accent) !important;
}

/* ── Nav sidebar buttons ────────────────────────────────────── */
.cbt-nav-btn {
  transition:
    background 0.12s var(--ease-out),
    color      0.12s var(--ease-out) !important;
}

/* ── Hub back / theme buttons ───────────────────────────────── */
.hub-back-btn, .theme-btn-fixed, .cbt-utility-btn {
  transition: all 0.22s var(--ease-out) !important;
}
.hub-back-btn:hover, .theme-btn-fixed:hover {
  transform    : translateY(-1px);
  border-color : var(--accent) !important;
}
.hub-back-btn:active, .theme-btn-fixed:active {
  transform          : scale(0.9) !important;
  transition-duration: 0.08s !important;
}

/* ── Theme toggle spin ──────────────────────────────────────── */
@keyframes spinPop {
  0%   { transform: rotate(0deg)   scale(1);    }
  40%  { transform: rotate(200deg) scale(0.85); }
  70%  { transform: rotate(320deg) scale(1.1);  }
  100% { transform: rotate(360deg) scale(1);    }
}
.theme-spinning {
  animation: spinPop 0.5s var(--ease-spring) forwards !important;
}

/* ── Mark button pulse ──────────────────────────────────────── */
@keyframes badgePulse {
  0%   { transform: scale(1);    }
  50%  { transform: scale(1.2); }
  100% { transform: scale(1);    }
}
.cbt-mark-btn.active {
  animation: badgePulse 0.35s var(--ease-spring);
}

/* ── Modal spring ───────────────────────────────────────────── */
.modal-overlay {
  transition: opacity 0.22s var(--ease-out) !important;
}
.modal {
  animation: modalIn 0.38s var(--ease-spring) both !important;
}
@keyframes modalIn {
  from { opacity: 0; transform: translateY(28px) scale(0.93); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}

/* ── Result items staggered fade-up ────────────────────────── */
.result-item {
  animation: fadeUp 0.38s var(--ease-out) both;
}
.result-item:nth-child(1) { animation-delay: 0.04s; }
.result-item:nth-child(2) { animation-delay: 0.09s; }
.result-item:nth-child(3) { animation-delay: 0.14s; }
.result-item:nth-child(4) { animation-delay: 0.19s; }
.result-item:nth-child(5) { animation-delay: 0.24s; }
.result-item:nth-child(n+6) { animation-delay: 0.28s; }

/* ── Tutor stats bar fade-up ────────────────────────────────── */
.tutor-stats-bar {
  animation: fadeUp 0.3s var(--ease-out) both;
}

/* ── Explanation pane slide-in ──────────────────────────────── */
.cbt-split-container:not(.collapsed-explanation) .cbt-right-pane {
  animation: fadeUp 0.35s var(--ease-out) both;
}

/* ── Score banner entrance ──────────────────────────────────── */
.score-banner {
  animation: fadeUp 0.5s 0.05s var(--ease-out) both;
}

/* ── Respect prefers-reduced-motion ─────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration  : 0.01ms !important;
    animation-delay     : 0ms    !important;
    transition-duration : 0.01ms !important;
  }
}
`;
  document.head.appendChild(_animStyle);

  // Inject markup structure
  document.body.innerHTML = `
<!-- START SCREEN -->
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
    <p class="subtitle" id="bank-subtitle">USMLE Computer-Based Testing Simulation</p>

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

    <div class="coverage-wrap">
      <div class="coverage-label">
        <span>Bank Coverage</span>
        <span id="coverage-pct">0%</span>
      </div>
      <div class="coverage-bar">
        <div class="coverage-fill" id="coverage-fill" style="width: 0%"></div>
      </div>
    </div>

    <div class="setting-section">
      <div class="section-label">Number of Questions</div>
      <div class="time-controls">
        <button class="time-adj-btn" onclick="adjustCount(-5)">−5</button>
        <input type="number" id="q-count-input" class="time-input" min="1" value="20" oninput="onCustomCount(this.value)">
        <button class="time-adj-btn" onclick="adjustCount(5)">+5</button>
      </div>
    </div>

    <div class="setting-section" id="time-section">
      <div class="section-label">Time Limit (mins)</div>
      <div class="time-controls">
        <button class="time-adj-btn" onclick="adjustTime(-5)">−5</button>
        <input type="number" id="time-input" class="time-input" min="1" max="300" value="30">
        <button class="time-adj-btn" onclick="adjustTime(5)">+5</button>
      </div>
    </div>

    <div class="setting-section">
      <div class="section-label">Session Mode</div>
      <div class="mode-grid">
        <label class="mode-label">
          <input type="radio" name="quiz-mode" value="learning" checked>
          <div class="mode-option">
            <div class="mo-title">📚 Tutor Mode</div>
          </div>
        </label>
        <label class="mode-label">
          <input type="radio" name="quiz-mode" value="exam">
          <div class="mode-option">
            <div class="mo-title">📝 Timed Mode</div>
          </div>
        </label>
      </div>
    </div>

    <div class="setting-section">
      <div class="section-label">Question Order</div>
      <div class="mode-grid">
        <label class="mode-label">
          <input type="radio" name="quiz-order" value="sequential" checked>
          <div class="mode-option">
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

    <button class="btn-start" onclick="startQuiz()">Start Test →</button>
    <button class="reset-bank-btn" onclick="openBankResetModal()">🗑 Reset Coverage History</button>
  </div>
</div>

<!-- Bank Reset Confirmation Modal -->
<div class="modal-overlay" id="bank-reset-modal">
  <div class="modal">
    <h3>🧹 Reset Coverage History?</h3>
    <p>This will forget which questions you have already seen and reset the covered count to 0. Your progress in any active session will NOT be affected. Continue?</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeBankResetModal()">Cancel</button>
      <button class="btn-confirm danger" onclick="confirmBankReset()">Reset Now</button>
    </div>
  </div>
</div>

<!-- CBT PLAYER SCREEN -->
<div id="quiz-screen" class="screen zoom-m">
  <!-- Topbar Header -->
  <div class="cbt-header">
    <div class="cbt-header-left">
      <button class="cbt-utility-btn" onclick="toggleNavPane()" title="Navigate block">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        <span>Index</span>
      </button>
      <div class="cbt-header-status" id="header-item-number">Item 1 of 20</div>
      <div class="cbt-header-status" style="margin-left:-8px;"><span id="header-block-number">Block 1 of 1</span></div>
      <button class="cbt-mark-btn" onclick="toggleFlagCurrent()" id="mark-btn">
        <span style="font-size:1rem;">⚑</span> Mark
      </button>
    </div>
    
    <div class="cbt-header-center">
      <button class="cbt-nav-arrow" onclick="goToPrev()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"/></svg>
        <span>PREVIOUS</span>
      </button>
      <button class="cbt-nav-arrow" onclick="goToNext()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>
        <span>NEXT</span>
      </button>
    </div>
    
    <div class="cbt-header-right">
      <button class="cbt-utility-btn" onclick="toggleLabDrawer()" title="Lab reference values">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19.48 9.44c.07-.36.11-.73.11-1.11a7.78 7.78 0 0 0-1.89-5.06l-.28-.3a1.5 1.5 0 0 0-2.22.1l-1.92 2.2a14.86 14.86 0 0 0-2.56-.26 14.73 14.73 0 0 0-2.56.26l-1.92-2.2a1.5 1.5 0 0 0-2.22-.1l-.28.3a7.78 7.78 0 0 0-1.89 5.06c0 .38.04.75.11 1.11A11.7 11.7 0 0 0 2 13v6a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-6a11.7 11.7 0 0 0-2.52-3.56z"/></svg>
        <span>Lab Values</span>
      </button>
      <button class="cbt-utility-btn" onclick="toggleNotepadDrawer()" title="Notepad scratchpad">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"/></svg>
        <span>Notes</span>
      </button>
      <button class="cbt-utility-btn" onclick="toggleCalculator()" title="Show/hide calculator">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="16" y2="18"/></svg>
        <span>Calculator</span>
      </button>
      <button class="cbt-utility-btn" onclick="toggleTheme()" title="Reverse Color Toggle">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20v-2a8 8 0 0 1 0-16z"/></svg>
        <span>Reverse Color</span>
      </button>
      
      <!-- Highlighter Widget -->
      <div style="position: relative; display: flex; align-items: center;">
        <button class="cbt-utility-btn" id="highlighter-toggle" onclick="toggleHighlighterMode()" title="Toggle Highlighter Mode (H)">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M15.24 4.31l4.45 4.45L8.73 19.72H4.28v-4.45L15.24 4.31zM3 21h18"/>
          </svg>
          <span style="display: flex; align-items: center; gap: 4px;">
            Highlight <span class="hl-color-dot" id="hl-color-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; border: 1px solid rgba(255,255,255,0.3); display: inline-block;"></span>
          </span>
        </button>
        <div class="hl-color-picker" id="hl-picker" style="display: none;">
          <button class="hl-color-btn hl-c1" onclick="hlSelectColor(1); event.stopPropagation();" title="Yellow (1)"></button>
          <button class="hl-color-btn hl-c2" onclick="hlSelectColor(2); event.stopPropagation();" title="Green (2)"></button>
          <button class="hl-color-btn hl-c3" onclick="hlSelectColor(3); event.stopPropagation();" title="Pink (3)"></button>
          <button class="hl-color-btn hl-c4" onclick="hlSelectColor(4); event.stopPropagation();" title="Blue (4)"></button>
          <button class="hl-erase-btn" onclick="hlSelectColor(0); event.stopPropagation();" title="Eraser">🧹</button>
          <button class="hl-close-btn" onclick="disableHighlighterMode(); event.stopPropagation();" title="Close Highlighter">✕</button>
        </div>
      </div>

      <div class="zoom-controls">
        <button class="zoom-btn" onclick="zoomDecrease()" title="Decrease text size">−</button>
        <button class="zoom-btn active" onclick="setZoom('m')" title="Reset to default text size">A</button>
        <button class="zoom-btn" onclick="zoomIncrease()" title="Increase text size">+</button>
      </div>
    </div>
  </div>
  
  <!-- CBT Player Body Container -->
  <div class="cbt-main-layout">
    <!-- UWorld Left docked sidebar (starts collapsed, toggled by Index button) -->
    <div class="cbt-nav-pane collapsed" id="nav-pane">
      <div class="cbt-nav-grid-wrap">
        <div class="cbt-nav-grid" id="nav-grid"></div>
      </div>
    </div>

    <!-- Split Main Pane -->
    <div class="cbt-split-container collapsed-explanation" id="cbt-split-body">
      <!-- Left column: Vignette + Options -->
      <div class="cbt-left-pane" id="cbt-left-pane">
        <div class="vignette-wrap">
          <div class="line-number-gutter" id="line-gutter"></div>
          <div class="vignette-text" id="vignette-content">Loading clinical passage...</div>
        </div>
        <div class="question-prompt" id="question-prompt">Loading clinical question...</div>
        <div class="options-wrap" id="options-wrap"></div>
        
        <!-- Tutor feedback bottom statistics bar -->
        <div class="tutor-stats-bar" id="tutor-stats" style="display:none;">
          <div class="tutor-stats-indicator" id="tutor-indicator"></div>
          <div class="tutor-stats-body">
            <div class="tutor-stat-item">
              <span class="tsv" id="tutor-status-text">Correct</span>
              <span class="tsl">Status</span>
            </div>
            <div class="tutor-stat-item">
              <span class="tsv" id="tutor-stat-pct">74%</span>
              <span class="tsl">Answered Correctly</span>
            </div>
            <div class="tutor-stat-item">
              <span class="tsv" id="tutor-stat-time">0m 18s</span>
              <span class="tsl">Time Spent</span>
            </div>
            <div class="tutor-stat-item">
              <span class="tsv">2026</span>
              <span class="tsl">UWorld Version</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Right column: Independent scroll explanation -->
      <div class="cbt-right-pane" id="cbt-right-pane">
        <div class="explanation-header">
          <span>Explanation</span>
          <span class="eh-status" id="expl-badge">Correct</span>
        </div>
        <div class="explanation-body" id="explanation-content">Loading explanations...</div>
      </div>
    </div>
  </div>
  
  <!-- Footer block controls -->
  <div class="cbt-footer">
    <div class="cbt-footer-left">
      <div class="cbt-timer" id="timer-display">
        <span>Block Time Remaining:</span>
        <span id="timer-text">00:00:00</span>
      </div>
      <button class="cbt-lock-btn" onclick="togglePauseTimer()" id="pause-btn">Pause</button>
    </div>
    <div class="cbt-footer-right">
      <button class="cbt-end-btn" onclick="attemptSubmit()">End Block</button>
    </div>
  </div>

  <!-- Slide-out Lab Values Reference -->
  <div class="cbt-drawer" id="lab-drawer">
    <div class="drawer-header">
      <span class="drawer-title">Reference Ranges</span>
      <button class="drawer-close" onclick="toggleLabDrawer()">✕</button>
    </div>
    <div class="lab-tabs">
      <button class="lab-tab-btn active" onclick="switchLabTab('serum')">Serum</button>
      <button class="lab-tab-btn" onclick="switchLabTab('csf')">CSF</button>
      <button class="lab-tab-btn" onclick="switchLabTab('blood')">Blood/ABG</button>
      <button class="lab-tab-btn" onclick="switchLabTab('urine')">Urine</button>
    </div>
    <input type="text" class="lab-search-input" id="lab-search" placeholder="Search reference ranges..." oninput="filterLabValues()">
    <div class="drawer-content" id="lab-content" style="padding:0;">
      <div class="lab-table-wrap">
        <table class="lab-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>Reference Interval</th>
            </tr>
          </thead>
          <tbody id="lab-table-body"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Slide-out Notepad Scratchpad -->
  <div class="cbt-drawer" id="notepad-drawer">
    <div class="drawer-header">
      <span class="drawer-title">Notepad Scratchpad</span>
      <button class="drawer-close" onclick="toggleNotepadDrawer()">✕</button>
    </div>
    <div class="drawer-content">
      <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 12px;line-height:1.4;">Scratchpad is shared and persists throughout your session. Auto-saves to your local cache.</p>
      <textarea class="notepad-textarea" id="notepad-text" placeholder="Type clinical notes, formulas, or mnemonic tags here..."></textarea>
      <button class="notepad-save-btn" onclick="saveNotepadText()">Save Note</button>
    </div>
  </div>

  <!-- Draggable Calculator Panel -->
  <div class="floating-calc" id="floating-calc">
    <div class="calc-header" id="calc-handle">
      <span>CALCULATOR</span>
      <span class="calc-close" onclick="toggleCalculator()">✕</span>
    </div>
    <input type="text" class="calc-screen" id="calc-screen" value="0" readonly>
    <div class="calc-grid">
      <button class="calc-btn clear" onclick="calcInput('C')">C</button>
      <button class="calc-btn op" onclick="calcInput('sqrt')">√</button>
      <button class="calc-btn op" onclick="calcInput('inv')">1/x</button>
      <button class="calc-btn op" onclick="calcInput('/')">÷</button>
      
      <button class="calc-btn" onclick="calcInput('7')">7</button>
      <button class="calc-btn" onclick="calcInput('8')">8</button>
      <button class="calc-btn" onclick="calcInput('9')">9</button>
      <button class="calc-btn op" onclick="calcInput('*')">×</button>
      
      <button class="calc-btn" onclick="calcInput('4')">4</button>
      <button class="calc-btn" onclick="calcInput('5')">5</button>
      <button class="calc-btn" onclick="calcInput('6')">6</button>
      <button class="calc-btn op" onclick="calcInput('-')">−</button>
      
      <button class="calc-btn" onclick="calcInput('1')">1</button>
      <button class="calc-btn" onclick="calcInput('2')">2</button>
      <button class="calc-btn" onclick="calcInput('3')">3</button>
      <button class="calc-btn op" onclick="calcInput('+')">+</button>
      
      <button class="calc-btn" onclick="calcInput('0')">0</button>
      <button class="calc-btn" onclick="calcInput('.')">.</button>
      <button class="calc-btn equals" onclick="calcInput('=')">=</button>
    </div>
  </div>
</div>

<!-- SESSION RESULTS SCREEN -->
<div id="result-screen" class="screen">
  <div class="result-topbar">
    <h2>📊 Session Results</h2>
    <div class="topbar-actions">
      <a href="#" class="hub-back-btn" style="position:static;" onclick="navigateToIndex(event); return false;">🏠 Hub</a>
      <button class="theme-btn-fixed" style="position:static;" onclick="toggleTheme()">☀</button>
    </div>
  </div>
  
  <div class="result-body">
    <div class="score-banner">
      <div class="score-circle">
        <div class="pct" id="res-pct">0%</div>
        <div class="lbl">Score</div>
      </div>
      <div class="score-details">
        <h3 id="res-grade">Loading grade...</h3>
        <div class="score-grid">
          <div class="score-stat"><div class="n green" id="res-correct">0</div><div class="t">Correct</div></div>
          <div class="score-stat"><div class="n red" id="res-wrong">0</div><div class="t">Wrong</div></div>
          <div class="score-stat"><div class="n blue" id="res-flagged">0</div><div class="t">Flagged</div></div>
          <div class="score-stat"><div class="n muted" id="res-skipped">0</div><div class="t">Skipped</div></div>
          <div class="score-stat"><div class="n time" id="res-time">—</div><div class="t">Time Used</div></div>
        </div>
      </div>
    </div>

    <!-- PDF Export Options -->
    <div class="pdf-export-section">
      <div class="export-options">
        <label class="export-option">
          <input type="checkbox" name="export-all" checked onchange="onExportFilterChange(this)">
          <span class="export-checkbox-visual">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="export-label">All Items</span>
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
        </svg>
        Download PDF Summary
      </button>
    </div>

    <!-- Review Tabs and Question Review Area -->
    <div class="result-tabs">
      <button class="tab-btn active" onclick="filterResults('all', this)">All Questions</button>
      <button class="tab-btn" onclick="filterResults('correct', this)">✓ Correct</button>
      <button class="tab-btn" onclick="filterResults('wrong', this)">✗ Wrong</button>
      <button class="tab-btn" onclick="filterResults('skipped', this)">— Skipped</button>
      <button class="tab-btn" onclick="filterResults('flagged', this)">⚑ Flagged</button>
    </div>
    
    <div class="result-list" id="result-list"></div>
    
    <div class="result-actions">
      <button class="btn-restart" onclick="onNewSessionClick(event)">↺ Start New Block</button>
      <a href="#" class="btn-restart btn-secondary" onclick="navigateToIndex(event); return false;">🏠 Back to Quiz Hub</a>
    </div>
  </div>
</div>

<!-- Modal confirmation panels -->
<div class="modal-overlay" id="submit-modal">
  <div class="modal">
    <h3>End This Block?</h3>
    <p>You have <span class="modal-unanswered" id="modal-unanswered">—</span> unanswered item(s) in this block. Are you sure you want to end it now?</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Go Back</button>
      <button class="btn-confirm danger" onclick="confirmSubmit()">End Block</button>
    </div>
  </div>
</div>

<!-- Reset Mid-Quiz Modal -->
<div class="modal-overlay" id="reset-modal">
  <div class="modal">
    <h3>Restart Session?</h3>
    <p>Do you want to reset your current block progress? Current answers will be cleared.</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeResetModal()">Go Back</button>
      <button class="btn-confirm danger" onclick="confirmResetAction()">Restart Block</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
`;

  // Register service worker if supported
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register(ENGINE_BASE + 'sw.js').catch(function() {});
    });
  }

  /* ═══════════════════════════════════════════
     STATE ENGINE & CONFIG
     ═══════════════════════════════════════════ */
  const KEYS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];
  
  // Selected question count
  let selectedCount = 20;
  let uiReady = false;

  // Session question tracking
  let SESSION_QUESTIONS = [];
  let SESSION_QUESTION_INDICES = [];

  // Active quiz state
  let state = {
    current: 0,
    answers: {},
    flagged: {},
    timerSecs: 0,
    elapsed: 0,
    timerID: null,
    submitted: false,
    mode: 'learning', // 'learning' = Tutor, 'exam' = Timed
    zoom: 'm',        // 's', 'm', 'l' text size
    strikethrough: {}, // { globalQIndex: { optIdx: true } }
    qTimeSpent: {},    // { qIdx: seconds } - time spent per question
    activeLabTab: 'serum',
    notepadText: '',
    highlights: {},    // { globalQIndex: [ { part, start, end, color, optIndex? } ] }
    isHighlighterMode: false
  };
  
  let timerPaused = false;
  let lastTime = Date.now();
  let submitTimeout = null;
  
  // Per-question tracking timing
  let qStartTime = Date.now();

  // Highlighter state variables
  let _hlCache = {};           // memoized highlight state per qIndex
  let _hlLastColor = 1;        // last selected highlight color (1-4), default Yellow
  let _hlPickerOpen = false;   // color picker dropdown open state
  let _hoveredOption = -1;     // option index currently hovered (-1 = none)
  let _ctxStrikeDone = false;  // flag to prevent double-toggle (mousedown + contextmenu)
  let _hlInitialized = false;  // lazy-load guard: listeners registered once
  let _hlJustApplied = false;  // set true when highlight is applied, resets after 100ms
  let _hlSelectionTimer = null;

  // Storage local keys config
  const STORAGE_VERSION = 'v1';
  const STORAGE_KEY = `uworld_progress_${STORAGE_VERSION}_${(BANK_CONFIG.uid || window.location.pathname).replace(/[^a-zA-Z0-9]/g, '_')}`;
  const BANK_PROGRESS_KEY = `uworld_bank_progress_v1_${(BANK_CONFIG.uid || 'default').replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  // Tracker details keys
  const TRACKER_VERSION = 'v2';
  const STORAGE_PREFIX = 'quiz_tracker_';
  const KEYS_LIST_KEY  = 'quiz_tracker_keys';

  /* ─── LAB VALUES REFERENCE DATA ───────────────────────────────── */
  const LAB_VALUES = {
    serum: [
      { name: 'Sodium', range: '136–145 mEq/L (136–145 mmol/L)' },
      { name: 'Potassium', range: '3.5–5.0 mEq/L (3.5–5.0 mmol/L)' },
      { name: 'Chloride', range: '98–106 mEq/L (98–106 mmol/L)' },
      { name: 'Bicarbonate (HCO3-)', range: '22–28 mEq/L (22–28 mmol/L)' },
      { name: 'Blood urea nitrogen (BUN)', range: '7–18 mg/dL (2.5–6.4 mmol/L)' },
      { name: 'Creatinine', range: '0.6–1.2 mg/dL (53–106 µmol/L)' },
      { name: 'Glucose (fasting)', range: '70–110 mg/dL (3.9–6.1 mmol/L)' },
      { name: 'Calcium', range: '8.4–10.2 mg/dL (2.1–2.6 mmol/L)' },
      { name: 'Magnesium', range: '1.5–2.0 mEq/L (0.75–1.0 mmol/L)' },
      { name: 'Phosphorus (inorganic)', range: '3.0–4.5 mg/dL (1.0–1.5 mmol/L)' },
      { name: 'Protein (total)', range: '6.0–7.8 g/dL (60–78 g/L)' },
      { name: 'Albumin', range: '3.5–5.5 g/dL (35–55 g/L)' },
      { name: 'Bilirubin (total)', range: '0.3–1.0 mg/dL (5.1–17.0 µmol/L)' }
    ],
    csf: [
      { name: 'CSF Pressure', range: '70–180 mm H2O' },
      { name: 'CSF Protein', range: '15–45 mg/dL (0.15–0.45 g/L)' },
      { name: 'CSF Glucose', range: '40–70 mg/dL (2.2–3.9 mmol/L) [~60% of serum]' },
      { name: 'CSF WBC Count', range: '0–5 /mm3 (all mononuclear)' }
    ],
    blood: [
      { name: 'Hemoglobin (Hb) - Male', range: '13.5–17.5 g/dL (135–175 g/L)' },
      { name: 'Hemoglobin (Hb) - Female', range: '12.0–15.5 g/dL (120–155 g/L)' },
      { name: 'Hematocrit (Hct) - Male', range: '41%–50% (0.41–0.50)' },
      { name: 'Hematocrit (Hct) - Female', range: '36%–44% (0.36–0.44)' },
      { name: 'WBC (leukocyte) count', range: '4,500–11,000 /mm3 (4.5–11.0 × 10^9/L)' },
      { name: 'Platelet count', range: '150,000–400,000 /mm3 (150–400 × 10^9/L)' },
      { name: 'Arterial Blood Gas pH', range: '7.35–7.45' },
      { name: 'Arterial Blood Gas pCO2', range: '33–44 mm Hg (4.4–5.9 kPa)' },
      { name: 'Arterial Blood Gas pO2', range: '75–105 mm Hg (10.0–14.0 kPa)' },
      { name: 'HCO3- (Arterial)', range: '22–28 mEq/L (22–28 mmol/L)' }
    ],
    urine: [
      { name: 'Urine Specific Gravity', range: '1.002–1.030' },
      { name: 'Urine pH', range: '4.6–8.0' },
      { name: 'Urine Protein', range: '<150 mg/24h (<0.15 g/d)' },
      { name: 'Body Mass Index (BMI)', range: '18.5–24.9 kg/m2 (normal range)' }
    ]
  };

  /* ─── DRAG DRAG DRAG INTERFACE (Draggable Calculator) ─────────── */
  function setupDraggable(element, handle) {
    var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      if (e.target.classList.contains('calc-close')) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      
      var newTop = element.offsetTop - pos2;
      var newLeft = element.offsetLeft - pos1;

      // Restrain within boundaries
      newTop = Math.max(50, Math.min(window.innerHeight - 200, newTop));
      newLeft = Math.max(10, Math.min(window.innerWidth - 240, newLeft));

      element.style.top = newTop + "px";
      element.style.left = newLeft + "px";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  /* ─── CALCULATOR INTERACTIVE LOGIC ───────────────────────────── */
  var calcVal = "0";
  var calcOp = "";
  var calcPrev = "";
  var calcReset = false;

  window.calcInput = function(key) {
    var scr = document.getElementById('calc-screen');
    if (!scr) return;

    if (key >= '0' && key <= '9' || key === '.') {
      if (calcVal === "0" || calcReset) {
        calcVal = key === '.' ? "0." : key;
        calcReset = false;
      } else {
        if (key === '.' && calcVal.indexOf('.') !== -1) return;
        calcVal += key;
      }
      scr.value = calcVal;
    } else if (key === 'C') {
      calcVal = "0"; calcOp = ""; calcPrev = ""; calcReset = false;
      scr.value = calcVal;
    } else if (key === 'sqrt') {
      var val = parseFloat(calcVal);
      if (val >= 0) {
        calcVal = String(Math.sqrt(val));
        scr.value = parseFloat(parseFloat(calcVal).toFixed(8));
      } else {
        scr.value = "Error";
      }
      calcReset = true;
    } else if (key === 'inv') {
      var val = parseFloat(calcVal);
      if (val !== 0) {
        calcVal = String(1 / val);
        scr.value = parseFloat(parseFloat(calcVal).toFixed(8));
      } else {
        scr.value = "Error";
      }
      calcReset = true;
    } else if (['+', '-', '*', '/'].includes(key)) {
      calcPrev = calcVal;
      calcOp = key;
      calcReset = true;
    } else if (key === '=') {
      if (!calcOp || !calcPrev) return;
      var p = parseFloat(calcPrev);
      var c = parseFloat(calcVal);
      var res = 0;
      if (calcOp === '+') res = p + c;
      else if (calcOp === '-') res = p - c;
      else if (calcOp === '*') res = p * c;
      else if (calcOp === '/') {
        res = c !== 0 ? p / c : "Error";
      }
      calcVal = String(res);
      scr.value = res === "Error" ? "Error" : parseFloat(parseFloat(calcVal).toFixed(8));
      calcOp = ""; calcPrev = ""; calcReset = true;
    }
  };

  /* ─── DYNAMIC LINE NUMBERING SYSTEM ───────────────────────────── */
  window.updateLineNumbers = function() {
    var passage = document.getElementById('vignette-content');
    var gutter = document.getElementById('line-gutter');
    if (!passage || !gutter) return;

    gutter.innerHTML = '';
    
    // Compute exact height metrics
    var style = window.getComputedStyle(passage);
    var lineHeight = parseFloat(style.lineHeight);
    if (isNaN(lineHeight)) {
      lineHeight = parseFloat(style.fontSize) * 1.6;
    }

    var totalHeight = passage.scrollHeight;
    var lineCount = Math.max(1, Math.floor(totalHeight / lineHeight));
    
    var html = '';
    for (var i = 1; i <= lineCount; i++) {
      html += `<div style="height:${lineHeight}px; line-height:${lineHeight}px; padding-right: 4px;">${i}</div>`;
    }
    gutter.innerHTML = html;
  };

  // Triggers visual update to lines on resizing/scaling
  window.addEventListener('resize', function() {
    if (document.getElementById('quiz-screen').classList.contains('active') && !state.submitted) {
      updateLineNumbers();
    }
  });

  /* ─── SAVE AND RESTORE PROGRESS (LOCAL STORAGE) ──────────────── */
  function getBankProgress() {
    try {
      const raw = localStorage.getItem(BANK_PROGRESS_KEY);
      if (!raw) return { shownIndices: [], totalSessions: 0, cycleCount: 0 };
      const p = JSON.parse(raw);
      return {
        shownIndices: Array.isArray(p.shownIndices) ? p.shownIndices : [],
        totalSessions: typeof p.totalSessions === 'number' ? p.totalSessions : 0,
        cycleCount: typeof p.cycleCount === 'number' ? p.cycleCount : 0
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
        handleQuotaError('Storage full! Clear tracker data to save bank progress.');
      }
    }
  }

  function clearProgress() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function saveProgress() {
    if (state.submitted) return;

    // Don't save if there's no progress yet (prevents blank saves on first load/exit)
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
      zoom: state.zoom,
      qTimeSpent: state.qTimeSpent,
      isHighlighterMode: state.isHighlighterMode,
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
          handleQuotaError('Storage full! Clear tracker data to save progress.');
        }
      } else {
        console.error('Error saving progress:', e);
      }
    }
  }

  function checkSavedProgress() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (!isValidSaveData(data)) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      if (data.version !== STORAGE_VERSION || data.quizTitle !== BANK_CONFIG.title) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      
      EngineShared.showToast("📂 Restore previous block progress?", [
        {
          label: "Restore",
          primary: true,
          onClick: () => doRestoreProgress(data)
        },
        {
          label: "Dismiss",
          primary: false,
          onClick: () => {
            clearProgress();
          }
        }
      ]);
    } catch(e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function doRestoreProgress(data) {
    selectedCount = data.questionCount || 20;
    const inp = document.getElementById('q-count-input');
    if (inp) inp.value = selectedCount;

    SESSION_QUESTION_INDICES = data.sessionIndices;
    SESSION_QUESTIONS = data.sessionIndices.map(i => QUESTION_BANK[i]);

    state.current = Math.min(data.current, SESSION_QUESTIONS.length - 1);
    state.answers = data.answers;
    state.flagged = data.flagged || {};
    state.strikethrough = data.strikethrough || {};
    state.elapsed = data.elapsed || 0;
    state.timerSecs = data.timerSecs || 0;
    state.mode = data.mode || 'learning';
    state.zoom = data.zoom || 'm';
    state.qTimeSpent = data.qTimeSpent || {};
    state.highlights = data.highlights || {};
    state.isHighlighterMode = !!data.isHighlighterMode;
    state.submitted = false;

    // Apply zoom class
    setZoom(state.zoom);

    // Apply mode inputs checked
    const modeR = document.querySelector(`input[name="quiz-mode"][value="${state.mode}"]`);
    if (modeR) {
      modeR.checked = true;
      var ev = new Event('change');
      modeR.dispatchEvent(ev);
    }

    // Toggle body class for highlighter
    document.body.classList.toggle('highlighter-active', state.isHighlighterMode);
    const hlBtn = document.getElementById('highlighter-toggle');
    if (hlBtn) {
      hlBtn.classList.toggle('active', state.isHighlighterMode);
    }

    showScreen('quiz-screen');
    buildNavGrid();
    updateNavGrid();
    renderQuestion(state.current);
    updateTimerDisplay();
    startTimer();
  }

  /* ════════════════════════════════════════════════════════════════
     HIGHLIGHT & STRIKETHROUGH SYSTEM
  ════════════════════════════════════════════════════════════════ */

  // Lazy-init: register all highlighter event listeners on first activation
  function _hlInit() {
    if (_hlInitialized) return;
    _hlInitialized = true;

    // Desktop/Touch drag select click handling
    document.addEventListener('click', function(e) {
      if (!state.isHighlighterMode || state.submitted) return;
      var optLabel = e.target.closest('.option-card');
      if (!optLabel) return;
      if (e.target.closest('input[type=radio]')) return;
      if (_hlJustApplied) {
        e.preventDefault();
        e.stopPropagation();
        _hlJustApplied = false;
        return;
      }
    }, true);

    // Auto apply highlights
    document.addEventListener('mouseup', function(e) {
      if (e.button !== 0) return;
      if (!state.isHighlighterMode || state.submitted) return;
      clearTimeout(_hlSelectionTimer);
      _hlSelectionTimer = setTimeout(_hlAutoApply, 50);
    });

    document.addEventListener('selectionchange', function() {
      if (!state.isHighlighterMode || state.submitted) return;
      clearTimeout(_hlSelectionTimer);
      _hlSelectionTimer = setTimeout(_hlAutoApply, 600);
    });

    document.addEventListener('touchend', function(e) {
      if (!state.isHighlighterMode || state.submitted) return;
      clearTimeout(_hlSelectionTimer);
      _hlSelectionTimer = setTimeout(_hlAutoApply, 150);
    });

    // Right click option card for Strikethrough
    document.addEventListener('mousedown', function(e) {
      _ctxStrikeDone = false;
      if (_hlPickerOpen) {
        var isPickerClick = e.target.closest('.hl-color-picker') || e.target.closest('#highlighter-toggle');
        if (!isPickerClick) _closeAllPickers();
      }
      if (e.button === 2 && state.isHighlighterMode && !state.submitted) {
        var optLabel = e.target.closest('.option-card');
        if (optLabel && optLabel.dataset.optIdx !== undefined) {
          e.preventDefault();
          _ctxStrikeDone = true;
          toggleStrikethrough(_hlGlobalIdx(state.current), parseInt(optLabel.dataset.optIdx));
        }
      }
    });

    document.addEventListener('contextmenu', function(e) {
      if (!state.isHighlighterMode || state.submitted) return;
      e.preventDefault();
      if (_ctxStrikeDone) { _ctxStrikeDone = false; return; }
      var optLabel = e.target.closest('.option-card');
      if (optLabel && optLabel.dataset.optIdx !== undefined) {
        toggleStrikethrough(_hlGlobalIdx(state.current), parseInt(optLabel.dataset.optIdx));
      }
    });

    // Track hovered option card for strike keyboard shortcut 'S'
    document.addEventListener('mouseover', function(e) {
      var optLabel = e.target.closest('.option-card');
      if (optLabel && optLabel.dataset.optIdx !== undefined) {
        _hoveredOption = parseInt(optLabel.dataset.optIdx);
        return;
      }
      _hoveredOption = -1;
    });
    document.addEventListener('mouseout', function(e) {
      var optLabel = e.target.closest('.option-card');
      if (optLabel) _hoveredOption = -1;
    });
  }

  // Toggle mode
  window.toggleHighlighterMode = function() {
    if (!state.isHighlighterMode) {
      _hlInit();
      state.isHighlighterMode = true;
      document.body.classList.add('highlighter-active');
      const hlBtn = document.getElementById('highlighter-toggle');
      if (hlBtn) hlBtn.classList.add('active');
      if (!state.submitted) renderQuestion(state.current);
      EngineShared.showToast('🖍 Highlighter ON');
    } else {
      _togglePicker();
    }
  };

  window.disableHighlighterMode = function() {
    if (!state.isHighlighterMode) return;
    state.isHighlighterMode = false;
    document.body.classList.remove('highlighter-active');
    const hlBtn = document.getElementById('highlighter-toggle');
    if (hlBtn) hlBtn.classList.remove('active');
    _closeAllPickers();
    if (!state.submitted) renderQuestion(state.current);
    EngineShared.showToast('Highlighter OFF');
  };

  function _togglePicker() {
    const p = document.getElementById('hl-picker');
    if (p) {
      const isVis = p.classList.contains('visible');
      if (isVis) {
        p.classList.remove('visible');
        p.style.display = 'none';
        _hlPickerOpen = false;
      } else {
        p.classList.add('visible');
        p.style.display = 'flex';
        _hlPickerOpen = true;
        _syncPickerUI();
      }
    }
  }

  function _closeAllPickers() {
    const p = document.getElementById('hl-picker');
    if (p) {
      p.classList.remove('visible');
      p.style.display = 'none';
    }
    _hlPickerOpen = false;
  }

  function _syncPickerUI() {
    const picker = document.getElementById('hl-picker');
    if (picker) {
      picker.querySelectorAll('.hl-color-btn').forEach(function(btn) {
        var m = btn.className.match(/hl-c(\d)/);
        btn.classList.toggle('selected', m && parseInt(m[1]) === _hlLastColor);
      });
      // Update eraser button active state
      var eraseBtn = picker.querySelector('.hl-erase-btn');
      if (eraseBtn) eraseBtn.classList.toggle('active', _hlLastColor === 0);
    }
    const dot = document.getElementById('hl-color-dot');
    if (dot) {
      var dotColors = { 1: '#fbbf24', 2: '#34d399', 3: '#f472b6', 4: '#60a5fa' };
      dot.style.background = _hlLastColor === 0 ? '#94a3b8' : (dotColors[_hlLastColor] || dotColors[1]);
    }
  }

  window.hlSelectColor = function(colorNum) {
    if (colorNum === 0) {
      _hlLastColor = 0;
    } else {
      _hlLastColor = colorNum;
    }
    _syncPickerUI();
  };

  // hlEraseSelectionAtCurrent is the primary eraser; hlEraseSelection is the HTML onclick alias

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
    var questionArea = document.getElementById('cbt-split-body');
    if (!questionArea || !questionArea.contains(range.commonAncestorContainer)) return null;

    var part = null, optIndex = -1;

    // Check passage
    var qVignette = questionArea.querySelector('#vignette-content');
    if (qVignette && qVignette.contains(range.commonAncestorContainer)) part = 'question';

    // Check prompt
    if (!part) {
      var qPrompt = questionArea.querySelector('#question-prompt');
      if (qPrompt && qPrompt.contains(range.commonAncestorContainer)) part = 'prompt';
    }

    // Check options
    if (!part) {
      var optTexts = questionArea.querySelectorAll('.option-text');
      for (var i = 0; i < optTexts.length; i++) {
        if (optTexts[i].contains(range.commonAncestorContainer)) {
          part = 'option'; optIndex = i; break;
        }
      }
    }

    // Check explanation
    if (!part) {
      var expl = questionArea.querySelector('#explanation-content');
      if (expl && expl.contains(range.commonAncestorContainer)) part = 'explanation';
    }

    if (!part) return null;

    var container;
    if (part === 'question') container = qVignette;
    else if (part === 'prompt') container = qPrompt;
    else if (part === 'option') container = questionArea.querySelectorAll('.option-text')[optIndex];
    else container = questionArea.querySelector('#explanation-content');
    if (!container) return null;

    var startOffset = _getTextOffsetRelativeTo(container, range.startContainer, range.startOffset);
    var endOffset   = _getTextOffsetRelativeTo(container, range.endContainer, range.endOffset);
    if (startOffset < 0 || endOffset < 0 || startOffset === endOffset) return null;

    return { part: part, optIndex: optIndex, start: Math.min(startOffset, endOffset), end: Math.max(startOffset, endOffset) };
  }

  function _isSelectionInQuestionArea() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    var questionArea = document.getElementById('cbt-split-body');
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

  window.hlApplyColor = function(colorNum) {
    if (!state.isHighlighterMode) return;
    var info = _getSelectionParts();
    if (!info) { window.getSelection().removeAllRanges(); return; }
    // Use global index for consistent highlight storage across sessions
    var gIdx = _hlGlobalIdx(state.current);
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
    saveProgress();
  };

  window.hlEraseSelection = window.hlEraseSelectionAtCurrent = function() {
    if (!state.isHighlighterMode) return;
    var info = _getSelectionParts();
    if (!info) { window.getSelection().removeAllRanges(); return; }
    var gIdx = _hlGlobalIdx(state.current);
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
    saveProgress();
  };

  window.clearAllHighlights = function(gIdx) {
    delete state.highlights[gIdx];
    delete _hlCache[gIdx];
    renderQuestion(state.current);
    saveProgress();
    EngineShared.showToast('Highlights cleared');
  };

  // toggleStrikethrough: uses global index directly (called from _hlInit)
  window.toggleStrikethrough = function(gIdx, optIdx) {
    _toggleStrike(gIdx, optIdx);
    renderQuestion(state.current);
    saveProgress();
  };

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

  window.applyBulkHighlights = function(qIdx) {
    var hlList = state.highlights[qIdx] || [];
    var stMap = state.strikethrough[qIdx] || {};
    if (hlList.length === 0 && Object.keys(stMap).length === 0) return;

    var area = document.getElementById('cbt-split-body');
    if (!area) return;

    var qVignette = area.querySelector('#vignette-content');
    if (qVignette && hlList.length && qVignette.innerHTML.indexOf('<mark') === -1) {
      qVignette.innerHTML = _applyHighlightsToHTML(qVignette.innerHTML, hlList, 'question');
    }

    var qPrompt = area.querySelector('#question-prompt');
    if (qPrompt && hlList.length && qPrompt.innerHTML.indexOf('<mark') === -1) {
      qPrompt.innerHTML = _applyHighlightsToHTML(qPrompt.innerHTML, hlList, 'prompt');
    }

    var optTexts = area.querySelectorAll('.option-text');
    optTexts.forEach(function(el, i) {
      if (hlList.length && el.innerHTML.indexOf('<mark') === -1) {
        el.innerHTML = _applyHighlightsToHTML(el.innerHTML, hlList, 'option', i);
      }
    });

    var expl = area.querySelector('#explanation-content');
    if (expl && hlList.length && expl.innerHTML.indexOf('<mark') === -1) {
      expl.innerHTML = _applyHighlightsToHTML(expl.innerHTML, hlList, 'explanation');
    }

    var optCards = area.querySelectorAll('.option-card');
    optCards.forEach(function(el, i) {
      if (stMap[i]) el.classList.add('strikethrough');
    });
  };

  /* ─── CORE QUIZ MECHANICS ────────────────────────────────────── */
  window.adjustCount = function(delta) {
    const inp = document.getElementById('q-count-input');
    const bankSize = QUESTION_BANK.length;
    const progress = getBankProgress();
    const remaining = Math.max(1, bankSize - progress.shownIndices.length);
    const cur = parseInt(inp.value) || selectedCount || 20;
    const newVal = Math.max(1, Math.min(remaining, cur + delta));
    inp.value = newVal;
    selectedCount = newVal;
    autoSetTime(newVal);
  };

  window.onCustomCount = function(val) {
    const bankSize = QUESTION_BANK.length;
    const progress = getBankProgress();
    const remaining = Math.max(1, bankSize - progress.shownIndices.length);
    let n = parseInt(val) || 1;
    n = Math.max(1, Math.min(remaining, n));
    selectedCount = n;
    const inp = document.getElementById('q-count-input');
    inp.value = n;
    autoSetTime(n);
  };

  window.adjustTime = function(delta) {
    const inp = document.getElementById('time-input');
    const cur = parseInt(inp.value) || 30;
    inp.value = Math.max(1, Math.min(300, cur + delta));
  };

  function autoSetTime(n) {
    const autoMins = Math.max(1, n);
    document.getElementById('time-input').value = autoMins;
  }

  window.openBankResetModal = function() {
    document.getElementById('bank-reset-modal').classList.add('open');
  };

  window.closeBankResetModal = function() {
    document.getElementById('bank-reset-modal').classList.remove('open');
  };

  window.confirmBankReset = function() {
    closeBankResetModal();
    localStorage.removeItem(BANK_PROGRESS_KEY);
    updateStartScreenStats();
    EngineShared.showToast('🔄 Coverage history reset!');
  };

  function updateStartScreenStats() {
    const progress = getBankProgress();
    const bankSize = QUESTION_BANK.length;
    const covered = progress.shownIndices.length;
    const pct = bankSize > 0 ? Math.round(covered / bankSize * 100) : 0;
    const remaining = bankSize - covered;

    document.getElementById('stat-covered').textContent = covered;
    document.getElementById('stat-total').textContent = bankSize;
    document.getElementById('stat-sessions').textContent = progress.totalSessions;
    document.getElementById('coverage-fill').style.width = pct + '%';
    document.getElementById('coverage-pct').textContent = pct + '%';

    const inp = document.getElementById('q-count-input');
    const currentVal = parseInt(inp.value) || selectedCount || 20;
    inp.max = remaining || bankSize;
    inp.placeholder = remaining || bankSize;
    
    if (covered === 0 || remaining <= 0) {
      selectedCount = Math.min(20, bankSize);
      inp.value = selectedCount;
    } else if (currentVal > remaining) {
      inp.value = Math.max(1, remaining);
      selectedCount = Math.max(1, remaining);
    }
  }

  /* ─── QUESTION SELECTION ─────────────────────────────────────
     Picks `count` questions preferring unshown ones.
     When all questions have been shown, starts a new coverage cycle.
     ──────────────────────────────────────────────────────────────── */
  function selectSessionQuestions(count, order) {
    const bankSize = QUESTION_BANK.length;
    const progress = getBankProgress();

    const allIndices = Array.from({ length: bankSize }, (_, i) => i);
    let unshown = allIndices.filter(i => !progress.shownIndices.includes(i));

    // Cap count to remaining questions in current cycle
    const maxAllowed = unshown.length > 0 ? unshown.length : bankSize;
    const n = Math.min(count, maxAllowed);

    let picked;

    if (unshown.length === 0) {
      // All questions have been shown — start a new coverage cycle
      progress.cycleCount++;
      progress.shownIndices = [];
      unshown = [...allIndices];
      saveBankProgress(progress);
      EngineShared.showToast('🎉 Full cycle complete! Starting fresh — cycle ' + (progress.cycleCount + 1));
      picked = order === 'sequential'
        ? unshown.sort((a, b) => a - b).slice(0, n)
        : shuffle(unshown).slice(0, n);
    } else {
      // Sequential: pick next N questions in original bank order (no shuffle)
      // Random: shuffle then pick N for fair random coverage
      picked = order === 'sequential'
        ? unshown.sort((a, b) => a - b).slice(0, n)
        : shuffle(unshown).slice(0, n);
    }

    // Update shown indices — use Set for dedup to handle edge cases
    progress.shownIndices = [...new Set([...progress.shownIndices, ...picked])];
    progress.totalSessions++;
    saveBankProgress(progress);

    SESSION_QUESTION_INDICES = picked;
    return picked.map(i => QUESTION_BANK[i]);
  }

  /* ─── SAVE DATA VALIDATION & CLEANUP ──────────────────────────── */
  function isValidSaveData(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.current !== 'number' || data.current < 0) return false;
    if (!data.answers || typeof data.answers !== 'object') return false;
    if (!data.flagged || typeof data.flagged !== 'object') return false;
    if (typeof data.timerSecs !== 'number' || data.timerSecs < 0) return false;
    if (!['exam', 'learning'].includes(data.mode)) return false;
    if (typeof data.questionCount !== 'number' || data.questionCount < 1) return false;
    if (typeof data.totalQuestions !== 'number' || data.totalQuestions < 1) return false;
    // sessionIndices must exist and every index must be a valid bank index
    if (!Array.isArray(data.sessionIndices) || data.sessionIndices.length === 0) return false;
    if (data.sessionIndices.some(i => typeof i !== 'number' || i < 0 || i >= QUESTION_BANK.length)) return false;
    // highlights and strikethrough are optional for backward compatibility
    if (data.highlights && typeof data.highlights !== 'object') return false;
    if (data.strikethrough && typeof data.strikethrough !== 'object') return false;
    return true;
  }

  /**
   * Clear old saves from other quizzes to free up space
   */
  function clearOldSaves() {
    try {
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000;

      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('uworld_progress_')) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            if (now - data.timestamp > maxAge) {
              localStorage.removeItem(key);
            }
          } catch (e) {
            localStorage.removeItem(key);
          }
        }
      });
    } catch (e) {
      console.error('Error clearing old saves:', e);
    }
  }

  /* ─── HIGHLIGHT INDEX MAPPING ─────────────────────────────────── */
  function _hlGlobalIdx(sessionIdx) {
    return SESSION_QUESTION_INDICES[sessionIdx] !== undefined
      ? SESSION_QUESTION_INDICES[sessionIdx]
      : sessionIdx;
  }

  /* ─── STRIKETHROUGH HELPER ─────────────────────────────────────── */
  function _toggleStrike(gIdx, optIdx) {
    if (!state.strikethrough[gIdx]) state.strikethrough[gIdx] = {};
    state.strikethrough[gIdx][optIdx] = !state.strikethrough[gIdx][optIdx];
    if (!state.strikethrough[gIdx][optIdx]) delete state.strikethrough[gIdx][optIdx];
  }

  /* ─── QUOTA ERROR HELPER ───────────────────────────────────────── */
  function handleQuotaError(contextMsg) {
    EngineShared.showToast(contextMsg, [
      { label: 'Go to Menu', primary: true, onClick: navigateToIndex }
    ]);
  }

  window.startQuiz = function() {
    const mode = document.querySelector('input[name="quiz-mode"]:checked').value;
    const order = document.querySelector('input[name="quiz-order"]:checked').value;
    const timeMins = parseInt(document.getElementById('time-input').value) || 30;
    let count = selectedCount;

    clearProgress();

    // Select questions using shared selection algorithm
    SESSION_QUESTIONS = selectSessionQuestions(count, order);

    state.current = 0;
    state.answers = {};
    state.flagged = {};
    state.elapsed = 0;
    state.submitted = false;
    state.mode = mode;
    state.timerSecs = timeMins * 60;
    state.strikethrough = {};
    state.qTimeSpent = {};

    showScreen('quiz-screen');
    
    if (mode === 'learning') {
      document.getElementById('header-block-number').textContent = 'Block: Tutor';
      document.getElementById('timer-display').querySelector('span').textContent = 'Tutor Time Elapsed:';
    } else {
      document.getElementById('header-block-number').textContent = 'Block 1 of 1';
      document.getElementById('timer-display').querySelector('span').textContent = 'Block Time Remaining:';
    }

    // Load scratchnote text if any exists
    const savedNote = localStorage.getItem(`uworld_notepad_${BANK_CONFIG.uid}`);
    document.getElementById('notepad-text').value = savedNote || '';

    buildNavGrid();
    updateNavGrid();
    renderQuestion(0);
    startTimer();
  };

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === 'start-screen') updateStartScreenStats();
  }

  /* ─── TIMER CONTROL ─────────────────────────────────────────── */
  function startTimer() {
    if (state.timerID) clearInterval(state.timerID);
    timerPaused = false;
    lastTime = Date.now();
    qStartTime = Date.now();

    state.timerID = setInterval(() => {
      if (timerPaused) return;
      const now = Date.now();
      const delta = Math.floor((now - lastTime) / 1000);
      if (delta >= 1) {
        state.elapsed += delta;
        lastTime = now;
        
        // Timer countdown for Timed mode
        if (state.mode === 'exam') {
          state.timerSecs -= delta;
          if (state.timerSecs <= 0) {
            state.timerSecs = 0;
            stopTimer();
            EngineShared.showToast("⏰ Time expired! Submitting...");
            submitTimeout = setTimeout(confirmSubmit, 1500);
          }
        }
        
        // Track per-question time spent
        const curQ = state.current;
        if (!state.qTimeSpent[curQ]) state.qTimeSpent[curQ] = 0;
        state.qTimeSpent[curQ] += delta;

        updateTimerDisplay();
      }
    }, 500);
  }

  function stopTimer() {
    if (state.timerID) { clearInterval(state.timerID); state.timerID = null; }
    if (submitTimeout) { clearTimeout(submitTimeout); submitTimeout = null; }
    timerPaused = true;
  }

  window.togglePauseTimer = function() {
    const btn = document.getElementById('pause-btn');
    if (timerPaused) {
      btn.textContent = 'Pause';
      btn.style.background = '';
      startTimer();
    } else {
      btn.textContent = 'Resume';
      btn.style.background = 'var(--correct-bg)';
      stopTimer();
      EngineShared.showToast('⏸ Simulated exam paused');
    }
  };

  function updateTimerDisplay() {
    const secs = state.mode === 'learning' ? state.elapsed : Math.max(0, state.timerSecs);
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const remSecs = secs % 60;
    
    document.getElementById('timer-text').textContent = 
      String(hrs).padStart(2,'0') + ':' + 
      String(mins).padStart(2,'0') + ':' + 
      String(remSecs).padStart(2,'0');

    const disp = document.getElementById('timer-display');
    if (state.mode === 'exam' && secs < 120) {
      disp.classList.add('warn');
    } else {
      disp.classList.remove('warn');
    }
  }

  /* ─── RENDER QUESTIONS & CHOICES ───────────────────────────────── */
  window.renderQuestion = function(idx) {
    state.current = idx;
    const q = SESSION_QUESTIONS[idx];
    const sel = state.answers[idx];
    const isAnswered = sel !== undefined;
    const isTutor = state.mode === 'learning';

    // Header updates
    document.getElementById('header-item-number').textContent = `Item ${idx + 1} of ${SESSION_QUESTIONS.length}`;
    
    // Mark status
    const markBtn = document.getElementById('mark-btn');
    markBtn.classList.toggle('active', !!state.flagged[idx]);

    // Split passage by paragraph & inject to trigger dynamic line gutters
    const vignetteContent = document.getElementById('vignette-content');
    const questionPrompt = document.getElementById('question-prompt');
    const optionsWrap = document.getElementById('options-wrap');

    // Split passage into paragraphs
    vignetteContent.innerHTML = q.question.split('\n\n').map(p => `<p style="margin:0 0 16px 0;">${p}</p>`).join('');
    
    // Detect if prompt is separate. Standard UWorld places prompt in last paragraph.
    // We display the last paragraph as prompt, or parse it cleanly.
    // If paragraph split resulted in multiple paragraphs, make the last paragraph the bold prompt.
    const paras = vignetteContent.querySelectorAll('p');
    if (paras.length > 1) {
      const lastP = paras[paras.length - 1];
      questionPrompt.innerHTML = lastP.innerHTML;
      lastP.remove();
    } else {
      questionPrompt.innerHTML = "";
    }

    // Render Choice Cards
    optionsWrap.innerHTML = q.options.map((opt, i) => {
      let extraClass = '';
      if (sel === i) extraClass += ' selected';
      
      const gIdx = SESSION_QUESTION_INDICES[idx];
      const isStruck = state.strikethrough[gIdx] && state.strikethrough[gIdx][i];
      if (isStruck) extraClass += ' strikethrough';

      // Tutor mode visual outlines
      if (isTutor && isAnswered) {
        if (i === q.correct) {
          extraClass += ' feedback-correct';
        } else if (sel === i) {
          extraClass += ' feedback-incorrect';
        }
      }

      return `
        <div class="option-card${extraClass}" onclick="selectOptionCard(${idx}, ${i})" data-opt-idx="${i}">
          <div class="option-circle">
            <span>${KEYS[i]}</span>
          </div>
          <div class="option-text">${opt}</div>
          <button class="option-strike-btn${isStruck?' active':''}" onclick="event.stopPropagation(); toggleCardStrikethrough(${idx}, ${i})" title="Strikethrough (S)">✕</button>
        </div>
      `;
    }).join('');

    // Tutor mode bottom stats bar & split-pane explanations reveal
    const tutorStats = document.getElementById('tutor-stats');
    const splitBody = document.getElementById('cbt-split-body');
    const explContent = document.getElementById('explanation-content');
    const explBadge = document.getElementById('expl-badge');

    if (isTutor && isAnswered) {
      tutorStats.style.display = 'flex';
      splitBody.classList.remove('collapsed-explanation');
      
      const isCorrect = sel === q.correct;
      const ind = document.getElementById('tutor-indicator');
      ind.className = 'tutor-stats-indicator ' + (isCorrect ? 'correct' : 'incorrect');

      const txt = document.getElementById('tutor-status-text');
      txt.textContent = isCorrect ? 'Correct' : 'Incorrect';
      txt.className = 'tsv ' + (isCorrect ? 'correct' : 'incorrect');

      // Global correct rate simulation
      const randomPct = 50 + Math.floor((q.question.length % 40));
      document.getElementById('tutor-stat-pct').textContent = `${randomPct}%`;

      // Time spent on question
      const secsSpent = state.qTimeSpent[idx] || 0;
      const mS = Math.floor(secsSpent / 60);
      const sS = secsSpent % 60;
      document.getElementById('tutor-stat-time').textContent = `${mS}m ${sS}s`;

      // Explanation pane setup
      explBadge.textContent = isCorrect ? 'Correct' : 'Incorrect';
      explBadge.className = 'eh-status ' + (isCorrect ? 'correct' : 'incorrect');

      // Populate explanations
      let explHTML = `<p>${q.explanation}</p>`;
      
      // Choice breakdown
      explHTML += `
        <div class="choice-breakdown">
          <div class="choice-breakdown-title">Answer Choice Explanations</div>
          ${q.options.map((opt, i) => {
            const isCorrectOption = i === q.correct;
            return `
              <div class="breakdown-row${isCorrectOption ? ' correct' : ''}">
                <span class="br-key">(Choice ${KEYS[i]})</span>
                <span>${opt} — ${isCorrectOption ? 'Correct choice.' : 'Incorrect explanation.'}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // References list
      explHTML += `
        <div class="expl-references">
          <div class="expl-references-title">Educational Objectives</div>
          <ul>
            <li>High-yield clinical fact regarding target question diagnosis.</li>
            <li><a href="https://www.ncbi.nlm.nih.gov/pubmed" target="_blank">PubMed Medical Reference Literature</a></li>
          </ul>
        </div>
      `;

      explContent.innerHTML = explHTML;
    } else {
      tutorStats.style.display = 'none';
      splitBody.classList.add('collapsed-explanation');
      explContent.innerHTML = '';
    }

    const gIdx = SESSION_QUESTION_INDICES[idx];
    applyBulkHighlights(gIdx);

    // Trigger visual line gutters updates
    setTimeout(updateLineNumbers, 50);

    updateNavGrid(idx);
    updateNavStats();
  };

  window.selectOptionCard = function(qIdx, optIdx) {
    if (state.mode === 'learning' && state.answers[qIdx] !== undefined) return;
    
    // Ignore if card is struck out
    const gIdx = SESSION_QUESTION_INDICES[qIdx];
    if (state.strikethrough[gIdx] && state.strikethrough[gIdx][optIdx]) return;

    state.answers[qIdx] = optIdx;
    EngineShared.debounceSave(saveProgress);

    updateNavGrid(qIdx);
    updateNavStats();

    if (state.mode === 'learning') {
      renderQuestion(qIdx);
    } else {
      // Exam mode: just highlight card visually
      const cards = document.querySelectorAll('.option-card');
      cards.forEach((card, i) => {
        card.classList.toggle('selected', i === optIdx);
        const circle = card.querySelector('.option-circle');
        if (i === optIdx) {
          circle.style.borderColor = 'var(--accent)';
          circle.style.background = 'var(--accent)';
          circle.style.color = '#ffffff';
        } else {
          circle.style.borderColor = '';
          circle.style.background = '';
          circle.style.color = '';
        }
      });
    }
  };

  window.toggleCardStrikethrough = function(qIdx, optIdx) {
    const gIdx = _hlGlobalIdx(qIdx);
    _toggleStrike(gIdx, optIdx);

    // If active answer was struck, clear the answer selection
    if (state.answers[qIdx] === optIdx) {
      delete state.answers[qIdx];
    }

    EngineShared.debounceSave(saveProgress);
    renderQuestion(qIdx);
  };

  /* ─── NAVIGATION UTILITIES ───────────────────────────────────── */
  window.goToPrev = function() {
    if (state.current > 0) renderQuestion(state.current - 1);
  };
  window.goToNext = function() {
    if (state.current < SESSION_QUESTIONS.length - 1) {
      renderQuestion(state.current + 1);
    }
  };
  window.goTo = function(idx) {
    renderQuestion(idx);
    // Do NOT auto-close sidebar — user controls it persistently
  };

  window.toggleFlagCurrent = function() {
    const idx = state.current;
    state.flagged[idx] = !state.flagged[idx];
    
    const markBtn = document.getElementById('mark-btn');
    markBtn.classList.toggle('active', state.flagged[idx]);

    updateNavGrid(idx);
    updateNavStats();
    EngineShared.debounceSave(saveProgress);
    
    EngineShared.showToast(state.flagged[idx] ? '⚑ Item bookmarked' : 'Item bookmark removed');
  };

  /* ─── ZOOM SCALE SYSTEM ───────────────────────────────────────── */
  window.setZoom = function(level) {
    const scr = document.getElementById('quiz-screen');
    scr.classList.remove('zoom-s', 'zoom-m', 'zoom-l');
    scr.classList.add(`zoom-${level}`);
    state.zoom = level;

    // Update active visual button
    const zoomCtrls = document.querySelectorAll('.zoom-controls .zoom-btn');
    zoomCtrls.forEach(function(btn) {
      btn.classList.remove('active');
    });
    // Middle button always = default 'm'
    if (level === 'm') {
      if (zoomCtrls[1]) zoomCtrls[1].classList.add('active');
    } else if (level === 's') {
      if (zoomCtrls[0]) zoomCtrls[0].classList.add('active');
    } else if (level === 'l') {
      if (zoomCtrls[2]) zoomCtrls[2].classList.add('active');
    }

    EngineShared.debounceSave(saveProgress);
    setTimeout(updateLineNumbers, 50);
  };

  window.zoomDecrease = function() {
    var levels = ['s', 'm', 'l'];
    var currentIdx = levels.indexOf(state.zoom);
    if (currentIdx > 0) {
      setZoom(levels[currentIdx - 1]);
    }
  };

  window.zoomIncrease = function() {
    var levels = ['s', 'm', 'l'];
    var currentIdx = levels.indexOf(state.zoom);
    if (currentIdx < levels.length - 1) {
      setZoom(levels[currentIdx + 1]);
    }
  };

  /* ─── DRAWER & MODAL TRIGGERS ─────────────────────────────────── */
  window.toggleNavPane = function() {
    const pane = document.getElementById('nav-pane');
    pane.classList.toggle('collapsed');
    // Persist sidebar open/closed state
    const isCollapsed = pane.classList.contains('collapsed');
    try { localStorage.setItem('uworld_nav_open', isCollapsed ? '0' : '1'); } catch(e) {}
  };

  window.toggleLabDrawer = function() {
    // Close other drawers
    document.getElementById('notepad-drawer').classList.remove('open');
    
    const drawer = document.getElementById('lab-drawer');
    drawer.classList.toggle('open');
    if (drawer.classList.contains('open')) {
      switchLabTab(state.activeLabTab);
    }
  };

  window.toggleNotepadDrawer = function() {
    document.getElementById('lab-drawer').classList.remove('open');

    const drawer = document.getElementById('notepad-drawer');
    drawer.classList.toggle('open');
  };

  window.toggleCalculator = function() {
    const calc = document.getElementById('floating-calc');
    if (calc.style.display === 'block') {
      calc.style.display = 'none';
    } else {
      calc.style.display = 'block';
      setupDraggable(calc, document.getElementById('calc-handle'));
    }
  };

  /* ─── LAB VALUES drawer LOGIC ─────────────────────────────────── */
  window.switchLabTab = function(tabName) {
    state.activeLabTab = tabName;
    const tabBtns = document.querySelectorAll('.lab-tab-btn');
    const tabs = ['serum', 'csf', 'blood', 'urine'];
    tabBtns.forEach((btn, idx) => {
      btn.classList.toggle('active', tabs[idx] === tabName);
    });

    filterLabValues();
  };

  window.filterLabValues = function() {
    const search = document.getElementById('lab-search').value.toLowerCase();
    const rows = LAB_VALUES[state.activeLabTab];
    const tbody = document.getElementById('lab-table-body');
    
    tbody.innerHTML = '';
    const filtered = rows.filter(r => r.name.toLowerCase().includes(search));
    
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;color:var(--text-muted);">No reference matches found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td style="font-weight:600;color:var(--text);">${r.name}</td>
        <td>${r.range}</td>
      </tr>
    `).join('');
  };

  /* ─── NOTEPAD SCRATCHPAD LOGIC ────────────────────────────────── */
  window.saveNotepadText = function() {
    const text = document.getElementById('notepad-text').value;
    state.notepadText = text;
    localStorage.setItem(`uworld_notepad_${BANK_CONFIG.uid}`, text);
    EngineShared.showToast('💾 Scratchpad note cached successfully');
  };

  /* ─── SIDEBAR QUESTION NAVIGATION GRID ────────────────────────── */
  function buildNavGrid() {
    const grid = document.getElementById('nav-grid');
    grid.innerHTML = SESSION_QUESTIONS.map((_, i) => `
      <button class="cbt-nav-btn" id="nav-btn-${i}" onclick="goTo(${i})">
        <span class="unanswered-dot">•</span>
        <span class="q-num">${i + 1}</span>
        <span class="marked-triangle">▶</span>
      </button>
    `).join('');
  }

  function updateNavGrid(changedIdx) {
    SESSION_QUESTIONS.forEach((_, i) => {
      const btn = document.getElementById(`nav-btn-${i}`);
      if (!btn) return;

      const isCurrent = i === state.current;
      const isAnswered = state.answers[i] !== undefined;
      const isFlagged = !!state.flagged[i];
      const isWrong = isAnswered && state.mode === 'learning' && state.answers[i] !== SESSION_QUESTIONS[i].correct;

      btn.className = 'cbt-nav-btn' + 
        (isCurrent ? ' current' : (isWrong ? ' wrong' : (isAnswered ? ' answered' : ''))) +
        (isFlagged ? ' flagged' : '');
    });
  }

  function updateNavStats() {
    /* no-op — stats are calculated dynamically in buildNavGrid/updateNavGrid */
  }

  /* ─── END BLOCK SUBMISSIONS ──────────────────────────────────── */
  window.attemptSubmit = function() {
    if (submitTimeout) clearTimeout(submitTimeout);
    
    if (state.mode === 'learning') {
      confirmSubmit();
      return;
    }

    const unanswered = SESSION_QUESTIONS.length - Object.keys(state.answers).length;
    if (unanswered > 0) {
      document.getElementById('modal-unanswered').textContent = unanswered;
      document.getElementById('submit-modal').classList.add('open');
    } else {
      confirmSubmit();
    }
  };

  window.closeModal = function() {
    document.getElementById('submit-modal').classList.remove('open');
  };

  window.confirmSubmit = function() {
    if (state.submitted) return;
    state.submitted = true;
    
    closeModal();
    stopTimer();
    EngineTracker.saveTrackerData({
      config: window.BANK_CONFIG || window.QUIZ_CONFIG,
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
  };

  window.onNewSessionClick = function(event) {
    if (event) event.preventDefault();
    showScreen('start-screen');
  };

  /* ─── BUILD RESULTS PANE ─────────────────────────────────────── */
  function buildResults() {
    let correct = 0, wrong = 0, skipped = 0;
    SESSION_QUESTIONS.forEach((q, i) => {
      const ans = state.answers[i];
      if (ans === undefined) skipped++;
      else if (ans === q.correct) correct++;
      else wrong++;
    });

    const total = SESSION_QUESTIONS.length;
    const pct = Math.round(correct / total * 100);
    const flagged = Object.values(state.flagged).filter(Boolean).length;
    
    const em = Math.floor(state.elapsed / 60), es = state.elapsed % 60;
    const timeStr = String(em).padStart(2,'0') + ':' + String(es).padStart(2,'0');

    document.getElementById('res-pct').textContent = pct + '%';
    document.getElementById('res-correct').textContent = correct;
    document.getElementById('res-wrong').textContent = wrong;
    document.getElementById('res-flagged').textContent = flagged;
    document.getElementById('res-skipped').textContent = skipped;
    document.getElementById('res-time').textContent = timeStr;

    let grade = '';
    if (pct >= 90) grade = '🏆 Outstanding Performance!';
    else if (pct >= 75) grade = '🌟 Great Work!';
    else if (pct >= 60) grade = '👍 Passing Grade!';
    else if (pct >= 40) grade = '📚 Study High-Yield Topics!';
    else grade = '💪 Keep Practicing — You Got This!';
    
    document.getElementById('res-grade').textContent = grade;

    renderResultItems('all');
    updateExportBadges();
  }

  function renderResultItems(filter) {
    const list = document.getElementById('result-list');
    list.innerHTML = '';
    let itemsRendered = 0;

    SESSION_QUESTIONS.forEach((q, i) => {
      const ans = state.answers[i];
      const isCorrect = ans === q.correct;
      const isSkipped = ans === undefined;
      const isFlagged = state.flagged[i];
      
      let statusClass = isSkipped ? 'skipped' : (isCorrect ? 'correct' : 'wrong');
      let show = filter === 'all'
        || (filter === 'correct' && isCorrect && !isSkipped)
        || (filter === 'wrong' && !isCorrect && !isSkipped)
        || (filter === 'skipped' && isSkipped)
        || (filter === 'flagged' && isFlagged);
      
      if (!show) return;
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
            <div class="result-q-num">Question ${i + 1}${isFlagged ? ' · ⚑ Flagged' : ''}</div>
            <div class="result-q-text">${q.question.split('\n\n')[0]}</div>
          </div>
          <div class="expand-arrow">▼</div>
        </div>
        <div class="result-item-body">
          ${!isSkipped ? `
            <div class="answer-row your-answer ${isCorrect ? 'is-correct' : ''}">
              <span class="ar-label">Your Choice</span>
              <span>${KEYS[ans]}. ${userOpt}</span>
            </div>` : ''}
          ${!isCorrect ? `
            <div class="answer-row correct-answer">
              <span class="ar-label">Correct Choice</span>
              <span>${KEYS[q.correct]}. ${corrOpt}</span>
            </div>` : ''}
          <div class="explanation-box" style="margin-top:12px;padding:14px;border-radius:8px;">
            <strong>Explanation:</strong>
            <p>${q.explanation}</p>
          </div>
        </div>
      `;
      list.appendChild(el);
    });

    if (itemsRendered === 0) {
      list.innerHTML = `<div style="color:var(--text-muted);font-size:0.9rem;padding:1rem 0;text-align:center;">No questions found under this filter category.</div>`;
    }
  }

  window.toggleResultItem = function(header) {
    header.classList.toggle('open');
    header.nextElementSibling.classList.toggle('open');
  };

  window.filterResults = function(filter, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderResultItems(filter);
  };

  /* ─── RESET IN THE MIDST OF TESTING ──────────────────────────── */
  window.confirmResetProgress = function() {
    document.getElementById('reset-modal').classList.add('open');
  };
  window.closeResetModal = function() {
    document.getElementById('reset-modal').classList.remove('open');
  };
  window.confirmResetAction = function() {
    stopTimer();
    state.submitted = false;
    state.current = 0;
    state.answers = {};
    state.flagged = {};
    state.strikethrough = {};
    state.elapsed = 0;
    state.qTimeSpent = {};

    clearProgress();
    closeResetModal();
    showScreen('start-screen');
  };

  /* ─── PDF EXPORTS ────────────────────────────────────────────── */
  window.onExportFilterChange = function(checkbox) {
    const allCb = document.querySelector('input[name="export-all"]');
    const wrongCb = document.querySelector('input[name="export-wrong"]');
    const flaggedCb = document.querySelector('input[name="export-flagged"]');
    if (checkbox.name === 'export-all' && checkbox.checked) {
      wrongCb.checked = false; flaggedCb.checked = false;
    } else if (checkbox.name !== 'export-all' && checkbox.checked) {
      allCb.checked = false;
    }
    if (!allCb.checked && !wrongCb.checked && !flaggedCb.checked) allCb.checked = true;
  };

  function updateExportBadges() {
    let allC = 0, wrongC = 0, flaggedC = 0;
    SESSION_QUESTIONS.forEach((q, i) => {
      const ans = state.answers[i];
      allC++;
      if (ans !== undefined && ans !== q.correct) wrongC++;
      if (state.flagged[i]) flaggedC++;
    });
    document.getElementById('badge-all').textContent = allC;
    document.getElementById('badge-wrong').textContent = wrongC;
    document.getElementById('badge-flagged').textContent = flaggedC;
  }

  window.exportToPDF = function() {
    const allCb = document.querySelector('input[name="export-all"]');
    const wrongCb = document.querySelector('input[name="export-wrong"]');
    const flaggedCb = document.querySelector('input[name="export-flagged"]');

    let filter = 'all';
    if (!allCb.checked) {
      if (wrongCb.checked && !flaggedCb.checked) filter = 'wrong';
      else if (flaggedCb.checked && !wrongCb.checked) filter = 'flagged';
      else if (wrongCb.checked && flaggedCb.checked) filter = 'wrong+flagged';
    }

    EngineShared.showToast('Compiling high-quality PDF report...');

    const title = BANK_CONFIG.title;
    const pct = document.getElementById('res-pct').textContent;
    const grade = document.getElementById('res-grade').textContent;
    const correct = document.getElementById('res-correct').textContent;
    const wrongN = document.getElementById('res-wrong').textContent;
    const skipped = document.getElementById('res-skipped').textContent;
    const timeUsed = document.getElementById('res-time').textContent;

    const toExport = [];
    SESSION_QUESTIONS.forEach((q, i) => {
      const ans = state.answers[i];
      const isCorrect = ans === q.correct;
      const isSkipped = ans === undefined;
      const isFlagged = !!state.flagged[i];
      const show = filter === 'all'
        || (filter === 'wrong' && !isCorrect && !isSkipped)
        || (filter === 'flagged' && isFlagged)
        || (filter === 'wrong+flagged' && ((!isCorrect && !isSkipped) || isFlagged));
      if (show) toExport.push({ q, i, ans, isCorrect, isSkipped, isFlagged });
    });

    var container = document.createElement('div');
    var currentChunkHtml = `
      <h1 style="font-size:22px;margin:0 0 4px;font-family:Georgia,serif;color:#1a2332;">${title}</h1>
      <p style="color:#64748b;margin:0 0 16px;font-size:13px;">UWorld simulated block report &bull; ${new Date().toLocaleDateString()}</p>
      <div style="background:#f1f5f9;border-radius:12px;padding:18px;margin-bottom:22px;border:1.5px solid #cbd5e1;display:flex;gap:18px;align-items:center;">
        <div style="width:80px;height:80px;border-radius:50%;border:4px solid #0284c7;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(2,132,199,0.1);">
          <div style="font-size:20px;font-weight:700;color:#0284c7;">${pct}</div>
          <div style="font-size:9px;color:#64748b;">SCORE</div>
        </div>
        <div>
          <h2 style="font-size:16px;margin:0 0 8px;color:#1a2332;">${grade}</h2>
          <div style="display:flex;gap:6px;">
            <span style="background:#ffffff;padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;font-size:11px;color:#334155;">Correct: <b>${correct}</b></span>
            <span style="background:#ffffff;padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;font-size:11px;color:#334155;">Wrong: <b>${wrongN}</b></span>
            <span style="background:#ffffff;padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;font-size:11px;color:#334155;">Skipped: <b>${skipped}</b></span>
            <span style="background:#ffffff;padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;font-size:11px;color:#334155;">Time: <b>${timeUsed}</b></span>
          </div>
        </div>
      </div>
    `;

    toExport.forEach((item, idx) => {
      const q = item.q, i = item.i, ans = item.ans;
      const isCorrect = item.isCorrect, isSkipped = item.isSkipped, isFlagged = item.isFlagged;
      
      const sc = isSkipped ? '#64748b' : (isCorrect ? '#10b981' : '#ef4444');
      const bgH = isSkipped ? '#f8fafc' : (isCorrect ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)');
      
      currentChunkHtml += `
        <div style="border:1.5px solid ${sc};border-radius:10px;margin-bottom:14px;overflow:hidden;page-break-inside:avoid;">
          <div style="padding:12px;background:${bgH};">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:600;">Question ${i + 1} ${isFlagged ? '&bull; Flagged' : ''}</div>
            <div style="font-size:13px;font-weight:500;margin-top:4px;color:#1a2332;">${q.question}</div>
          </div>
          <div style="padding:12px;background:#ffffff;border-top:1px solid #e2e8f0;color:#1a2332;">
            ${!isSkipped ? `<div style="font-size:12px;margin-bottom:4px;color:${isCorrect ? '#10b981' : '#ef4444'};">Your Choice: <b>${KEYS[ans]}. ${q.options[ans]}</b></div>` : ''}
            <div style="font-size:12px;margin-bottom:6px;color:#10b981;">Correct Choice: <b>${KEYS[q.correct]}. ${q.options[q.correct]}</b></div>
            <div style="font-size:11px;color:#475569;background:#f8fafc;padding:8px;border-radius:6px;border-left:3px solid #0284c7;">
              <b style="color:#1a2332;">Explanation:</b> ${q.explanation}
            </div>
          </div>
        </div>
      `;
    });

    var chunkDiv = document.createElement('div');
    chunkDiv.innerHTML = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px;color:#1a2332;background:#ffffff;">${currentChunkHtml}</div>`;
    container.appendChild(chunkDiv);

    var filename = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_results.pdf';
    var opt = {
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    function runExport() {
      if (typeof html2pdf === 'undefined') {
        EngineShared.showToast('PDF library loading failed. Try reloading.');
        return;
      }
      html2pdf().set(opt).from(container.children[0]).save();
    }

    if (typeof html2pdf !== 'undefined') {
      runExport();
    } else {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = runExport;
      document.head.appendChild(s);
    }
  };

  /* ─── KEYBOARD SHORTCUTS ─────────────────────────────────────── */
  EngineShared.setupShortcuts({
    isActive: function() { return document.getElementById('quiz-screen')?.classList.contains('active') && !state.submitted; },
    onPrev: function() { if (state.current > 0) goToPrev(); },
    onNext: function() { if (state.current < SESSION_QUESTIONS.length - 1) goToNext(); },
    onFlag: function() { toggleFlagCurrent(); },
    onSelect: function(n) { if (!state.isHighlighterMode) selectOptionCard(state.current, n - 1); },
    onSubmit: function() { attemptSubmit(); },
    onEscape: function() { closeModal(); closeResetModal(); closeBankResetModal(); },
    onHelp: function() { toggleKbHelp ? toggleKbHelp() : null; },
    onToggleHighlighter: function() { toggleHighlighterMode(); },
    onStrikethrough: function() {
      if (_hoveredOption >= 0) {
        toggleCardStrikethrough(state.current, _hoveredOption);
      }
    }
  });

  // Highlighter color keys (1-4) and calculator toggle (C)
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    var quizActive = document.getElementById('quiz-screen')?.classList.contains('active');
    if (!quizActive || state.submitted) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (state.isHighlighterMode && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      _hlLastColor = parseInt(e.key);
      _syncPickerUI();
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) hlApplyColor(_hlLastColor);
      return;
    }
    if (!state.isHighlighterMode && e.key >= '5' && e.key <= '8') {
      e.preventDefault();
      var idx = parseInt(e.key) - 1;
      var card = document.querySelector('.option-card[data-opt-idx="' + idx + '"]');
      if (card) selectOptionCard(state.current, idx);
      return;
    }
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleCalculator();
    }
  });

  /* ─── INITIALIZATION BOOT ─────────────────────────────────────── */
  function initUI() {
    document.title = BANK_CONFIG.title;
    document.getElementById('bank-title').textContent = BANK_CONFIG.title;
    document.getElementById('bank-subtitle').textContent = BANK_CONFIG.description;
    if (BANK_CONFIG.icon) {
      document.getElementById('start-icon').textContent = BANK_CONFIG.icon;
    }

    const bankSize = QUESTION_BANK.length;
    const progress = getBankProgress();
    const covered = progress.shownIndices.length;
    const remaining = Math.max(1, bankSize - covered);
    
    const capCount = document.getElementById('q-count-input');
    capCount.max = remaining;
    capCount.placeholder = remaining;

    selectedCount = Math.min(20, remaining);
    inpCountSetup();

    updateStartScreenStats();

    // Theme icon sync (theme init already done at IIFE top to prevent FOUC)
    window.updateThemeIcon();

    // Wire up mode & order radio buttons to apply visual selection classes
    function applyModeSelection(name, selectedClass) {
      document.querySelectorAll(`input[name="${name}"]`).forEach(function(inp) {
        const opt = inp.closest('label').querySelector('.mode-option');
        if (!opt) return;
        inp.addEventListener('change', function() {
          document.querySelectorAll(`input[name="${name}"]`).forEach(function(r) {
            const o = r.closest('label').querySelector('.mode-option');
            if (o) o.classList.remove(selectedClass);
          });
          opt.classList.add(selectedClass);
          // Show/hide time section based on mode
          if (name === 'quiz-mode') {
            const timeSection = document.getElementById('time-section');
            if (timeSection) timeSection.style.display = inp.value === 'exam' ? '' : 'none';
          }
        });
        // Apply initial state for pre-checked inputs
        if (inp.checked) {
          opt.classList.add(selectedClass);
          if (name === 'quiz-mode') {
            const timeSection = document.getElementById('time-section');
            if (timeSection) timeSection.style.display = inp.value === 'exam' ? '' : 'none';
          }
        }
      });
    }
    applyModeSelection('quiz-mode', 'mode-selected');
    applyModeSelection('quiz-order', 'mode-selected');

    uiReady = true;
  }

  function inpCountSetup() {
    const inp = document.getElementById('q-count-input');
    if (inp) inp.value = selectedCount;
  }

  // Load custom elements
  initUI();
  checkSavedProgress();

  /* ─── ANIMATION WIRING (ripple · theme-spin · screen fade) ─── */
  (function() {
    /* Consolidated click handler: ripple + theme spin */
    document.addEventListener('click', function(e) {
      /* Ripple on .btn-start, .btn-restart, .cbt-end-btn */
      var rippleBtn = e.target.closest('.btn-start, .btn-restart, .cbt-end-btn');
      if (rippleBtn) {
        var wave = document.createElement('span');
        wave.className = 'ripple-wave';
        var r = rippleBtn.getBoundingClientRect();
        wave.style.left = (e.clientX - r.left) + 'px';
        wave.style.top  = (e.clientY - r.top)  + 'px';
        rippleBtn.appendChild(wave);
        wave.addEventListener('animationend', function() { wave.remove(); });
      }

      /* Theme toggle spin animation */
      var themeBtn = e.target.closest('.theme-toggle-btn, .theme-btn-fixed');
      if (themeBtn) {
        themeBtn.classList.remove('theme-spinning');
        void themeBtn.offsetWidth; // force reflow to restart
        themeBtn.classList.add('theme-spinning');
        themeBtn.addEventListener('animationend', function() {
          themeBtn.classList.remove('theme-spinning');
        }, { once: true });
      }
    });

    /* 3. Smooth screen fade transition */
    var _origShowScreen = window.showScreen;
    if (_origShowScreen) {
      window.showScreen = function(id) {
        var current = document.querySelector('.screen.active');
        var target = document.getElementById(id);
        if (!current || current === target) { _origShowScreen(id); return; }
        current.style.transition = 'opacity 0.15s ease';
        current.style.opacity = '0';
        setTimeout(function() {
          current.style.transition = '';
          current.style.opacity = '';
          _origShowScreen(id);
        }, 150);
      };
    }

    /* 4. Restore sidebar open/closed state when quiz starts */
    var _origStartQuiz = window.startQuiz;
    if (_origStartQuiz) {
      window.startQuiz = function() {
        _origStartQuiz();
        var navOpen = localStorage.getItem('uworld_nav_open');
        var pane = document.getElementById('nav-pane');
        if (pane) {
          if (navOpen === '1') {
            pane.classList.remove('collapsed');
          } else {
            pane.classList.add('collapsed');
          }
        }
      };
    }
  })();

})();

