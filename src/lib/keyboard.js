let _handler = null;

export function setupShortcuts(handlers) {
  if (_handler) document.removeEventListener('keydown', _handler);
  _handler = e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (handlers.isActive && !handlers.isActive()) return;
    switch (e.key) {
      case 'ArrowLeft':
        if (handlers.onPrev) { e.preventDefault(); handlers.onPrev(); }
        break;
      case 'ArrowRight':
        if (handlers.onNext) { e.preventDefault(); handlers.onNext(); }
        break;
      case '1': case '2': case '3': case '4':
        if (handlers.onSelect) { e.preventDefault(); handlers.onSelect(parseInt(e.key)); }
        break;
      case 'f': case 'F':
        if (handlers.onFlag && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); handlers.onFlag(); }
        break;
      case 'h': case 'H':
        if (handlers.onToggleHighlighter && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); handlers.onToggleHighlighter(); }
        break;
      case 's': case 'S':
        if (handlers.onStrikethrough && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); handlers.onStrikethrough(); }
        break;
      case 'Enter':
        if (handlers.onSubmit) { e.preventDefault(); handlers.onSubmit(); }
        break;
      case '/':
        if (handlers.onHelp) { e.preventDefault(); handlers.onHelp(); }
        break;
      case 'Escape':
        if (handlers.onEscape) { e.preventDefault(); handlers.onEscape(); }
        break;
    }
  };
  document.addEventListener('keydown', _handler);
}

export function teardownShortcuts() {
  if (_handler) {
    document.removeEventListener('keydown', _handler);
    _handler = null;
  }
}
