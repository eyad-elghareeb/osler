let deferredPrompt = null;
const SESSION_KEY = 'osler_session_count';

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; });
}

export function canPrompt() {
  if (!deferredPrompt) return false;
  const count = parseInt(localStorage.getItem(SESSION_KEY) || '0', 10);
  return count >= 5;  // gate at 5 sessions per Metrics target
}

export async function promptInstall() {
  if (!canPrompt()) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}

export function incrementSession() {
  const n = parseInt(localStorage.getItem(SESSION_KEY) || '0', 10) + 1;
  localStorage.setItem(SESSION_KEY, String(n));
}
