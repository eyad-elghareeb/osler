(function () {
  'use strict';

  async function loadInstancesPage() {
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      let instances = [];
      if (token) {
        const res = await window.__TAURI__.core.invoke('load_instances');
        instances = res.instances || [];
      }
      panel.innerHTML = `
        <div class="panel" style="grid-template-rows:auto 1fr;">
          <div class="panel-header">
            <div class="panel-header-main">
              <div class="panel-title">Managed Instances</div>
              <div class="muted">Push engine updates to deployed instances</div>
            </div>
            <div class="panel-actions">
              <button class="btn" onclick="__openAddInstanceModal()">+ Add Instance</button>
              <button class="btn btn-primary" onclick="__pushUpdateToAll()">Push Update to All</button>
            </div>
          </div>
          <div style="overflow:auto;">
            <div id="instances-list">
              ${instances.length === 0 ? '<div class="empty-state">No managed instances configured. Add one to push updates.</div>' : ''}
              ${instances.map((inst, i) => renderInstanceCard(inst, i)).join('')}
            </div>
            <div id="push-progress" style="display:none;" class="status-strip" style="margin-top:1rem;"></div>
            <div id="push-results" style="display:none; margin-top:1rem;"></div>
          </div>
        </div>
      `;
    } catch (err) {
      panel.innerHTML = '<div class="panel"><div class="empty-state">Failed to load instances: ' + escapeHtml(String(err)) + '</div></div>';
    }
  }

  function renderInstanceCard(inst, idx) {
    const version = inst.version || 'unknown';
    const deployUrl = inst.deployUrl || inst.deploy_url || '';
    return `
      <div class="overview-section-card" style="margin-bottom:0.85rem;" data-instance-idx="${idx}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;">
          <div>
            <div class="tool-name">${escapeHtml(inst.name || inst.repo || 'Unnamed')}</div>
            <div class="tool-desc" style="font-size:0.78rem;font-family:monospace;">
              ${escapeHtml(inst.repo || '')} · v${escapeHtml(version)}
              ${deployUrl ? ' · <a href="' + escapeHtml(deployUrl) + '" target="_blank" style="color:var(--accent);">Deploy URL</a>' : ''}
            </div>
          </div>
          <div style="display:flex;gap:0.45rem;align-items:center;">
            <span class="badge ${version === 'unknown' ? 'status-warn' : 'status-good'}">${escapeHtml(version)}</span>
            <button class="mini-btn" onclick="__deleteInstance('${escapeHtml(inst.name)}')">Remove</button>
          </div>
        </div>
      </div>
    `;
  }

  async function __openAddInstanceModal() {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const subtitle = document.getElementById('modal-subtitle');
    const body = document.getElementById('modal-body');
    if (!modal || !title || !body) return;
    modal.classList.add('open');
    title.textContent = 'Add Managed Instance';
    if (subtitle) subtitle.textContent = 'Configure an instance repo for push updates.';
    body.innerHTML = `
      <div class="field-grid" style="margin-bottom:0.85rem;">
        <div class="field">
          <label>Instance Name</label>
          <input class="text-input" id="inst-name" placeholder="e.g. Production">
        </div>
        <div class="field">
          <label>Repo Owner</label>
          <input class="text-input" id="inst-owner" placeholder="e.g. my-org">
        </div>
        <div class="field">
          <label>Repo Name</label>
          <input class="text-input" id="inst-repo" placeholder="e.g. osler-instance">
        </div>
        <div class="field">
          <label>Branch (optional)</label>
          <input class="text-input" id="inst-branch" placeholder="main" value="main">
        </div>
        <div class="field">
          <label>Deploy URL (optional)</label>
          <input class="text-input" id="inst-url" placeholder="https://...">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="__saveInstance()">Save Instance</button>
      </div>
    `;
  }

  async function __saveInstance() {
    const name = document.getElementById('inst-name')?.value?.trim();
    const owner = document.getElementById('inst-owner')?.value?.trim();
    const repo = document.getElementById('inst-repo')?.value?.trim();
    const branch = document.getElementById('inst-branch')?.value?.trim() || 'main';
    const url = document.getElementById('inst-url')?.value?.trim() || null;
    if (!name || !owner || !repo) {
      showToast('Name, owner, and repo are required.', 'error');
      return;
    }
    try {
      await window.__TAURI__.core.invoke('save_instance', { name, repoOwner: owner, repoName: repo, branch, deployUrl: url });
      showToast('Instance saved: ' + name, 'success');
      const modal = document.getElementById('modal');
      if (modal) modal.classList.remove('open');
      loadInstancesPage();
    } catch (err) {
      showToast('Failed to save instance: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
    }
  }

  async function __deleteInstance(name) {
    if (!confirm('Remove instance "' + name + '"?')) return;
    try {
      await window.__TAURI__.core.invoke('delete_instance', { name });
      showToast('Instance removed: ' + name, 'info');
      loadInstancesPage();
    } catch (err) {
      showToast('Failed to remove instance: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
    }
  }

  async function __pushUpdateToAll() {
    const progress = document.getElementById('push-progress');
    const results = document.getElementById('push-results');
    if (progress) {
      progress.style.display = 'block';
      progress.innerHTML = '<span>Preparing update bundle…</span>';
    }
    if (results) results.style.display = 'none';
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      if (!token) {
        showToast('Sign in with GitHub first to push updates.', 'error');
        return;
      }
      const version = prompt('Update version (e.g. 1.1.0):') || '';
      if (!version) return;
      const changelog = prompt('Changelog (optional):') || '';
      if (progress) progress.innerHTML = '<span>Pushing update v' + escapeHtml(version) + ' to all instances…</span>';
      const result = await window.__TAURI__.core.invoke('push_update', { version, changelog, token, instanceNames: null });
      if (progress) {
        progress.innerHTML = '<span class="status-' + (result.failed > 0 ? 'bad' : 'good') + '">Done: ' + result.successful + ' succeeded, ' + result.failed + ' failed</span>';
      }
      if (results && result.results) {
        results.style.display = 'block';
        results.innerHTML = '<div class="overview-section-card-title">Push Results</div>' +
          result.results.map(r => `
            <div class="activity-entry" style="margin-bottom:0.5rem;">
              <div class="activity-title">${escapeHtml(r.instance)} — ${r.success ? '✓' : '✗'}</div>
              <div class="activity-meta">${r.success ? (r.pr_url ? 'PR: <a href="' + escapeHtml(r.pr_url) + '" target="_blank" style="color:var(--accent);">#' + r.pr_number + '</a>' : 'Success') : (r.error || 'Unknown error')}</div>
            </div>
          `).join('');
      }
      showToast('Push completed: ' + result.successful + '/' + result.total + ' succeeded', result.failed > 0 ? 'warn' : 'success');
    } catch (err) {
      if (progress) progress.innerHTML = '<span class="status-bad">Push failed: ' + escapeHtml(String(err)) + '</span>';
      showToast('Push failed: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
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

  function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) modal.classList.remove('open');
  }

  window.__loadInstancesPage = loadInstancesPage;
  window.__openAddInstanceModal = __openAddInstanceModal;
  window.__saveInstance = __saveInstance;
  window.__deleteInstance = __deleteInstance;
  window.__pushUpdateToAll = __pushUpdateToAll;
  window.closeModal = closeModal;

  if (window.location.hash === '#managed-instances') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadInstancesPage);
    else loadInstancesPage();
  }
})();
