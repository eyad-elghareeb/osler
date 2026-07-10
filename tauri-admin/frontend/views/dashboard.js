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

  function quickAction(iconPath, title, desc, onClick) {
    const btn = el("button", { class: "card", style: { textAlign: "start", cursor: "pointer", display: "flex", gap: "0.75rem", alignItems: "flex-start" } });
    const iconWrap = el("div", {
      class: "brand-mark",
      style: { width: "40px", height: "40px", flexShrink: "0" },
    });
    iconWrap.appendChild(svgIcon(iconPath, 20));
    const text = el("div", {}, el("div", { style: { fontSize: "0.875rem", fontWeight: "600" } }, title), el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" } }, desc));
    btn.appendChild(iconWrap);
    btn.appendChild(text);
    btn.addEventListener("click", onClick);
    return btn;
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.dashboard = async function (view) {
    const projectState = window.OslerAdmin.projectState;
    const wrap = el("div", { class: "view medos-fade-in" });
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

    // Quick actions
    wrap.appendChild(el("h2", { style: { marginTop: "2rem", marginBottom: "0.75rem", fontSize: "1rem", fontWeight: "600" } }, t("dashboard.quickActions")));
    const qaGrid = el("div", { class: "grid grid-3" });
    qaGrid.appendChild(quickAction(
      "M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM9 13h6M9 17h6",
      t("dashboard.qa.generateManifest"),
      t("dashboard.qa.generateManifestDesc"),
      async () => {
        try {
          const res = await invoke("generate_manifest");
          toast(t("manifest.regenerateDone", { n: (res.generated || []).length }), "success");
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      }
    ));
    qaGrid.appendChild(quickAction(
      "m21 12-7.5 7.5a4.95 4.95 0 0 1-7-7L14 5M16 7l-4-4-4 4M8 17l4 4 4-4",
      t("dashboard.qa.runBuild"),
      t("dashboard.qa.runBuildDesc"),
      () => window.OslerAdmin.navigate("build")
    ));
    qaGrid.appendChild(quickAction(
      "M6 3v12M6 21a3 3 0 0 0 3-3M18 3a3 3 0 0 1-3 3M6 15a3 3 0 0 1 3-3h6a3 3 0 0 0 3-3",
      t("dashboard.qa.gitPush"),
      t("dashboard.qa.gitPushDesc"),
      () => window.OslerAdmin.navigate("git")
    ));
    qaGrid.appendChild(quickAction(
      "M3.5 13.5 12 5l8.5 8.5M5 12v8h14v-8M12 5v15",
      t("dashboard.qa.deploy"),
      t("dashboard.qa.deployDesc"),
      () => window.OslerAdmin.navigate("deploy")
    ));
    wrap.appendChild(qaGrid);

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
