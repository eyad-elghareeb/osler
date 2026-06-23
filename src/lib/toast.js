let _timer = null;

export function showToast(msg, actions) {
  actions = actions || [];
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = '';
  const msgSpan = document.createElement('span');
  msgSpan.textContent = msg;
  msgSpan.style.flex = '1';
  t.appendChild(msgSpan);
  if (actions.length > 0) {
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;gap:0.5rem;margin-left:0.75rem;';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.style.cssText = `padding:0.35rem 0.75rem;border-radius:6px;border:1px solid var(--border);background:${a.primary ? 'var(--accent)' : 'var(--surface2)'};color:${a.primary ? '#000' : 'var(--text)'};font-size:0.75rem;font-weight:600;cursor:pointer;transition:all var(--transition);`;
      btn.onclick = () => { a.onClick(); t.classList.remove('show'); };
      container.appendChild(btn);
    });
    t.appendChild(container);
  }
  t.classList.add('show');
  clearTimeout(_timer);
  if (actions.length === 0) {
    _timer = setTimeout(() => t.classList.remove('show'), 2200);
  }
}

export function hideToast() {
  const t = document.getElementById('toast');
  if (t) t.classList.remove('show');
}
