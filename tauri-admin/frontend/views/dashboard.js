// views/dashboard.js — Overview of the project: stats + quick actions.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  // NOTE: projectState is read live from window.OslerAdmin.projectState inside
  // the view handler rather than destructured at module load, so it stays
  // fresh after refreshProjectState() updates.

  async function loadFileCount() {
    try {
      const res = await invoke("list_files");
      return countFiles(res.items);
    } catch {
      return 0;
    }
  }

  function countFiles(items) {
    if (!Array.isArray(items)) return 0;
    let n = 0;
    for (const item of items) {
      if (item.type === "file") n++;
      else if (item.type === "folder") n += countFiles(item.items);
    }
    return n;
  }

  function countPacks(items) {
    if (!Array.isArray(items)) return 0;
    let n = 0;
    for (const item of items) {
      if (item.type === "folder" && Array.isArray(item.items) && item.items.length === 0) {
        // Leaf folder — potential pack
        if (Array.isArray(item.files) && item.files.length > 0) n++;
      } else if (item.type === "folder") {
        n += countPacks(item.items);
      }
    }
    return n;
  }

  async function loadGit() {
    try {
      return await invoke("git_remote");
    } catch {
      return { remote: "", branch: "" };
    }
  }

  function statTile(label, value, iconPath) {
    const tile = el("div", { class: "card stat-tile" });
    tile.appendChild(el("div", { class: "stat-tile-label" }, label));
    tile.appendChild(el("div", { class: "stat-tile-value" }, String(value)));
    if (iconPath) {
      const ic = svgIcon(iconPath, 20);
      ic.classList.add("stat-tile-icon");
      tile.appendChild(ic);
    }
    return tile;
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.dashboard = async function (view) {
    const projectState = window.OslerAdmin.projectState;
    const wrap = el("div", { class: "view osler-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("dashboard.title")),
        el("p", { class: "subtitle" }, t("dashboard.subtitle"))
      )
    ));

    if (!projectState || !projectState.root) {
      const empty = el("div", { class: "empty-state" });
      empty.appendChild(el("div", { class: "empty-state-icon" }, svgIcon("M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-3H4a1 1 0 0 0-1 1z", 24)));
      empty.appendChild(el("div", { class: "empty-state-title" }, t("dashboard.noProject")));
      empty.appendChild(el("div", { class: "empty-state-text" }, t("dashboard.noProjectDesc")));
      wrap.appendChild(empty);
      view.appendChild(wrap);
      return;
    }

    // ── Config-status banner ───────────────────────────────────────
    // Show a banner prompting the user to run the wizard if no config exists.
    try {
      const ce = await invoke("config_exists");
      if (ce && ce.exists === false) {
        const banner = el("div", { class: "card", style: { padding: "0.75rem 1rem", marginBottom: "1rem", background: "var(--primary-dim)", border: "1px solid var(--primary)", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" } });
        banner.appendChild(el("div", { style: { flex: "1", minWidth: "200px" } },
          el("div", { style: { fontWeight: "600", fontSize: "0.875rem", color: "var(--primary)" } }, t("dashboard.configMissing")),
          el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } }, t("dashboard.configMissingDesc"))
        ));
        const runBtn = el("button", { class: "btn btn-sm btn-primary" }, t("dashboard.runWizard"));
        runBtn.addEventListener("click", () => {
          // Tell the Start wrapper to open on the wizard tab.
          window.__oslerStartTab = "wizard";
          window.OslerAdmin.navigate("start");
        });
        banner.appendChild(runBtn);
        wrap.appendChild(banner);
      }
    } catch {
      // Mock mode or older backend — skip the banner.
    }

    // Stats grid
    const grid = el("div", { class: "grid grid-4" });
    wrap.appendChild(grid);

    // Loading placeholders
    const fileTile = statTile(t("dashboard.stat.files"), "…", "M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z");
    const packTile = statTile(t("dashboard.stat.packs"), "…", "M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-3H4a1 1 0 0 0-1 1z");
    const branchTile = statTile(t("dashboard.stat.branch"), projectState.gitBranch || "—", "M6 3v12M6 21a3 3 0 0 0 3-3M18 3a3 3 0 0 1-3 3M6 15a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3");
    const remoteTile = statTile(t("dashboard.stat.remote"), projectState.gitRemote ? projectState.gitRemote.split("/").pop() : "—", "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z");
    grid.appendChild(fileTile);
    grid.appendChild(packTile);
    grid.appendChild(branchTile);
    grid.appendChild(remoteTile);

    // ── GitHub repo reference card ─────────────────────────────────
    // The repo link is always surfaced on the dashboard per project policy.
    const repoCard = el("div", { class: "card", style: { marginTop: "2rem", padding: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" } });
    const repoIconWrap = el("div", { class: "brand-mark", style: { width: "36px", height: "36px" } });
    repoIconWrap.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.8 1.7 2.6 1.2.1-.7.4-1.2.7-1.5-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.5-5.4 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" /></svg>';
    repoCard.appendChild(repoIconWrap);
    repoCard.appendChild(el("div", { style: { flex: "1", minWidth: "200px" } },
      el("div", { style: { fontWeight: "600", fontSize: "0.875rem" } }, t("dashboard.github")),
      el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } }, t("dashboard.githubDesc"))
    ));
    const repoLink = el("a", { href: "https://github.com/eyad-elghareeb/osler", target: "_blank", rel: "noopener noreferrer", class: "btn btn-sm" }, "github.com/eyad-elghareeb/osler ↗");
    repoCard.appendChild(repoLink);
    wrap.appendChild(repoCard);

    view.appendChild(wrap);

    // Load file count + pack count asynchronously
    loadFileCount().then((count) => {
      fileTile.querySelector(".stat-tile-value").textContent = String(count);
      // packs = leaf folders that contain at least one data file
      return invoke("list_files").then((res) => {
        packTile.querySelector(".stat-tile-value").textContent = String(countPacks(res.items));
      });
    });
  };
})();
