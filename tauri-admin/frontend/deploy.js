(function () {
  'use strict';

  async function loadDeployPage() {
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    try {
      const state = await window.__TAURI__.core.invoke('project_state');
      const deployMeta = state.deploy || {};
      const providers = deployMeta.providers || {};
      const liveUrl = deployMeta.liveUrl || '';
      panel.innerHTML = `
        <div class="panel" style="grid-template-rows:auto 1fr;">
          <div class="panel-header">
            <div class="panel-header-main">
              <div class="panel-title">Deploy</div>
              <div class="muted">${liveUrl ? 'Live at <a href="' + escapeHtml(liveUrl) + '" target="_blank" style="color:var(--accent);">' + escapeHtml(liveUrl) + '</a>' : 'Not deployed yet'}</div>
            </div>
          </div>
          <div style="overflow:auto;">
            <div class="stats-grid" style="margin-bottom:1rem;">
              <div class="stat-card">
                <div class="stat-value">${escapeHtml(providers.github ? providers.github.name || 'GitHub' : '—')}</div>
                <div class="stat-label">GitHub Pages</div>
                <button class="btn" onclick="deployProvider('github')" style="margin-top:0.5rem;width:100%;">${providers.github ? 'Redeploy' : 'Configure'} GitHub Pages</button>
              </div>
              <div class="stat-card">
                <div class="stat-value">${escapeHtml(providers.netlify ? providers.netlify.name || 'Netlify' : '—')}</div>
                <div class="stat-label">Netlify</div>
                <button class="btn" onclick="deployProvider('netlify')" style="margin-top:0.5rem;width:100%;">${providers.netlify ? 'Redeploy' : 'Configure'} Netlify</button>
              </div>
              <div class="stat-card">
                <div class="stat-value">${escapeHtml(providers.vercel ? providers.vercel.name || 'Vercel' : '—')}</div>
                <div class="stat-label">Vercel</div>
                <button class="btn" onclick="deployProvider('vercel')" style="margin-top:0.5rem;width:100%;">${providers.vercel ? 'Redeploy' : 'Configure'} Vercel</button>
              </div>
            </div>
            <div id="deploy-progress" style="display:none;">
              <div class="status-strip" style="margin-bottom:0.5rem;">
                <span>Deploying…</span>
                <span id="deploy-status" class="status-info"></span>
              </div>
            </div>
            <div id="deploy-output" style="display:none;" class="activity"></div>
          </div>
        </div>
      `;
    } catch (err) {
      panel.innerHTML = '<div class="panel"><div class="empty-state">Failed to load deploy state: ' + escapeHtml(String(err)) + '</div></div>';
    }
  }

  async function deployProvider(provider) {
    const progress = document.getElementById('deploy-progress');
    const status = document.getElementById('deploy-status');
    const output = document.getElementById('deploy-output');
    if (progress) progress.style.display = 'block';
    if (status) status.textContent = 'Starting ' + provider + ' deploy…';
    if (output) { output.style.display = 'none'; output.innerHTML = ''; }
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      if (!token) {
        if (status) status.textContent = 'No GitHub token — sign in first.';
        return;
      }
      const result = await window.__TAURI__.core.invoke('provider_deploy', { provider, token });
      if (status) status.textContent = 'Deploy complete!';
      if (output) {
        output.innerHTML = '<div class="activity-title" style="margin-bottom:0.5rem;">Deploy Result</div>';
        output.innerHTML += '<div class="activity-entry">' + escapeHtml(JSON.stringify(result, null, 2)) + '</div>';
        output.style.display = 'block';
      }
      showToast('Deploy to ' + provider + ' completed', 'success');
    } catch (err) {
      if (status) status.textContent = 'Deploy failed';
      if (output) {
        output.innerHTML = '<div class="activity-title" style="margin-bottom:0.5rem;">Error</div>';
        output.innerHTML += '<div class="activity-entry" style="border-color:var(--wrong);">' + escapeHtml(typeof err === 'string' ? err : err.message || 'Unknown error') + '</div>';
        output.style.display = 'block';
      }
      showToast('Deploy failed', 'error');
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

  window.__deployProvider = deployProvider;
  window.__loadDeployPage = loadDeployPage;

  if (window.location.hash === '#deploy') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadDeployPage);
    else loadDeployPage();
  }
})();
