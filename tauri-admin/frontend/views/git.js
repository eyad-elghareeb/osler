// views/git.js — Status, stage, commit, push, pull.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  async function refresh() {
    const body = document.getElementById("git-table-body");
    const remoteEl = document.getElementById("git-remote");
    const branchEl = document.getElementById("git-branch");
    const statusSummary = document.getElementById("git-status-summary");
    if (!body) return;
    body.innerHTML = "";

    let remote = "", branch = "";
    try {
      const r = await invoke("git_remote");
      remote = r.remote || "—";
      branch = r.branch || "—";
    } catch (e) {
      remote = "—";
      branch = "—";
    }
    if (remoteEl) remoteEl.textContent = remote;
    if (branchEl) branchEl.textContent = branch;

    let entries = [];
    try {
      const res = await invoke("git_status");
      entries = res.entries || [];
    } catch (e) {
      if (statusSummary) statusSummary.textContent = t("toast.error", { msg: String(e) });
      return;
    }

    if (statusSummary) {
      if (entries.length === 0) {
        statusSummary.textContent = t("git.status.clean");
      } else {
        statusSummary.textContent = t("git.status.dirty", { n: entries.length });
      }
    }

    if (entries.length === 0) {
      body.appendChild(el("tr", {}, el("td", { colspan: "3" },
        el("div", { class: "empty-state", style: { padding: "2rem 1rem" } },
          el("div", { class: "empty-state-text" }, t("git.empty"))
        )
      )));
      return;
    }

    for (const e of entries) {
      const tr = el("tr", {});
      tr.appendChild(el("td", {}, el("span", { class: "badge " + badgeClassFor(e.status) }, e.status || "?")));
      tr.appendChild(el("td", { style: { fontFamily: "var(--font-mono)", fontSize: "0.75rem" } }, e.path));
      tr.appendChild(el("td", { style: { textAlign: "end" } },
        el("button", {
          class: "btn btn-ghost btn-sm",
          onClick: async () => {
            try {
              await invoke("git_add", { paths: [e.path] });
              toast(t("toast.saved"), "success");
              refresh();
            } catch (err) {
              toast(t("toast.error", { msg: String(err) }), "error");
            }
          },
        }, t("git.stageSelected"))
      ));
      body.appendChild(tr);
    }
  }

  function badgeClassFor(status) {
    if (!status) return "";
    const xy = status.trim();
    if (xy.includes("M")) return "accent";
    if (xy.includes("A")) return "success";
    if (xy.includes("D")) return "danger";
    if (xy.includes("?")) return "";
    return "primary";
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.git = async function (view) {
    if (!requireProject()) {
      window.OslerAdmin.navigate("dashboard");
      return;
    }

    const wrap = el("div", { class: "view" });
    const header = el("div", { class: "view-header" });
    header.appendChild(el("div", {},
      el("h1", { class: "view-title" }, t("git.title")),
      el("p", { class: "view-subtitle" }, t("git.subtitle"))
    ));
    const refreshBtn = el("button", { class: "btn btn-ghost btn-sm" }, t("git.refresh"));
    refreshBtn.addEventListener("click", refresh);
    header.appendChild(refreshBtn);
    wrap.appendChild(header);

    // Remote + branch info
    const infoGrid = el("div", { class: "grid grid-2", style: { marginBottom: "1rem" } });
    infoGrid.appendChild(el("div", { class: "card" },
      el("div", { class: "card-title" }, t("git.remote")),
      el("div", { id: "git-remote", style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem", wordBreak: "break-all" } }, "…")
    ));
    infoGrid.appendChild(el("div", { class: "card" },
      el("div", { class: "card-title" }, t("git.branch")),
      el("div", { id: "git-branch", style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem" } }, "…")
    ));
    wrap.appendChild(infoGrid);

    // Commit bar
    const commitBar = el("div", { class: "card", style: { display: "flex", gap: "0.5rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" } });
    const msgInput = el("input", {
      class: "input",
      id: "git-commit-msg",
      placeholder: t("git.commitPlaceholder"),
      style: { flex: "1", minWidth: "200px" },
    });
    msgInput.value = t("git.commitDefault");
    commitBar.appendChild(msgInput);
    const stageAllBtn = el("button", { class: "btn btn-outline btn-sm" }, t("git.stageAll"));
    stageAllBtn.addEventListener("click", async () => {
      try {
        await invoke("git_add", { paths: ["public/osler-content"] });
        toast(t("toast.saved"), "success");
        refresh();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    commitBar.appendChild(stageAllBtn);
    const commitBtn = el("button", { class: "btn btn-primary btn-sm" }, t("git.commit"));
    commitBtn.addEventListener("click", async () => {
      try {
        await invoke("git_commit", { message: msgInput.value });
        toast(t("git.commitDone", { message: msgInput.value }), "success");
        refresh();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    commitBar.appendChild(commitBtn);
    const pushBtn = el("button", { class: "btn btn-success btn-sm" }, t("git.push"));
    pushBtn.addEventListener("click", async () => {
      try {
        await invoke("git_push");
        toast(t("git.pushDone"), "success");
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    commitBar.appendChild(pushBtn);
    const pullBtn = el("button", { class: "btn btn-outline btn-sm" }, t("git.pull"));
    pullBtn.addEventListener("click", async () => {
      try {
        await invoke("git_pull");
        toast(t("git.pullDone"), "success");
        refresh();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    commitBar.appendChild(pullBtn);
    wrap.appendChild(commitBar);

    // Status table
    wrap.appendChild(el("div", { class: "card-title" }, t("git.status")));
    const summary = el("div", { id: "git-status-summary", style: { fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "0.5rem" } }, "…");
    wrap.appendChild(summary);

    const table = el("table", { class: "table" });
    const thead = el("thead", {}, el("tr", {},
      el("th", { style: { width: "80px" } }, "XY"),
      el("th", {}, "Path"),
      el("th", { style: { textAlign: "end" } }, "")
    ));
    table.appendChild(thead);
    const tbody = el("tbody", { id: "git-table-body" });
    table.appendChild(tbody);
    wrap.appendChild(table);

    view.appendChild(wrap);
    await refresh();
  };
})();
