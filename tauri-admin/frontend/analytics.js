(function () {
  'use strict';

  async function loadAnalytics() {
    const panel = document.getElementById('workspace-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="panel" style="grid-template-rows:auto 1fr;">
        <div class="panel-header">
          <div class="panel-header-main">
            <div class="panel-title">Analytics</div>
            <div class="muted">Admin-wide study metrics</div>
          </div>
        </div>
        <div id="analytics-content" style="overflow:auto;">
          <div class="empty-state">Analytics dashboard loading…</div>
        </div>
      </div>
    `;
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      if (!token) {
        document.getElementById('analytics-content').innerHTML = '<div class="empty-state">Sign in with GitHub to view analytics.</div>';
        return;
      }
      const state = await window.__TAURI__.core.invoke('project_state');
      const summary = state.summary || {};
      const content = document.getElementById('analytics-content');
      content.innerHTML = `
        <div class="stats-grid" style="margin-bottom:1rem;">
          <div class="stat-card">
            <div class="stat-value">${summary.totalHtmlFiles || 0}</div>
            <div class="stat-label">Total Files</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${summary.quizCount || 0}</div>
            <div class="stat-label">Quizzes</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${summary.bankCount || 0}</div>
            <div class="stat-label">Banks</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${summary.flashcardCount || 0}</div>
            <div class="stat-label">Flashcards</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${summary.writtenCount || 0}</div>
            <div class="stat-label">Written</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${summary.osceCount || 0}</div>
            <div class="stat-label">OSCE</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${summary.totalQuestions || 0}</div>
            <div class="stat-label">Total Questions</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${summary.folderCount || 0}</div>
            <div class="stat-label">Folders</div>
          </div>
        </div>
        <div class="overview-section-card" style="margin-bottom:1rem;">
          <div class="overview-section-card-title">Study Activity (24h)</div>
          <div class="empty-state" style="font-size:0.82rem;">Live analytics require Firestore admin access. Configure in Settings.</div>
        </div>
        <div class="overview-section-card">
          <div class="overview-section-card-title">Git Status</div>
          <div id="analytics-git-status">
            <div class="git-status-bar">
              <span class="git-dot" style="background:${state.git && state.git.available ? 'var(--correct)' : 'var(--wrong)'};"></span>
              <span>${state.git && state.git.available ? 'Branch: <strong>' + escapeHtml(state.git.branch || '') + '</strong>' : 'Git not available'}</span>
              ${state.git && state.git.dirtyCount ? '<span class="badge">' + state.git.dirtyCount + ' dirty</span>' : ''}
              ${state.git && state.git.ahead ? '<span class="badge">' + state.git.ahead + ' ahead</span>' : ''}
              ${state.git && state.git.behind ? '<span class="badge">' + state.git.behind + ' behind</span>' : ''}
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      const c = document.getElementById('analytics-content');
      if (c) c.innerHTML = '<div class="empty-state">Failed to load analytics: ' + escapeHtml(String(err)) + '</div>';
    }
  }

  function escapeHtml(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  window.__loadAnalytics = loadAnalytics;

  if (window.location.hash === '#analytics') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAnalytics);
    else loadAnalytics();
  }
})();
