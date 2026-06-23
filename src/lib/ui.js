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
    ariaLabel: opts?.ariaLabel || opts?.title,
    type: opts?.type || 'button'
  }, label);
  return el;
}

/**
 * Modal with focus trap and focus restore (B6 a11y fix).
 *
 * On open:
 *   - Records the currently focused element (so we can restore on close).
 *   - Shows the overlay.
 *   - Focuses the first focusable element inside the modal.
 *
 * While open:
 *   - Tab/Shift+Tab cycles through focusable elements inside the modal
 *     (does NOT escape to the background).
 *   - Escape closes the modal.
 *
 * On close:
 *   - Hides the overlay.
 *   - Restores focus to the element that was focused before open().
 */
export function Modal(content, opts) {
  const overlay = createElement('div', {
    className: 'modal-overlay',
    style: 'display:none;',
    role: 'dialog',
    ariaModal: 'true',
  });
  const modal = createElement('div', { className: 'modal', tabIndex: '-1' });
  if (typeof content === 'string') modal.innerHTML = content;
  else if (content instanceof Node) modal.appendChild(content);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let _previouslyFocused = null;

  function _getFocusable() {
    // CSS selector for elements that can receive focus.
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(modal.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
  }

  function _handleKeydown(e) {
    if (overlay.style.display === 'none') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = _getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        modal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !modal.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !modal.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  function open() {
    _previouslyFocused = document.activeElement;
    overlay.style.display = 'flex';
    document.addEventListener('keydown', _handleKeydown);
    // Focus first focusable element (or the modal itself) so screen readers
    // announce the dialog and keyboard users can interact immediately.
    const focusable = _getFocusable();
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      modal.focus();
    }
  }

  function close() {
    overlay.style.display = 'none';
    document.removeEventListener('keydown', _handleKeydown);
    if (_previouslyFocused && typeof _previouslyFocused.focus === 'function') {
      _previouslyFocused.focus();
    }
    _previouslyFocused = null;
  }

  function destroy() {
    document.removeEventListener('keydown', _handleKeydown);
    overlay.remove();
  }

  // Click outside the modal closes it.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { el: overlay, open, close, destroy };
}

export function InstallPrompt() {
  let deferredPrompt = null;
  const el = createElement('div', { className: 'install-prompt', style: 'display:none;' });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    el.style.display = 'flex';
  });
  el.innerHTML = '<p>Install Osler for offline access</p><button class="btn-primary" type="button">Install</button><button class="btn-ghost" type="button">Not now</button>';
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
        type: 'button',
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
