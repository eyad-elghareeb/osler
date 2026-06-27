(function () {
  'use strict';

  async function loadUpdatesPage() {
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    try {
      const status = await window.__TAURI__.core.invoke('get_update_status');
      panel.innerHTML = `
        <div class="panel" style="grid-template-rows:auto 1fr;">
          <div class="panel-header">
            <div class="panel-header-main">
              <div class="panel-title">Updates</div>
              <div class="muted">Check for new releases and apply updates to the admin dashboard</div>
            </div>
            <div class="panel-actions">
              <button class="btn btn-primary" onclick="__checkForUpdate()">Check for Updates</button>
            </div>
          </div>
          <div style="overflow:auto;">
            <div id="update-status-card" class="overview-section-card" style="margin-bottom:1rem;">
              ${renderUpdateStatus(status)}
            </div>
            <div id="update-progress" style="display:none;" class="status-strip" style="margin-bottom:1rem;"></div>
            <div id="update-changelog" style="display:none;" class="overview-section-card"></div>
          </div>
        </div>
      `;
    } catch (err) {
      panel.innerHTML = '<div class="panel"><div class="empty-state">Failed to load update status: ' + escapeHtml(String(err)) + '</div></div>';
    }
  }

  function renderUpdateStatus(status) {
    if (!status) return '<div class="empty-state">No update status available.</div>';
    const current = escapeHtml(status.current_version || '?');
    const latest = escapeHtml(status.latest_version || '?');
    if (status.checking) {
      return '<div class="tool-row" style="cursor:default;"><div class="status-info">Checking for updates…</div></div>';
    }
    if (status.error) {
      return `
        <div class="tool-row" style="cursor:default;">
          <div class="tool-icon" style="background:var(--surface2);color:var(--wrong);">!</div>
          <div>
            <div class="tool-name">Update check failed</div>
            <div class="tool-desc">${escapeHtml(status.error)}</div>
          </div>
        </div>
      `;
    }
    if (status.available) {
      return `
        <div class="tool-row" style="cursor:default;">
          <div class="tool-icon" style="background:var(--accent-dim);color:var(--accent);">↑</div>
          <div>
            <div class="tool-name">Update available: v${latest}</div>
            <div class="tool-desc">Current version: v${current} — <button class="btn btn-primary" onclick="__applyUpdate()" style="padding:0.3rem 0.8rem;font-size:0.82rem;min-height:auto;">Update & Restart</button></div>
          </div>
        </div>
      `;
    }
    return `
      <div class="tool-row" style="cursor:default;">
        <div class="tool-icon" style="background:var(--surface2);color:var(--correct);">✓</div>
        <div>
          <div class="tool-name">Up to date — v${current}</div>
          <div class="tool-desc">Latest version: v${latest}</div>
        </div>
      </div>
    `;
  }

  async function __checkForUpdate() {
    const card = document.getElementById('update-status-card');
    if (card) card.innerHTML = '<div class="status-info">Checking for updates…</div>';
    const progress = document.getElementById('update-progress');
    if (progress) progress.style.display = 'block';
    try {
      const result = await window.__TAURI__.core.invoke('check_update');
      if (card) card.innerHTML = renderUpdateStatus(result);
      const changelog = document.getElementById('update-changelog');
      if (changelog && result.release_notes) {
        changelog.style.display = 'block';
        changelog.innerHTML = `
          <div class="overview-section-card-title">Release Notes</div>
          <div style="font-size:0.85rem;white-space:pre-wrap;">${escapeHtml(result.release_notes)}</div>
        `;
      }
      showToast(result.available ? 'Update available!' : 'Up to date.', result.available ? 'warn' : 'success');
    } catch (err) {
      if (card) card.innerHTML = '<div class="empty-state">Check failed: ' + escapeHtml(String(err)) + '</div>';
      showToast('Update check failed', 'error');
    }
    if (progress) progress.style.display = 'none';
  }

  async function __applyUpdate() {
    const progress = document.getElementById('update-progress');
    if (progress) {
      progress.style.display = 'block';
      progress.innerHTML = '<span>Downloading update…</span> <span class="status-info" id="update-dl-status"></span>';
    }
    try {
      const result = await window.__TAURI__.core.invoke('apply_update');
      showToast(result.message || 'Update applied. Restarting…', 'success');
      if (progress) {
        progress.innerHTML = '<span class="status-good">Update downloaded and applied. Please restart the application.</span>';
      }
    } catch (err) {
      if (progress) {
        progress.innerHTML = '<span class="status-bad">Update failed: ' + escapeHtml(String(err)) + '</span>';
      }
      showToast('Update failed: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
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

  window.__loadUpdatesPage = loadUpdatesPage;
  window.__checkForUpdate = __checkForUpdate;
  window.__applyUpdate = __applyUpdate;

  if (window.location.hash === '#updates') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadUpdatesPage);
    else loadUpdatesPage();
  }
})();
