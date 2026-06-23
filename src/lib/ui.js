import { createElement } from './dom.js';

export function Card(content, opts) {
  const el = createElement('div', {
    className: `card${opts?.flat ? ' card-flat' : ''}${opts?.class ? ' ' + opts.class : ''}`,
    style: opts?.style || ''
  });
  if (typeof content === 'string') el.innerHTML = content;
  else if (content instanceof Node) el.appendChild(content);
  return el;
}

export function Button(label, opts) {
  const el = createElement('button', {
    className: `btn${opts?.primary ? ' btn-primary' : ''}${opts?.danger ? ' btn-danger' : ''}${opts?.ghost ? ' btn-ghost' : ''}${opts?.class ? ' ' + opts.class : ''}`,
    onClick: opts?.onClick,
    disabled: opts?.disabled,
    title: opts?.title,
    type: opts?.type || 'button'
  }, label);
  return el;
}

export function Modal(content, opts) {
  const overlay = createElement('div', { className: 'modal-overlay', style: 'display:none;' });
  const modal = createElement('div', { className: 'modal' });
  if (typeof content === 'string') modal.innerHTML = content;
  else if (content instanceof Node) modal.appendChild(content);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  return {
    el: overlay,
    open() { overlay.style.display = 'flex'; },
    close() { overlay.style.display = 'none'; },
    destroy() { overlay.remove(); }
  };
}

export function InstallPrompt() {
  let deferredPrompt = null;
  const el = createElement('div', { className: 'install-prompt', style: 'display:none;' });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    el.style.display = 'flex';
  });
  el.innerHTML = '<p>Install Osler for offline access</p><button class="btn-primary">Install</button><button class="btn-ghost">Not now</button>';
  el.querySelector('button.btn-primary')?.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') el.style.display = 'none';
      deferredPrompt = null;
    }
  });
  el.querySelector('button.btn-ghost')?.addEventListener('click', () => { el.style.display = 'none'; });
  return el;
}

export function CmdKPalette(items) {
  const overlay = createElement('div', { className: 'cmd-k-overlay', style: 'display:none;' });
  const input = createElement('input', { type: 'text', placeholder: 'Search commands…', className: 'cmd-k-input' });
  const list = createElement('div', { className: 'cmd-k-list' });
  const modal = createElement('div', { className: 'cmd-k-modal' });
  modal.append(input, list);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function render(filter) {
    list.innerHTML = '';
    const filtered = items.filter(i => !filter || i.label.toLowerCase().includes(filter.toLowerCase()));
    filtered.forEach(item => {
      const btn = createElement('button', {
        className: 'cmd-k-item',
        onClick: () => { item.action(); close(); }
      }, item.label);
      list.appendChild(btn);
    });
  }

  input.addEventListener('input', () => render(input.value));

  function open() { overlay.style.display = 'flex'; render(''); input.focus(); }
  function close() { overlay.style.display = 'none'; input.value = ''; }
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); open(); }
    if (e.key === 'Escape' && overlay.style.display === 'flex') close();
  });

  return { el: overlay, open, close };
}
