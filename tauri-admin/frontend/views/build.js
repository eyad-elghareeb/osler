// views/build.js — Run npm/bun build & start, stream logs, live preview.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  let pollTimer = null;

  function renderStatus(status) {
    const statusEl = document.getElementById("build-status");
    if (!statusEl) return;
    statusEl.innerHTML = "";
    let label = t("build.status.idle");
    let cls = "";
    if (status.running) {
      label = t("build.status.running");
      cls = "primary";
    } else if (status.stopRequested) {
      label = t("build.status.stopped");
      cls = "accent";
    } else if (status.exitCode != null) {
      if (status.exitCode === 0) {
        label = t("build.status.done", { code: status.exitCode });
        cls = "success";
      } else {
        label = t("build.status.failed", { code: status.exitCode });
        cls = "danger";
      }
    }
    statusEl.appendChild(el("span", { class: "badge " + cls }, label));
    if (status.kind) {
      statusEl.appendChild(el("span", { class: "badge", style: { marginInlineStart: "0.5rem" } }, status.kind));
    }
  }

  function renderLogs(status) {
    const console = document.getElementById("build-console");
    if (!console) return;
    const wasAtBottom = console.scrollTop + console.clientHeight >= console.scrollHeight - 8;
    console.innerHTML = "";
    if (!status.logs || status.logs.length === 0) {
      console.appendChild(el("div", { class: "empty-state", style: { padding: "2rem 1rem" } },
        el("div", { class: "empty-state-text" }, t("build.empty"))
      ));
      return;
    }
    for (const line of status.logs) {
      const row = el("div", { class: "log-line" });
      const ts = new Date(line.ts).toLocaleTimeString();
      row.appendChild(el("span", { class: "ts" }, ts));
      row.appendChild(el("span", { class: "stream-" + line.stream }, line.text));
      console.appendChild(row);
    }
    if (wasAtBottom) console.scrollTop = console.scrollHeight;
  }

  async function pollOnce() {
    try {
      const status = await invoke("runner_status");
      renderStatus(status);
      renderLogs(status);
      if (!status.running && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch {}
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollOnce, 600);
    pollOnce();
  }

  function switchTab(tab) {
    document.querySelectorAll(".build-tab-btn").forEach((btn) => btn.classList.remove("active"));
    document.getElementById("build-logs-panel").style.display = tab === "logs" ? "" : "none";
    document.getElementById("build-preview-panel").style.display = tab === "preview" ? "" : "none";
    const activeBtn = document.querySelector(`.build-tab-btn[data-tab="${tab}"]`);
    if (activeBtn) activeBtn.classList.add("active");
    // Refresh iframe src when switching to preview to avoid stale content
    if (tab === "preview") {
      const iframe = document.getElementById("preview-iframe");
      if (iframe) {
        const src = iframe.src;
        iframe.src = "";
        setTimeout(() => { iframe.src = src; }, 100);
      }
    }
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.build = async function (view) {
    if (!requireProject()) {
      window.OslerAdmin.navigate("dashboard");
      return;
    }

    const wrap = el("div", { class: "view osler-fade-in", style: { height: "calc(100vh - var(--topbar-h))", display: "flex", flexDirection: "column" } });
    const header = el("div", { class: "view-header" });
    header.appendChild(el("div", {},
      el("h1", {}, t("build.title")),
      el("p", { class: "subtitle" }, t("build.subtitle"))
    ));
    const headerActions = el("div", { class: "view-header-actions" });
    const statusBadge = el("div", { id: "build-status" });
    headerActions.appendChild(statusBadge);
    header.appendChild(headerActions);
    wrap.appendChild(header);

    // Action bar
    const actionBar = el("div", { style: { display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" } });
    const buildBtn = el("button", { class: "btn btn-primary", id: "run-build-btn" }, t("build.runBuild"));
    buildBtn.addEventListener("click", async () => {
      try {
        await invoke("run_build");
        toast(t("toast.started"), "success");
        startPolling();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    const startBtn = el("button", { class: "btn", id: "run-start-btn" }, t("build.runStart"));
    startBtn.addEventListener("click", async () => {
      try {
        await invoke("run_start");
        toast(t("toast.started"), "success");
        startPolling();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    const stopBtn = el("button", { class: "btn btn-danger", id: "stop-btn" }, t("build.stop"));
    stopBtn.addEventListener("click", async () => {
      try {
        await invoke("stop_runner");
        toast(t("toast.stopped"), "info");
        setTimeout(pollOnce, 200);
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    const clearBtn = el("button", { class: "btn btn-ghost" }, t("build.clear"));
    clearBtn.addEventListener("click", () => {
      const console = document.getElementById("build-console");
      if (console) console.innerHTML = "";
    });
    actionBar.appendChild(buildBtn);
    actionBar.appendChild(startBtn);
    actionBar.appendChild(stopBtn);
    actionBar.appendChild(el("span", { style: { flex: "1" } }));
    // Preview URL input
    const urlInput = el("input", {
      type: "text",
      id: "preview-url",
      value: "http://localhost:3000",
      placeholder: "http://localhost:3000",
      style: { width: "200px", padding: "0.375rem 0.5rem", fontSize: "0.8rem", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)" }
    });
    actionBar.appendChild(urlInput);
    actionBar.appendChild(clearBtn);
    wrap.appendChild(actionBar);

    // Note
    wrap.appendChild(el("p", { style: { fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 1rem" } }, t("build.note")));

    // Tab bar — Logs | Preview
    const tabBar = el("div", { style: { display: "flex", gap: "0.25rem", marginBottom: "0.75rem", borderBottom: "1px solid var(--border)" } });
    const logsTab = el("button", { class: "build-tab-btn active", "data-tab": "logs", style: { padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: "500", border: "none", borderBottom: "2px solid var(--primary)", background: "none", cursor: "pointer", color: "var(--primary)" } }, "Logs");
    logsTab.addEventListener("click", () => switchTab("logs"));
    const previewTab = el("button", { class: "build-tab-btn", "data-tab": "preview", style: { padding: "0.4rem 1rem", fontSize: "0.8rem", fontWeight: "500", border: "none", borderBottom: "2px solid transparent", background: "none", cursor: "pointer", color: "var(--text-muted)" } }, "Preview");
    previewTab.addEventListener("click", () => switchTab("preview"));
    tabBar.appendChild(logsTab);
    tabBar.appendChild(previewTab);
    wrap.appendChild(tabBar);

    // Logs panel
    const logsPanel = el("div", { id: "build-logs-panel", style: { flex: "1", display: "flex", flexDirection: "column", minHeight: "0" } });
    const console = el("div", { class: "log-view", id: "build-console", style: { flex: "1" } });
    logsPanel.appendChild(console);
    wrap.appendChild(logsPanel);

    // Preview panel (initially hidden)
    const previewPanel = el("div", { id: "build-preview-panel", style: { flex: "1", display: "none", flexDirection: "column", minHeight: "0" } });
    const previewToolbar = el("div", { style: { display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem", fontSize: "0.8rem" } });
    previewToolbar.appendChild(el("span", { style: { color: "var(--text-muted)" } }, "Preview URL:"));
    const refreshPreviewBtn = el("button", { class: "btn btn-ghost btn-sm" }, svgIcon("M21 12a9 9 0 1 1-9-9c2.39 0 4.68.94 6.36 2.64L21 9", 14), " Refresh");
    refreshPreviewBtn.addEventListener("click", () => {
      const iframe = document.getElementById("preview-iframe");
      const urlInput = document.getElementById("preview-url");
      if (iframe && urlInput) {
        iframe.src = urlInput.value;
      }
    });
    previewToolbar.appendChild(refreshPreviewBtn);
    const openInBrowserBtn = el("button", { class: "btn btn-ghost btn-sm" }, "Open in Browser");
    openInBrowserBtn.addEventListener("click", () => {
      const urlInput = document.getElementById("preview-url");
      if (urlInput) invoke("open_external", { url: urlInput.value });
    });
    previewToolbar.appendChild(openInBrowserBtn);
    previewPanel.appendChild(previewToolbar);

    const iframeWrap = el("div", { style: { flex: "1", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", background: "#fff" } });
    const iframe = el("iframe", {
      id: "preview-iframe",
      src: "http://localhost:3000",
      style: { width: "100%", height: "100%", border: "none" },
    });
    iframeWrap.appendChild(iframe);
    previewPanel.appendChild(iframeWrap);

    wrap.appendChild(previewPanel);

    view.appendChild(wrap);

    // Initial poll
    startPolling();
  };
})();
