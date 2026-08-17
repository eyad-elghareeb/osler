// views/instance-updater.js — Instance update and patch apply manager.
//
// Checks target instances for code updates (in `src/`, `scripts/`, `cloudflare/worker/src/`, `migrations/`),
// previews file diffs, manages timestamped safety backups, and applies updates safely without touching
// `public/osler-content/` or custom secrets.

(function () {
  "use strict";

  const { invoke, toast, helpers } = window.OslerAdmin;
  const { el, svgIcon, t } = helpers;

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.instanceUpdater = async function (view) {
    const wrap = el("div", { class: "view osler-fade-in" });

    wrap.appendChild(
      el(
        "div",
        { class: "view-header" },
        el(
          "div",
          {},
          el("h1", {}, t("updater.title")),
          el("p", { class: "subtitle" }, t("updater.subtitle"))
        )
      )
    );

    const state = {
      targetDir: window.OslerAdmin.projectState?.root || "",
      checkReport: null,
      backups: [],
      busy: false,
    };

    // Target instance selector
    const targetCard = el("div", { class: "card", style: { padding: "1.25rem", marginBottom: "1.5rem" } });
    targetCard.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, t("updater.targetInstance")));
    const dirRow = el("div", { style: { display: "flex", gap: "0.5rem" } });
    const dirInput = el("input", {
      type: "text",
      class: "input",
      value: state.targetDir,
      placeholder: "/path/to/osler-instance",
      style: { flex: "1", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" },
    });
    dirInput.addEventListener("input", () => (state.targetDir = dirInput.value));

    const browseBtn = el("button", { class: "btn btn-sm" }, t("instance.browse"));
    browseBtn.addEventListener("click", async () => {
      try {
        const folder = await invoke("plugin:dialog|open", {
          options: { directory: true, title: t("updater.selectInstance"), multiple: false },
        });
        if (typeof folder === "string" && folder) {
          state.targetDir = folder;
          dirInput.value = folder;
          await doCheck();
        }
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });

    const checkBtn = el("button", { class: "btn btn-sm btn-primary" }, t("updater.checkUpdates"));
    checkBtn.addEventListener("click", doCheck);

    dirRow.append(dirInput, browseBtn, checkBtn);
    targetCard.appendChild(dirRow);
    wrap.appendChild(targetCard);

    // Results container
    const resultHost = el("div", { id: "updater-results" });
    wrap.appendChild(resultHost);

    // Backups section
    const backupsCard = el("div", { class: "card", style: { padding: "1.25rem", marginTop: "1.5rem" } });
    backupsCard.appendChild(el("div", { class: "label", style: { marginBottom: "0.5rem" } }, t("updater.backupsTitle")));
    const backupsList = el("div", { id: "backups-list" });
    backupsCard.appendChild(backupsList);
    wrap.appendChild(backupsCard);

    view.appendChild(wrap);

    if (state.targetDir) {
      doCheck();
    } else {
      renderEmpty();
    }
    loadBackups();

    async function doCheck() {
      if (!state.targetDir.trim()) {
        toast(t("instance.err.noDir"), "error");
        return;
      }
      checkBtn.disabled = true;
      checkBtn.textContent = t("common.loading");
      resultHost.innerHTML = `<div style="display:flex;align-items:center;gap:0.75rem;padding:2rem;color:var(--text-muted);"><div class="spinner"></div><span>${t(
        "updater.checking"
      )}</span></div>`;

      try {
        const rep = await invoke("check_instance_update", { targetPath: state.targetDir });
        state.checkReport = rep;
        renderReport(rep);
      } catch (e) {
        resultHost.innerHTML = "";
        resultHost.appendChild(
          el(
            "div",
            { class: "card", style: { padding: "1.5rem", border: "1px solid var(--danger)" } },
            el("div", { style: { color: "var(--danger)", fontWeight: "600", marginBottom: "0.5rem" } }, t("toast.error", { msg: String(e) })),
            el("div", { style: { fontSize: "0.8125rem", color: "var(--text-muted)" } }, t("updater.checkErrorHint"))
          )
        );
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = t("updater.checkUpdates");
      }
    }

    function renderEmpty() {
      resultHost.innerHTML = "";
      resultHost.appendChild(
        el(
          "div",
          { class: "empty-state", style: { padding: "3rem 1rem" } },
          el("div", { class: "empty-state-title" }, t("updater.emptyTitle")),
          el("div", { class: "empty-state-text" }, t("updater.emptyText"))
        )
      );
    }

    function renderReport(rep) {
      resultHost.innerHTML = "";
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });

      // Summary
      const headerRow = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" } });
      headerRow.appendChild(
        el(
          "div",
          {},
          el("h2", { style: { fontSize: "1.125rem", fontWeight: "600", margin: "0 0 0.25rem" } },
            rep.hasUpdates ? `🚀 ${t("updater.updatesAvailable", { count: rep.files.length })}` : `✓ ${t("updater.upToDate")}`
          ),
          el("div", { style: { fontSize: "0.8125rem", color: "var(--text-muted)" } },
            `${rep.changedCount} ${t("updater.modified")}, ${rep.addedCount} ${t("updater.added")}`
          )
        )
      );

      if (rep.hasUpdates) {
        const applyBtn = el("button", { class: "btn btn-primary", id: "apply-patch-btn" }, svgIcon("M12 5v14M5 12h14", 14), t("updater.applyUpdates"));
        applyBtn.addEventListener("click", doApply);
        headerRow.appendChild(applyBtn);
      }

      card.appendChild(headerRow);

      // Protection badge banner
      const protBanner = el(
        "div",
        {
          style: {
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.2)",
            borderRadius: "var(--radius-sm)",
            padding: "0.75rem 1rem",
            marginBottom: "1.25rem",
            fontSize: "0.8125rem",
          },
        },
        el("div", { style: { fontWeight: "600", color: "var(--success)", marginBottom: "0.25rem" } }, "🛡️ " + t("updater.protectedTitle")),
        el("div", { style: { color: "var(--text-muted)", fontSize: "0.75rem" } }, (rep.preservedPaths || []).join(" · "))
      );
      card.appendChild(protBanner);

      // Files list
      if (rep.files && rep.files.length > 0) {
        const filesContainer = el("div", {
          style: {
            background: "var(--surface-2)",
            borderRadius: "var(--radius-sm)",
            maxHeight: "320px",
            overflowY: "auto",
            padding: "0.5rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
          },
        });

        for (const f of rep.files) {
          const row = el(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "space-between",
                padding: "0.35rem 0.5rem",
                borderRadius: "4px",
                alignItems: "center",
              },
            },
            el("span", { style: { color: f.status === "added" ? "var(--success)" : "var(--primary)" } },
              (f.status === "added" ? "+ " : "~ ") + f.path
            ),
            el("span", { class: "badge " + (f.status === "added" ? "badge-success" : "badge-accent"), style: { fontSize: "0.6875rem" } }, f.status)
          );
          filesContainer.appendChild(row);
        }
        card.appendChild(filesContainer);
      }

      resultHost.appendChild(card);
    }

    async function doApply() {
      const applyBtn = document.getElementById("apply-patch-btn");
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = t("updater.applying");
      }

      try {
        const res = await invoke("apply_instance_patch", { targetPath: state.targetDir });
        toast(t("updater.patchSuccess", { count: res.updatedCount }), "success");
        await doCheck();
        await loadBackups();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.textContent = t("updater.applyUpdates");
        }
      }
    }

    async function loadBackups() {
      if (!state.targetDir) return;
      backupsList.innerHTML = `<div style="color:var(--text-muted);font-size:0.8125rem;">${t("common.loading")}</div>`;
      try {
        const list = await invoke("list_instance_backups", { targetPath: state.targetDir });
        state.backups = list;
        renderBackups(list);
      } catch (e) {
        backupsList.innerHTML = `<div style="color:var(--text-muted);font-size:0.8125rem;">${t("updater.noBackups")}</div>`;
      }
    }

    function renderBackups(list) {
      backupsList.innerHTML = "";
      if (!list || list.length === 0) {
        backupsList.innerHTML = `<div style="color:var(--text-muted);font-size:0.8125rem;">${t("updater.noBackups")}</div>`;
        return;
      }

      const container = el("div", { style: { display: "flex", flexDirection: "column", gap: "0.5rem" } });
      for (const bkp of list) {
        const row = el(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.5rem 0.75rem",
              background: "var(--surface-2)",
              borderRadius: "var(--radius-sm)",
            },
          },
          el(
            "div",
            {},
            el("div", { style: { fontWeight: "600", fontSize: "0.8125rem" } }, bkp.id),
            el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } }, `${bkp.fileCount} files · ${bkp.formattedDate}`)
          ),
          el(
            "button",
            {
              class: "btn btn-sm btn-ghost",
              onClick: async () => {
                if (!confirm(t("updater.confirmRollback", { id: bkp.id }))) return;
                try {
                  const res = await invoke("rollback_instance_patch", { backupId: bkp.id, targetPath: state.targetDir });
                  toast(t("updater.rollbackSuccess", { count: res.restoredCount }), "success");
                  await doCheck();
                } catch (e) {
                  toast(t("toast.error", { msg: String(e) }), "error");
                }
              },
            },
            svgIcon("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", 12),
            t("updater.rollback")
          )
        );
        container.appendChild(row);
      }
      backupsList.appendChild(container);
    }
  };
})();
