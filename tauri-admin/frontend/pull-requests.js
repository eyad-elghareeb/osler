(function () {
  'use strict';

  async function loadPRs() {
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      if (!token) return;
      const state = await window.__TAURI__.core.invoke('project_state');
      const remote = state.git && state.git.remote;
      if (!remote) return;
      const parsed = parseRemote(remote);
      if (!parsed) return;
      const [owner, repo] = parsed;
      const data = await window.__TAURI__.core.invoke('list_prs', { owner, repo, token });
      renderPRList(data);
    } catch { /* silently degrade */ }
  }

  function parseRemote(remote) {
    if (!remote) return null;
    const m = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    return m ? [m[1], m[2]] : null;
  }

  function renderPRList(data) {
    const prs = Array.isArray(data) ? data : (data && Array.isArray(data.pulls) ? data.pulls : []);
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    const html = `
      <div class="panel" style="grid-template-rows:auto 1fr;">
        <div class="panel-header">
          <div class="panel-header-main">
            <div class="panel-title">Pull Requests</div>
            <div class="muted">${prs.length} open PR(s)</div>
          </div>
        </div>
        <div style="overflow:auto;">
          ${prs.length === 0 ? '<div class="empty-state">No open pull requests.</div>' : ''}
          ${prs.map(pr => `
            <div class="tool-row" style="cursor:pointer;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:0.5rem;padding:0.65rem 0.75rem;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                  <span class="badge" style="background:rgba(46,160,67,0.15);color:var(--correct);border-color:rgba(46,160,67,0.3);">#${pr.number}</span>
                  <span style="font-weight:700;font-size:0.9rem;">${escapeHtml(pr.title || '')}</span>
                  ${pr.labels && Array.isArray(pr.labels) ? pr.labels.map(l => `<span class="badge">${escapeHtml(l.name || '')}</span>`).join('') : ''}
                </div>
                <div style="margin-top:0.3rem;font-size:0.82rem;color:var(--text-muted);">
                  ${pr.user ? 'by <strong>' + escapeHtml(pr.user.login) + '</strong>' : ''}
                  ${pr.created_at ? ' · opened ' + timeAgo(pr.created_at) : ''}
                  ${pr.head ? ' · ' + escapeHtml(pr.head.ref) + ' → ' + escapeHtml(pr.base.ref) : ''}
                </div>
                ${pr.body ? '<div style="margin-top:0.3rem;font-size:0.82rem;color:var(--text-muted);white-space:pre-wrap;word-break:break-word;max-height:60px;overflow:hidden;">' + escapeHtml(pr.body.slice(0, 200)) + '</div>' : ''}
              </div>
              <div style="display:flex;flex-direction:column;gap:0.3rem;flex-shrink:0;">
                ${pr.html_url ? `<button class="mini-btn" onclick="window.__openInBrowser('${escapeHtml(pr.html_url)}')">View</button>` : ''}
                <button class="mini-btn" onclick="mergePR(${pr.number}, '${escapeHtml(pr.title || '')}')">Merge</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    panel.innerHTML = html;
  }

  async function mergePR(number, title) {
    if (!confirm('Merge PR #' + number + ': "' + title.slice(0, 60) + '"?')) return;
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      const state = await window.__TAURI__.core.invoke('project_state');
      const remote = state.git && state.git.remote;
      const parsed = parseRemote(remote);
      if (!parsed || !token) return;
      await window.__TAURI__.core.invoke('merge_pr', { owner: parsed[0], repo: parsed[1], pr_number: number, token });
      showToast('PR #' + number + ' merged', 'success');
      loadPRs();
    } catch (err) {
      showToast('Merge failed: ' + (typeof err === 'string' ? err : err.message || 'Error'), 'error');
    }
  }

  function timeAgo(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const sec = Math.floor((now - d) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const days = Math.floor(hr / 24);
    return days + 'd ago';
  }

  function showToast(msg, tone) {
    const stack = document.getElementById('toast-stack') || (() => {
      const el = document.createElement('div'); el.id = 'toast-stack'; el.className = 'toast-stack'; document.body.appendChild(el); return el;
    })();
    const t = document.createElement('div'); t.className = 'toast ' + tone; t.textContent = msg;
    stack.prepend(t); setTimeout(() => t.remove(), 3600);
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.__mergePR = mergePR;

  if (window.location.hash === '#pull-requests') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadPRs);
    else loadPRs();
  }
})();
