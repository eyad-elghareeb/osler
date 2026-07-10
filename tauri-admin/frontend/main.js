// main.js — Tauri API bridge + simple router + shared UI helpers for the
// Osler admin dashboard.
//
// In Tauri (built app), `window.__TAURI__` is exposed by tauri-plugin and
// every invoke() reaches the Rust handlers in src/commands.rs.
//
// In a plain browser (opened via file:// or a dev server), invoke() falls
// back to a no-op mock that returns empty data so the UI can be previewed
// without Tauri installed.

(function () {
  "use strict";

  const TAURI_AVAILABLE =
    typeof window !== "undefined" && window.__TAURI__ && typeof window.__TAURI__.core === "object";

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
    switch (cmd) {
      case "ping":
        return "osler-admin-mock";
      case "project_state":
        return { root: null };
      case "pick_project_root":
        return { picked: false };
      case "list_files":
        return { items: [] };
      case "runner_status":
        return {
          kind: "",
          running: false,
          exitCode: null,
          startedAt: 0,
          endedAt: 0,
          stopRequested: false,
          logs: [],
        };
      case "git_status":
        return { entries: [] };
      case "git_remote":
        return { remote: "", branch: "" };
      case "read_manifest":
        throw new Error("No manifest in mock mode");
      case "generate_manifest":
        return { generated: [] };
      case "validate_content":
        return { valid: true, errors: [] };
      default:
        return null;
    }
  }

  /* ────────────────────── Router ────────────────────── */

  const routes = {};
  let currentRoute = null;

  function register(route, handler) {
    routes[route] = handler;
  }

  function navigate(route) {
    currentRoute = route;
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-route") === route);
    });
    const view = document.getElementById("view");
    if (!view) return;
    view.innerHTML = "";
    view.className = "";
    const handler = routes[route];
    if (handler) {
      try {
        handler(view);
      } catch (e) {
        console.error("Route handler error:", e);
        view.innerHTML = '<div class="view"><div class="empty-state"><div class="empty-state-title">Failed to render view</div><div class="empty-state-text">' + escapeHtml(String(e)) + '</div></div></div>';
      }
    } else {
      view.innerHTML = '<div class="view"><div class="empty-state"><div class="empty-state-title">Not found</div><div class="empty-state-text">Unknown route: ' + escapeHtml(route) + '</div></div></div>';
    }
  }

  /* ────────────────────── Toasts ────────────────────── */

  function toast(message, kind) {
    const wrap = document.getElementById("toasts");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast " + (kind || "info");
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity 0.3s, transform 0.3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  /* ────────────────────── Helpers ────────────────────── */

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "style" && typeof v === "object") {
          Object.assign(node.style, v);
        } else if (v != null) node.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else if (Array.isArray(child)) {
        child.forEach((c) => node.appendChild(c));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function svgIcon(path, size) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", size || 16);
    svg.setAttribute("height", size || 16);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", path);
    svg.appendChild(p);
    return svg;
  }

  function t(key, params) {
    return window.OslerAdminI18n.t(key, params);
  }

  /* ────────────────────── Project state ────────────────────── */

  let projectState = null;

  async function refreshProjectState() {
    try {
      projectState = await invoke("project_state");
      updateProjectPill();
      return projectState;
    } catch (e) {
      console.error("project_state failed:", e);
      projectState = { root: null };
      updateProjectPill();
      return projectState;
    }
  }

  function updateProjectPill() {
    const pill = document.getElementById("project-pill");
    const text = document.getElementById("project-pill-text");
    if (!pill || !text) return;
    if (projectState && projectState.root) {
      pill.classList.add("connected");
      const short = projectState.root.split(/[\\/]/).pop();
      text.textContent = short;
      pill.title = projectState.root;
    } else {
      pill.classList.remove("connected");
      text.textContent = t("project.notPicked");
      pill.title = t("project.pick");
    }
  }

  async function pickProjectRoot() {
    try {
      const folder = await invoke("plugin:dialog|open", {
        options: {
          directory: true,
          title: "Pick Osler project root",
          multiple: false,
        },
      });
      // Response is a plain path string when picked, null/undefined on cancel
      const root = typeof folder === "string" ? folder : null;
      if (!root) return;
      const res = await invoke("set_project_root", { root });
      await refreshProjectState();
      toast(t("project.state.connected"), "success");
      if (currentRoute) navigate(currentRoute);
      if (res && res.hasContentDir === false) {
        toast(t("project.state.noContent"), "info");
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

  /* ────────────────────── Theme toggle ────────────────────── */

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

  /* ────────────────────── Boot ────────────────────── */

  function boot() {
    // Wire nav buttons
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => navigate(btn.getAttribute("data-route")));
    });
    document.getElementById("brand").addEventListener("click", () => navigate("dashboard"));
    document.getElementById("project-pill").addEventListener("click", pickProjectRoot);
    document.getElementById("lang-toggle").addEventListener("click", () => {
      window.OslerAdminI18n.toggleLang();
    });
    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
    updateThemeIcon();

    // Register routes
    register("dashboard", window.OslerAdminViews.dashboard);
    register("content", window.OslerAdminViews.content);
    register("manifest", window.OslerAdminViews.manifest);
    register("build", window.OslerAdminViews.build);
    register("git", window.OslerAdminViews.git);
    register("settings", window.OslerAdminViews.settings);

    // Initial state fetch + first render
    refreshProjectState().then(() => {
      navigate("dashboard");
      // If no root picked, show the picker overlay
      if (!projectState || !projectState.root) {
        showPickerOverlay();
      }
    });
  }

  function showPickerOverlay() {
    const existing = document.querySelector(".picker-overlay");
    if (existing) existing.remove();

    const overlay = el("div", { class: "picker-overlay" });
    const card = el("div", { class: "picker-card" });
    const mark = el("div", { class: "brand-mark" });
    mark.style.width = "56px";
    mark.style.height = "56px";
    mark.style.borderRadius = "var(--radius)";
    mark.style.margin = "0 auto";
    mark.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>';
    card.appendChild(mark);
    card.appendChild(el("h2", {}, t("project.pick")));
    card.appendChild(el("p", {}, t("project.pickHelp")));
    const btn = el("button", { class: "btn btn-primary", style: { width: "100%", justifyContent: "center" } }, t("project.pick"));
    btn.addEventListener("click", async () => {
      await pickProjectRoot();
      if (projectState && projectState.root) {
        overlay.remove();
      }
    });
    card.appendChild(btn);

    // Skip link — useful when previewing in a browser without Tauri installed.
    const skip = el("button", {
      class: "btn btn-ghost",
      style: { width: "100%", justifyContent: "center", marginTop: "0.5rem", fontSize: "0.75rem" },
    }, t("common.close"));
    skip.addEventListener("click", () => overlay.remove());
    card.appendChild(skip);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
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
    get projectState() {
      return projectState;
    },
    get currentRoute() {
      return currentRoute;
    },
    helpers: { el, svgIcon, escapeHtml, t },
    TAURI_AVAILABLE,
  };
})();
