export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createElement(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (val == null || val === false) continue;
      if (key.startsWith('on') && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'style' && typeof val === 'object') {
        Object.assign(el.style, val);
      } else if (key === 'className') {
        el.className = val;
      } else if (key === 'dataset') {
        Object.assign(el.dataset, val);
      } else if (key === 'htmlFor') {
        // JS reserved word → HTML 'for' attribute (used in <label for=...>).
        el.setAttribute('for', val);
      } else if (key.startsWith('aria') || key.startsWith('data')) {
        // Convert ariaLabel → aria-label, dataFoo → data-foo.
        const attrName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        el.setAttribute(attrName, val);
      } else if (key in el && typeof el[key] !== 'function') {
        // Use property setter for known DOM props (value, checked, disabled, type, etc.)
        // so form state updates correctly.
        try { el[key] = val; } catch { el.setAttribute(key, val); }
      } else {
        el.setAttribute(key, val);
      }
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else if (Array.isArray(child)) {
      child.forEach(c => {
        if (c instanceof Node) el.appendChild(c);
        else if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      });
    }
  }
  return el;
}

export const h = createElement;

export function render(container, ...children) {
  container.innerHTML = '';
  for (const child of children) {
    if (child instanceof Node) container.appendChild(child);
    else if (typeof child === 'string') container.innerHTML = child;
  }
}

export function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
export function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
