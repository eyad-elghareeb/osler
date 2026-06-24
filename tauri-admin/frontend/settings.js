(function () {
  'use strict';

  async function loadSettings() {
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      const userInfo = token ? await window.__TAURI__.core.invoke('auth_user_info') : null;
      panel.innerHTML = `
        <div class="panel" style="grid-template-rows:auto 1fr;">
          <div class="panel-header">
            <div class="panel-header-main">
              <div class="panel-title">Settings</div>
              <div class="muted">GitHub authentication, deploy keys, and preferences</div>
            </div>
          </div>
          <div style="overflow:auto;">
            <div class="overview-section-card" style="margin-bottom:1rem;" id="settings-auth-card">
              <div class="overview-section-card-title">GitHub Authentication</div>
              ${userInfo && userInfo.login ? `
                <div class="tool-row" style="cursor:default;">
                  <div class="tool-icon" style="background:var(--surface2);">✓</div>
                  <div>
                    <div class="tool-name">Signed in as <strong>${escapeHtml(userInfo.login)}</strong></div>
                    <div class="tool-desc">${userInfo.name ? escapeHtml(userInfo.name) : ''} ${userInfo.email ? '· ' + escapeHtml(userInfo.email) : ''}</div>
                  </div>
                  <button class="btn btn-danger" onclick="signOut()" style="margin-left:auto;">Sign Out</button>
                </div>
              ` : `
                <div class="tool-row" style="cursor:default;">
                  <div class="tool-icon" style="background:var(--surface2);">○</div>
                  <div>
                    <div class="tool-name">Not signed in</div>
                    <div class="tool-desc">Sign in with GitHub to use CMS features</div>
                  </div>
                  <button class="btn btn-primary" onclick="signInWithGitHub()" style="margin-left:auto;">Sign In</button>
                </div>
              `}
            </div>

            <div class="overview-section-card" style="margin-bottom:1rem;">
              <div class="overview-section-card-title">Deploy Keys</div>
              <div id="settings-deploy-keys">
                <div class="empty-state">Configure deploy tokens in the Deploy page.</div>
              </div>
            </div>

            <div class="overview-section-card">
              <div class="overview-section-card-title">About</div>
              <div style="font-size:0.85rem;">
                <div style="display:grid;grid-template-columns:auto 1fr;gap:0.3rem 0.75rem;">
                  <span style="color:var(--text-muted);">Version</span>
                  <span>5.1.0</span>
                  <span style="color:var(--text-muted);">App Dir</span>
                  <span style="font-family:monospace;font-size:0.78rem;">${escapeHtml(window.__TAURI__ ? '(Tauri native)' : '(browser dev)')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      panel.innerHTML = '<div class="panel"><div class="empty-state">Failed to load settings: ' + escapeHtml(String(err)) + '</div></div>';
    }
  }

  async function signInWithGitHub() {
    try {
      const result = await window.__TAURI__.core.invoke('auth_login_github');
      const code = result.user_code || '????';
      const uri = result.verification_uri || 'https://github.com/login/device';
      showToast('Code: ' + code + ' — Open ' + uri, 'info');
      const deviceCode = result.device_code;
      const interval = (result.interval || 5) * 1000;
      const poll = setInterval(async () => {
        try {
          const pollResult = await window.__TAURI__.core.invoke('auth_poll_github', { device_code: deviceCode });
          if (pollResult.status === 'success') {
            clearInterval(poll);
            showToast('Signed in successfully!', 'success');
            loadSettings();
          } else if (pollResult.error === 'authorization_pending') {
            // waiting
          } else if (pollResult.error === 'slow_down') {
            // adjust interval
          } else if (pollResult.error === 'expired_token' || pollResult.error === 'access_denied') {
            clearInterval(poll);
            showToast('Authorization ' + pollResult.error, 'error');
          }
        } catch { clearInterval(poll); }
      }, interval);
    } catch (err) {
      showToast('Sign in failed: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
    }
  }

  async function signOut() {
    try {
      await window.__TAURI__.core.invoke('auth_clear_token');
      showToast('Signed out', 'info');
      loadSettings();
    } catch (err) {
      showToast('Sign out failed: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
    }
  }

  function showToast(msg, tone) {
    const s = document.getElementById('toast-stack') || (() => {
      const el = document.createElement('div'); el.id = 'toast-stack'; el.className = 'toast-stack'; document.body.appendChild(el); return el;
    })();
    const t = document.createElement('div'); t.className = 'toast ' + tone; t.textContent = msg;
    s.prepend(t); setTimeout(() => t.remove(), 3600);
  }

  function escapeHtml(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  window.__signInWithGitHub = signInWithGitHub;
  window.__signOut = signOut;
  window.__loadSettings = loadSettings;

  if (window.location.hash === '#settings') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadSettings);
    else loadSettings();
  }
})();
