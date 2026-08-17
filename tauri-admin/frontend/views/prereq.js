// views/prereq.js — Prerequisites verification and auto-installer view for Osler Admin.
//
// Inspects Node.js, Git, Wrangler CLI, and Cloudflare account authentication.
// Provides 1-click fix and login triggers.

(function () {
  "use strict";

  const { invoke, toast, helpers } = window.OslerAdmin;
  const { el, svgIcon, t } = helpers;

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.prereq = async function (view) {
    const wrap = el("div", { class: "view osler-fade-in" });

    wrap.appendChild(
      el(
        "div",
        { class: "view-header" },
        el(
          "div",
          {},
          el("h1", {}, t("prereq.title")),
          el("p", { class: "subtitle" }, t("prereq.subtitle"))
        ),
        el(
          "div",
          { class: "view-header-actions" },
          el(
            "button",
            {
              class: "btn btn-sm btn-ghost",
              id: "prereq-refresh-btn",
              onClick: () => loadReport(),
            },
            svgIcon("M21 12a9 9 0 1 1-9-9c2.39 0 4.68.94 6.36 2.64L21 9", 14),
            t("common.refresh")
          )
        )
      )
    );

    const reportCard = el("div", { class: "card", style: { padding: "1.5rem", marginBottom: "1.5rem" } });
    wrap.appendChild(reportCard);

    view.appendChild(wrap);
    await loadReport();

    async function loadReport() {
      reportCard.innerHTML = `<div style="display:flex;align-items:center;gap:0.75rem;color:var(--text-muted);"><div class="spinner"></div><span>${t(
        "common.loading"
      )}</span></div>`;

      try {
        const rep = await invoke("check_prerequisites");
        renderReport(rep);
      } catch (e) {
        reportCard.innerHTML = "";
        reportCard.appendChild(
          el("div", { class: "empty-state", style: { padding: "2rem" } },
            el("div", { class: "empty-state-title", style: { color: "var(--danger)" } }, t("toast.error", { msg: String(e) }))
          )
        );
      }
    }

    function renderReport(rep) {
      reportCard.innerHTML = "";

      // Overall status banner
      const banner = el(
        "div",
        {
          class: "card",
          style: {
            padding: "1rem 1.25rem",
            marginBottom: "1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: rep.allSatisfied ? "rgba(34, 197, 94, 0.1)" : "rgba(234, 179, 8, 0.1)",
            border: rep.allSatisfied ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid rgba(234, 179, 8, 0.3)",
          },
        },
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "0.75rem" } },
          el(
            "span",
            { style: { fontSize: "1.25rem" } },
            rep.allSatisfied ? "✓" : "⚠️"
          ),
          el(
            "div",
            {},
            el(
              "div",
              { style: { fontWeight: "600", fontSize: "0.9375rem" } },
              rep.allSatisfied ? t("prereq.allReady") : t("prereq.someMissing")
            ),
            el(
              "div",
              { style: { fontSize: "0.8125rem", color: "var(--text-muted)" } },
              rep.allSatisfied ? t("prereq.allReadyDesc") : t("prereq.someMissingDesc")
            )
          )
        )
      );
      reportCard.appendChild(banner);

      // List of prerequisite items
      const grid = el("div", { style: { display: "flex", flexDirection: "column", gap: "0.75rem" } });

      for (const item of rep.items || []) {
        const itemRow = el(
          "div",
          {
            class: "card",
            style: {
              padding: "1rem 1.25rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              background: "var(--surface)",
            },
          }
        );

        const left = el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "0.75rem", flex: "1" } },
          el(
            "span",
            {
              class: "badge " + (item.satisfied ? "badge-success" : "badge-danger"),
              style: { minWidth: "24px", textAlign: "center" },
            },
            item.satisfied ? "✓" : "✗"
          ),
          el(
            "div",
            {},
            el(
              "div",
              { style: { fontWeight: "600", fontSize: "0.875rem" } },
              item.label
            ),
            el(
              "div",
              { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" } },
              item.details
            )
          )
        );

        const right = el("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } });

        right.appendChild(
          el(
            "span",
            {
              style: {
                fontSize: "0.75rem",
                fontFamily: "var(--font-mono)",
                color: item.satisfied ? "var(--success)" : "var(--text-muted)",
              },
            },
            item.version
          )
        );

        if (!item.satisfied && item.fixable) {
          const fixBtn = el(
            "button",
            {
              class: "btn btn-sm btn-primary",
              onClick: async () => {
                fixBtn.disabled = true;
                fixBtn.textContent = t("common.loading");
                try {
                  const res = await invoke("install_prerequisite", { name: item.name });
                  toast(res.message || t("toast.saved"), "success");
                  setTimeout(loadReport, 2000);
                } catch (err) {
                  toast(t("toast.error", { msg: String(err) }), "error");
                } finally {
                  fixBtn.disabled = false;
                  fixBtn.textContent = t("prereq.fix");
                }
              },
            },
            t("prereq.fix")
          );
          right.appendChild(fixBtn);
        }

        itemRow.appendChild(left);
        itemRow.appendChild(right);
        grid.appendChild(itemRow);
      }

      reportCard.appendChild(grid);
    }
  };
})();
