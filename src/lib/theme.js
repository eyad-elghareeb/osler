const CSS_VARS = `:root {
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

const STORAGE_KEY = 'quiz-theme';

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const s = document.createElement('style');
  s.textContent = CSS_VARS;
  document.head.appendChild(s);
  applyThemeBody(saved);
  return saved;
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

export function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  applyThemeBody(next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'light' ? '#f3f0eb' : '#0d1117';
  localStorage.setItem(STORAGE_KEY, next);
  updateThemeIcons();
  return next;
}

function applyThemeBody(theme) {
  document.body.style.background = theme === 'light' ? '#f3f0eb' : '#0d1117';
  document.body.style.color = theme === 'light' ? '#1c1917' : '#e6edf3';
}

export function updateThemeIcons() {
  const isDark = getTheme() === 'dark';
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.textContent = isDark ? '\u2600' : '\u263E';
  });
}
