// views/build.js — Run npm/bun build & start, stream logs.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  let pollTimer = null;
  let activeTab = "build"; // "build" | "start"

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
      // Stop polling when not running
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

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.build = async function (view) {
    if (!requireProject()) {
      window.OslerAdmin.navigate("dashboard");
      return;
    }

    const wrap = el("div", { class: "view medos-fade-in" });
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
    actionBar.appendChild(clearBtn);
    wrap.appendChild(actionBar);

    // Note
    wrap.appendChild(el("p", { style: { fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 1rem" } }, t("build.note")));

    // Console
    const console = el("div", { class: "log-view", id: "build-console" });
    wrap.appendChild(console);

    view.appendChild(wrap);

    // Initial poll
    startPolling();
  };
})();
