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
          <div id="analytics-study-activity">
            <div class="empty-state" style="font-size:0.82rem;">Loading study events…</div>
          </div>
        </div>
        <div class="overview-section-card" style="margin-bottom:1rem;">
          <div class="overview-section-card-title">Events by Content Type</div>
          <div id="analytics-events-by-type">
            <div class="empty-state" style="font-size:0.82rem;">Loading…</div>
          </div>
        </div>
        <div class="overview-section-card" style="margin-bottom:1rem;">
          <div class="overview-section-card-title">Top Content (by event count)</div>
          <div id="analytics-top-content">
            <div class="empty-state" style="font-size:0.82rem;">Loading…</div>
          </div>
        </div>
        <div class="overview-section-card" style="margin-bottom:1rem;">
          <div class="overview-section-card-title">Daily Active Users (7d)</div>
          <div id="analytics-dau">
            <div class="empty-state" style="font-size:0.82rem;">Loading…</div>
          </div>
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

    // Phase 6.5 fix #18: query Firestore via the REST API for live study
    // events. Previously this section was a hardcoded placeholder string.
    // Now we attempt to fetch via the `query_analytics` Rust command (which
    // uses a Firebase Admin service account credentials stored in tauri-plugin-store).
    // If admin creds aren't configured, we surface a clear actionable message
    // instead of the old generic "Configure in Settings" string.
    try {
      const result = await window.__TAURI__.core.invoke('query_analytics', { window_days: 7 });
      renderStudyActivity(result);
    } catch (e) {
      const msg = String(e?.message || e || '');
      const el = document.getElementById('analytics-study-activity');
      if (el) {
        if (msg.includes('admin credentials not configured') || msg.includes('FIREBASE_ADMIN')) {
          el.innerHTML = '<div class="empty-state" style="font-size:0.82rem;">' +
            'Live study events require Firebase Admin credentials. ' +
            'Generate a service-account JSON in the Firebase console, then ' +
            'store its path via Settings → Deploy Keys → "Firebase Admin JSON".' +
            '</div>';
        } else {
          el.innerHTML = '<div class="empty-state" style="font-size:0.82rem;">Failed to load: ' + escapeHtml(msg) + '</div>';
        }
      }
      // Mark the other 3 sections as needing admin creds too.
      ['analytics-events-by-type', 'analytics-top-content', 'analytics-dau'].forEach(id => {
        const e2 = document.getElementById(id);
        if (e2) e2.innerHTML = '<div class="empty-state" style="font-size:0.82rem;">— (requires Firebase Admin)</div>';
      });
    }
  }

  // Render the study-activity tiles + events-by-type + top-content + DAU
  // from the result of the `query_analytics` Rust command.
  function renderStudyActivity(result) {
    // result shape: { totalEvents, last24h, byType: {quiz, bank, ...},
    //                 topContent: [{contentUid, count}], dau: [{date, count}] }
    const sa = document.getElementById('analytics-study-activity');
    if (sa) {
      sa.innerHTML = `
        <div class="stats-grid" style="margin:0;">
          <div class="stat-card"><div class="stat-value">${result.totalEvents ?? 0}</div><div class="stat-label">Total Events (7d)</div></div>
          <div class="stat-card"><div class="stat-value">${result.last24h ?? 0}</div><div class="stat-label">Events (24h)</div></div>
        </div>`;
    }
    const bt = document.getElementById('analytics-events-by-type');
    if (bt) {
      const entries = Object.entries(result.byType || {});
      bt.innerHTML = entries.length
        ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.5rem;">' +
          entries.map(([k, v]) => `<div class="stat-card"><div class="stat-value">${v}</div><div class="stat-label">${escapeHtml(k)}</div></div>`).join('') +
          '</div>'
        : '<div class="empty-state" style="font-size:0.82rem;">No events in window.</div>';
    }
    const tc = document.getElementById('analytics-top-content');
    if (tc) {
      const items = result.topContent || [];
      tc.innerHTML = items.length
        ? '<ol style="margin:0;padding-left:1.2rem;font-size:0.85rem;">' +
          items.slice(0, 10).map(c => `<li><code>${escapeHtml(c.contentUid)}</code> — ${c.count} events</li>`).join('') +
          '</ol>'
        : '<div class="empty-state" style="font-size:0.82rem;">No content events yet.</div>';
    }
    const dau = document.getElementById('analytics-dau');
    if (dau) {
      const days = result.dau || [];
      dau.innerHTML = days.length
        ? '<div style="display:flex;align-items:flex-end;gap:0.25rem;height:60px;">' +
          days.map(d => `<div title="${escapeHtml(d.date)}: ${d.count} users" style="flex:1;background:var(--accent);height:${Math.max(4, d.count * 6)}px;border-radius:2px 2px 0 0;"></div>`).join('') +
          '</div>'
        : '<div class="empty-state" style="font-size:0.82rem;">No DAU data yet.</div>';
    }
  }

  function escapeHtml(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  window.__loadAnalytics = loadAnalytics;

  if (window.location.hash === '#analytics') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAnalytics);
    else loadAnalytics();
  }
})();
