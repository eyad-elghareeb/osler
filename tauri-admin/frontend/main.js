// main.js — Tauri API bridge + multi-app router (Instance Manager vs Content Studio) + shared UI helpers.

(function () {
  "use strict";

  const TAURI_AVAILABLE =
    typeof window !== "undefined" && window.__TAURI__ && typeof window.__TAURI__.core === "object";

  let currentAppMode = "instance-manager"; // "instance-manager" | "content-studio"

  /**
   * Invoke a Tauri command. Returns a Promise.
   * Falls back to a browser mock when not in Tauri.
   */
  async function invoke(cmd, args) {
    if (!TAURI_AVAILABLE) {
      return mockInvoke(cmd, args);
    }
    return window.__TAURI__.core.invoke(cmd, args || {});
  }

  /** Browser-only mock so the UI can be opened without Tauri for preview. */
  async function mockInvoke(cmd, args) {
    let preview = false;
    try {
      preview =
        new URLSearchParams(window.location.search).get("preview") === "1" ||
        localStorage.getItem("osler-admin-preview") === "1";
    } catch {}

    const fakeRoot = "/tmp/osler-preview-project";
    switch (cmd) {
      case "ping":
        return "osler-admin-mock";
      case "project_state":
        return preview
          ? {
              root: fakeRoot,
              hasPackageJson: true,
              hasContentDir: true,
              gitRemote: "https://github.com/example/osler.git",
              gitBranch: "main",
            }
          : { root: null };
      case "pick_project_root":
        return { picked: false };
      case "set_project_root":
        return { root: args && args.root, hasPackageJson: true, hasContentDir: true };
      case "check_prerequisites":
        return {
          allSatisfied: true,
          items: [
            { name: "node", label: "Node.js (Runtime)", installed: true, version: "v20.11.0", requiredVersion: ">= 18.0.0", satisfied: true, details: "Node.js v20.11.0 is ready", fixable: false },
            { name: "git", label: "Git (Version Control)", installed: true, version: "git version 2.43.0", requiredVersion: ">= 2.0", satisfied: true, details: "Git detected", fixable: false },
            { name: "wrangler", label: "Cloudflare Wrangler CLI", installed: true, version: "3.99.0", requiredVersion: ">= 3.0.0", satisfied: true, details: "Wrangler CLI detected (3.99.0)", fixable: true },
            { name: "cloudflare_auth", label: "Cloudflare Account Login", installed: true, version: "Logged In", requiredVersion: "Active session", satisfied: true, details: "Authenticated: admin@example.com", fixable: true },
          ],
        };
      case "check_instance_update":
        return {
          canUpdate: true,
          sourceRoot: "/main/osler",
          targetRoot: args && args.targetPath || fakeRoot,
          hasUpdates: true,
          changedCount: 3,
          addedCount: 1,
          files: [
            { path: "src/app/(app)/qbank/page.tsx", status: "modified", sizeDiff: 120 },
            { path: "src/lib/osler/cloud.ts", status: "modified", sizeDiff: 340 },
            { path: "cloudflare/worker/migrations/0003_content_sync.sql", status: "added", sizeDiff: 850 },
          ],
          preservedPaths: [
            "public/osler-content/ (All question banks, flashcards, articles, images)",
            "public/osler.config.json (Branding, site name, enabled engines)",
            "cloudflare/worker/wrangler.toml (Database IDs & bindings)",
            ".env / .env.local / .dev.vars (All secrets & credentials)",
            ".git/ (Instance git history)",
          ],
        };
      case "list_instance_backups":
        return [
          { id: "backup-1723870000", timestamp: 1723870000, formattedDate: "Backup @ 1723870000s", path: "/backup/1", fileCount: 42 },
        ];
      case "list_files":
        return preview
          ? {
              items: [
                {
                  type: "folder",
                  name: "library",
                  path: "library/",
                  items: [
                    {
                      type: "folder",
                      name: "cardiology",
                      path: "library/cardiology/",
                      items: [
                        { type: "file", name: "ischemic-stroke.md", path: "library/cardiology/ischemic-stroke.md", ext: "md", size: 4200 },
                      ],
                    },
                  ],
                },
                { type: "folder", name: "qbank", path: "qbank/", items: [] },
              ],
            }
          : { items: [] };
      case "load_file":
        return preview
          ? {
              path: args && args.path,
              content: "# Medical Knowledge\n\nSample clinical library text.",
            }
          : { path: args && args.path, content: "" };
      case "save_file":
        return { saved: true, path: args && args.path };
      case "create_file":
        return { created: true, path: args && args.path };
      case "create_folder":
        return { created: true, path: args && args.path };
      case "delete_path":
        return { deleted: true, path: args && args.path };
      case "runner_status":
        return { kind: "", running: false, exitCode: null, startedAt: 0, endedAt: 0, stopRequested: false, logs: [] };
      case "deploy_status":
        return { running: false, success: true, logs: [{ stream: "info", text: "Ready", ts: Date.now() }], error: "" };
      case "generate_instance":
        return { created: true, targetDir: args && args.opts && args.opts.targetDir, files: ["src/", "public/osler.config.json"] };
      case "deploy_pages_cli":
      case "deploy_worker_cli":
      case "deploy_cloudflare_full_stack":
        return { started: true };
      default:
        return {};
    }
  }

  /* ────────────────────── DOM Helpers ────────────────────── */

  function el(tag, attrs, ...children) {
    const element = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (key === "class" || key === "className") {
          element.className = value;
        } else if (key === "style" && typeof value === "object") {
          Object.assign(element.style, value);
        } else if (key.startsWith("on") && typeof value === "function") {
          const event = key.slice(2).toLowerCase();
          element.addEventListener(event, value);
        } else if (key === "dataset" && typeof value === "object") {
          Object.assign(element.dataset, value);
        } else if (value !== false && value !== null && value !== undefined) {
          element.setAttribute(key, value === true ? "" : value);
        }
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      if (typeof child === "string" || typeof child === "number") {
        element.appendChild(document.createTextNode(String(child)));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    }
    return element;
  }

  function svgIcon(pathD, size = 16) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function t(key, params) {
    if (window.OslerAdminI18n && typeof window.OslerAdminI18n.t === "function") {
      return window.OslerAdminI18n.t(key, params);
    }
    return key;
  }

  /* ────────────────────── Toast Notifications ────────────────────── */

  function toast(message, type = "info", duration = 3500) {
    const container = document.getElementById("toasts");
    if (!container) return;

    const tEl = el(
      "div",
      { class: `toast toast-${type}` },
      el("div", { class: "toast-message" }, message)
    );

    container.appendChild(tEl);
    setTimeout(() => {
      tEl.style.opacity = "0";
      tEl.style.transform = "translateY(8px)";
      setTimeout(() => tEl.remove(), 250);
    }, duration);
  }

  /* ────────────────────── Router ────────────────────── */

  const routes = new Map();
  let currentRoute = null;

  function register(route, handler) {
    routes.set(route, handler);
  }

  async function navigate(route) {
    const viewContainer = document.getElementById("view");
    if (!viewContainer) return;

    const handler = routes.get(route);
    if (!handler) {
      console.warn(`Route not found: ${route}`);
      return;
    }

    currentRoute = route;

    // Update active nav styling in sidebar
    document.querySelectorAll(".nav-item").forEach((btn) => {
      const active = btn.getAttribute("data-route") === route;
      btn.classList.toggle("active", active);
    });

    viewContainer.innerHTML = "";
    try {
      await handler(viewContainer);
    } catch (e) {
      console.error(`Error rendering view for ${route}:`, e);
      viewContainer.innerHTML = "";
      viewContainer.appendChild(
        el(
          "div",
          { class: "view osler-fade-in" },
          el("div", { class: "card", style: { padding: "2rem", border: "1px solid var(--danger)" } },
            el("h2", { style: { color: "var(--danger)", margin: "0 0 0.5rem" } }, "View Render Error"),
            el("p", { style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem" } }, String(e))
          )
        )
      );
    }
  }

  /* ────────────────────── App Modes & Sidebar ────────────────────── */

  const NAV_ITEMS_INSTANCE_MANAGER = [
    { route: "instance", icon: "M13 10V3L4 14h7v7l9-11h-7z", labelKey: "nav.instanceGenerator" },
    { route: "instance-updater", icon: "M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9", labelKey: "nav.instanceUpdater" },
    { route: "configure", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", labelKey: "nav.configure" },
    { route: "run-publish", icon: "M3.5 13.5 12 5l8.5 8.5 M5 12v8h14v-8 M12 5v15", labelKey: "nav.runPublish" },
    { route: "prereq", icon: "M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", labelKey: "nav.prereqs" },
  ];

  const NAV_ITEMS_CONTENT_STUDIO = [
    { route: "content", icon: "M4 4h16v16H4z M4 9h16 M9 4v16", labelKey: "nav.content" },
    { route: "manifest", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8", labelKey: "nav.manifest" },
    { route: "git", icon: "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9", labelKey: "nav.gitSync" },
    { route: "settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", labelKey: "nav.settings" },
  ];

  function setAppMode(mode, targetRoute = null) {
    currentAppMode = mode;
    try {
      localStorage.setItem("osler-admin-app-mode", mode);
    } catch {}

    // Update switcher buttons
    const btnInst = document.getElementById("btn-mode-instance");
    const btnStud = document.getElementById("btn-mode-studio");
    if (btnInst) btnInst.classList.toggle("active", mode === "instance-manager");
    if (btnInst) btnInst.setAttribute("aria-pressed", String(mode === "instance-manager"));
    if (btnStud) btnStud.classList.toggle("active", mode === "content-studio");
    if (btnStud) btnStud.setAttribute("aria-pressed", String(mode === "content-studio"));

    // Update brand title
    const titleEl = document.getElementById("app-title-display");
    const subEl = document.getElementById("app-subtitle-display");
    if (titleEl && subEl) {
      if (mode === "instance-manager") {
        titleEl.textContent = t("app.mode.instanceManagerTitle");
        subEl.textContent = t("app.mode.instanceManagerSub");
      } else {
        titleEl.textContent = t("app.mode.contentStudioTitle");
        subEl.textContent = t("app.mode.contentStudioSub");
      }
    }

    // Render navigation for active mode
    renderSidebarNav();

    // Navigate to default route for mode
    const dest = targetRoute || (mode === "instance-manager" ? "instance" : "content");
    navigate(dest);
  }

  function renderSidebarNav() {
    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;
    nav.innerHTML = "";

    const items = currentAppMode === "instance-manager" ? NAV_ITEMS_INSTANCE_MANAGER : NAV_ITEMS_CONTENT_STUDIO;

    for (const item of items) {
      const btn = el(
        "button",
        {
          class: "nav-item" + (currentRoute === item.route ? " active" : ""),
          "data-route": item.route,
          type: "button",
          onClick: () => navigate(item.route),
        },
        svgIcon(item.icon, 16),
        el("span", {}, t(item.labelKey))
      );
      nav.appendChild(btn);
    }
  }

  /* ────────────────────── Project State ────────────────────── */

  let projectState = null;
  const STORAGE_ROOT_KEY = "osler-admin-project-root";

  function saveProjectRoot(path) {
    try {
      localStorage.setItem(STORAGE_ROOT_KEY, path);
    } catch {}
  }

  function loadSavedProjectRoot() {
    try {
      return localStorage.getItem(STORAGE_ROOT_KEY);
    } catch {
      return null;
    }
  }

  async function refreshProjectState() {
    try {
      const st = await invoke("project_state");
      projectState = st;
      updateProjectPill();
      return st;
    } catch (e) {
      console.warn("Failed to fetch project state:", e);
      return null;
    }
  }

  function updateProjectPill() {
    const textEl = document.getElementById("project-pill-text");
    if (!textEl) return;
    if (projectState && projectState.root) {
      const parts = projectState.root.split(/[\\/]/).filter(Boolean);
      const name = parts[parts.length - 1] || projectState.root;
      textEl.textContent = name;
      textEl.parentElement.setAttribute("title", projectState.root);
      textEl.parentElement.classList.add("connected");
    } else {
      textEl.textContent = t("project.notPicked");
      textEl.parentElement.setAttribute("title", t("project.pickTitle"));
      textEl.parentElement.classList.remove("connected");
    }
  }

  async function pickProjectRoot() {
    try {
      const folder = await invoke("plugin:dialog|open", {
        options: { directory: true, title: t("project.pickTitle"), multiple: false },
      });
      const p = typeof folder === "string" ? folder : null;
      if (!p) return;

      const res = await invoke("set_project_root", { root: p });
      saveProjectRoot(p);
      await refreshProjectState();
      toast(t("project.state.connected"), "success");

      // Auto-navigate to appropriate view
      if (currentAppMode === "instance-manager") {
        navigate("instance");
      } else {
        navigate("content");
      }
    } catch (e) {
      if (!TAURI_AVAILABLE) {
        toast("Not running in Tauri", "error");
      } else {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    }
  }

  function requireProject() {
    if (!projectState || !projectState.root) {
      toast(t("toast.notPicked"), "error");
      return false;
    }
    return true;
  }

  /* ────────────────────── Theme Toggle ────────────────────── */

  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    try {
      localStorage.setItem("osler-admin-theme", next);
    } catch {}
    updateThemeIcon();
  }

  function updateThemeIcon() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const sun = document.getElementById("theme-icon-sun");
    const moon = document.getElementById("theme-icon-moon");
    if (!sun || !moon) return;
    sun.style.display = current === "dark" ? "" : "none";
    moon.style.display = current === "dark" ? "none" : "";
  }

  /* ────────────────────── Window Controls ────────────────────── */

  let wcMaximized = false;

  function wcInvoke(cmd) {
    if (!TAURI_AVAILABLE) return;
    window.__TAURI__.core.invoke(cmd).catch(() => {});
  }

  function wcUpdateMaximizeIcon() {
    const icon = document.getElementById("wc-max-icon");
    const restore = document.getElementById("wc-restore-icon");
    const btn = document.getElementById("wc-maximize");
    if (!icon || !restore || !btn) return;
    icon.style.display = wcMaximized ? "none" : "";
    restore.style.display = wcMaximized ? "" : "none";
    btn.setAttribute("aria-label", wcMaximized ? "Restore" : "Maximize");
    btn.setAttribute("title", wcMaximized ? "Restore" : "Maximize");
  }

  async function wcInit() {
    if (!TAURI_AVAILABLE) return;
    document.getElementById("wc-minimize")?.addEventListener("click", () => wcInvoke("plugin:window|minimize"));
    document.getElementById("wc-maximize")?.addEventListener("click", () => wcInvoke("plugin:window|toggle_maximize"));
    document.getElementById("wc-close")?.addEventListener("click", () => wcInvoke("plugin:window|close"));
    try {
      wcMaximized = await window.__TAURI__.core.invoke("plugin:window|is_maximized");
      wcUpdateMaximizeIcon();
    } catch {}
  }

  /* ────────────────────── Boot ────────────────────── */

  function boot(forcedMode = null) {
    // Mode setup
    let initialMode = forcedMode || window.__oslerForcedMode;
    if (!initialMode) {
      try {
        initialMode = localStorage.getItem("osler-admin-app-mode") || "instance-manager";
      } catch {
        initialMode = "instance-manager";
      }
    }
    currentAppMode = initialMode;

    // App Switcher buttons
    document.getElementById("btn-mode-instance")?.addEventListener("click", () => setAppMode("instance-manager"));
    document.getElementById("btn-mode-studio")?.addEventListener("click", () => setAppMode("content-studio"));

    document.getElementById("brand")?.addEventListener("click", () => {
      navigate(currentAppMode === "instance-manager" ? "instance" : "content");
    });
    document.getElementById("project-pill")?.addEventListener("click", pickProjectRoot);
    document.getElementById("lang-toggle")?.addEventListener("click", () => {
      window.OslerAdminI18n.toggleLang();
      renderSidebarNav();
    });
    document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
    updateThemeIcon();

    // Register all view handlers
    register("instance", window.OslerAdminViews.instance);
    register("instance-updater", window.OslerAdminViews.instanceUpdater);
    register("prereq", window.OslerAdminViews.prereq);
    register("content", window.OslerAdminViews.content);
    register("manifest", window.OslerAdminViews.manifest);
    register("configure", window.OslerAdminViews.configure);
    register("run-publish", window.OslerAdminViews.runPublish);
    register("start", window.OslerAdminViews.start);
    register("git", window.OslerAdminViews.git);
    register("deploy", window.OslerAdminViews.deploy);
    register("settings", window.OslerAdminViews.settings);
    register("dashboard", window.OslerAdminViews.dashboard);

    wcInit();

    // Initial state fetch
    refreshProjectState().then(async () => {
      if (!projectState || !projectState.root) {
        const saved = loadSavedProjectRoot();
        if (saved) {
          try {
            await invoke("set_project_root", { root: saved });
            await refreshProjectState();
          } catch (e) {
            try { localStorage.removeItem(STORAGE_ROOT_KEY); } catch {}
          }
        }
      }
      setAppMode(currentAppMode);
    });
  }

  /* ────────────────────── Exports ────────────────────── */

  window.OslerAdmin = {
    invoke,
    navigate,
    register,
    toast,
    refreshProjectState,
    pickProjectRoot,
    requireProject,
    boot,
    setAppMode,
    get projectState() {
      return projectState;
    },
    get currentRoute() {
      return currentRoute;
    },
    get appMode() {
      return currentAppMode;
    },
    helpers: { el, svgIcon, escapeHtml, t },
    TAURI_AVAILABLE,
  };
})();
