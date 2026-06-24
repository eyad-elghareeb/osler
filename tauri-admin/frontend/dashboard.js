(function () {
  'use strict';

  async function loadDashboardData() {
    try {
      const token = await window.__TAURI__.core.invoke('auth_get_token');
      if (!token) return;
      const state = await window.__TAURI__.core.invoke('project_state');
      const remote = state.git && state.git.remote;
      if (!remote) return;
      const parsed = parseRemote(remote);
      if (!parsed) return;
      const [owner, repo] = parsed;
      const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'Osler-Admin/5.1' };
      const [repoData, pullsData, commitsData] = await Promise.all([
        fetch('https://api.github.com/repos/' + owner + '/' + repo, { headers }).then(r => r.json()).catch(() => null),
        fetch('https://api.github.com/repos/' + owner + '/' + repo + '/pulls?state=open&sort=updated&per_page=5', { headers }).then(r => r.json()).catch(() => null),
        fetch('https://api.github.com/repos/' + owner + '/' + repo + '/commits?per_page=5', { headers }).then(r => r.json()).catch(() => null),
      ]);
      renderGitHubWidgets(repoData, pullsData, commitsData);
    } catch { /* silently degrade - no token or network */ }
  }

  function parseRemote(remote) {
    if (!remote) return null;
    const m = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    return m ? [m[1], m[2]] : null;
  }

  function renderGitHubWidgets(repo, pulls, commits) {
    const overviewGrid = document.querySelector('.overview-grid');
    if (!overviewGrid) return;
    const widgets = document.createElement('div');
    widgets.className = 'overview-card';
    widgets.style.gridColumn = '1 / -1';
    let html = '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;color:var(--text-muted);margin-bottom:0.65rem;">GitHub Overview</div>';
    if (repo && repo.full_name) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.5rem;">';
      html += '<span style="font-weight:600;font-size:0.9rem;">' + escapeHtml(repo.full_name) + '</span>';
      if (repo.stargazers_count !== undefined) html += '<span class="badge">★ ' + repo.stargazers_count + '</span>';
      if (repo.forks_count !== undefined) html += '<span class="badge">⑂ ' + repo.forks_count + '</span>';
      if (repo.open_issues_count !== undefined) html += '<span class="badge">● ' + repo.open_issues_count + '</span>';
      if (repo.language) html += '<span class="badge">' + escapeHtml(repo.language) + '</span>';
      html += '</div>';
    }
    if (pulls && Array.isArray(pulls) && pulls.length) {
      html += '<div style="margin-bottom:0.5rem;"><span style="font-weight:600;font-size:0.8rem;">Open PRs (' + pulls.length + ')</span></div>';
      html += '<div class="overview-list">';
      pulls.forEach(pr => {
        html += '<a class="recent-file-row" href="' + escapeHtml(pr.html_url || '#') + '" target="_blank" style="text-decoration:none;">';
        html += '<span class="recent-file-icon" style="font-size:0.7rem;">#' + pr.number + '</span>';
        html += '<span class="recent-file-name">' + escapeHtml(pr.title || '') + '</span>';
        html += '<span class="badge" style="font-size:0.65rem;">' + (pr.user ? escapeHtml(pr.user.login) : '') + '</span>';
        html += '</a>';
      });
      html += '</div>';
    }
    if (commits && Array.isArray(commits) && commits.length) {
      html += '<div style="margin-top:0.5rem;"><span style="font-weight:600;font-size:0.8rem;">Recent Commits</span></div>';
      html += '<div class="overview-list">';
      commits.slice(0, 3).forEach(c => {
        const msg = c.commit ? c.commit.message || '' : '';
        const shortMsg = msg.split('\n')[0].slice(0, 60);
        html += '<div class="recent-file-row" style="cursor:default;">';
        html += '<span class="recent-file-icon" style="font-size:0.65rem;font-family:monospace;">' + (c.sha ? c.sha.slice(0, 7) : '') + '</span>';
        html += '<span class="recent-file-name">' + escapeHtml(shortMsg) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    if (repo && repo.description) {
      html += '<div style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-muted);">' + escapeHtml(repo.description) + '</div>';
    }
    widgets.innerHTML = html;
    overviewGrid.appendChild(widgets);
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderAICostWidget() {
    const overviewGrid = document.querySelector('.overview-grid');
    if (!overviewGrid) return;
    let raw;
    try { raw = JSON.parse(localStorage.getItem('osler_ai_costs') || '{}'); } catch { raw = {}; }
    const today = raw.today || 0;
    const month = raw.month || 0;
    const card = document.createElement('div');
    card.className = 'overview-card';
    card.style.gridColumn = '1 / -1';
    card.innerHTML = '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;color:var(--text-muted);margin-bottom:0.65rem;">AI Usage Costs</div>' +
      '<div style="display:flex;gap:1.5rem;">' +
      '<div><span style="font-size:0.75rem;color:var(--text-muted);">Today</span><br><span style="font-size:1.15rem;font-weight:700;' + (today >= 20 ? 'color:var(--wrong);' : '') + '">$' + today.toFixed(2) + '</span></div>' +
      '<div><span style="font-size:0.75rem;color:var(--text-muted);">This Month</span><br><span style="font-size:1.15rem;font-weight:700;' + (month >= 200 ? 'color:var(--wrong);' : '') + '">$' + month.toFixed(2) + '</span></div>' +
      '<div><span style="font-size:0.75rem;color:var(--text-muted);">Daily Cap</span><br><span style="font-size:1.15rem;font-weight:700;">$20.00</span></div>' +
      '<div><span style="font-size:0.75rem;color:var(--text-muted);">Monthly Cap</span><br><span style="font-size:1.15rem;font-weight:700;">$200.00</span></div>' +
      '</div>';
    overviewGrid.appendChild(card);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(loadDashboardData, 500);
      setTimeout(renderAICostWidget, 600);
    });
  } else {
    setTimeout(loadDashboardData, 500);
    setTimeout(renderAICostWidget, 600);
  }
})();
