// views/manifest.js — Inspect + regenerate manifest.json per category.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  let pollTimer = null;

  async function loadCategories() {
    // Try reading each of the four known categories. If missing, list as "not generated".
    const known = ["qbank", "library", "flashcard", "osce"];
    const out = [];
    for (const c of known) {
      try {
        const m = await invoke("read_manifest", { category: c });
        const leaves = countLeaves(m.items || []);
        out.push({ category: c, type: m.type, leaves, present: true });
      } catch {
        out.push({ category: c, type: "—", leaves: 0, present: false });
      }
    }
    return out;
  }

  function countLeaves(items) {
    let n = 0;
    for (const item of items) {
      if (item.items && item.items.length) n += countLeaves(item.items);
      else n++;
    }
    return n;
  }

  async function viewManifest(category) {
    try {
      const m = await invoke("read_manifest", { category });
      const json = JSON.stringify(m, null, 2);
      const overlay = el("div", { class: "picker-overlay" });
      const card = el("div", { class: "picker-card", style: { maxWidth: "720px", textAlign: "start" } });
      card.appendChild(el("h2", {}, t("manifest.view") + " — " + category));
      const ta = el("textarea", {
        class: "textarea",
        style: { width: "100%", height: "420px", fontFamily: "var(--font-mono)", fontSize: "0.75rem", marginTop: "1rem" },
        spellcheck: "false",
      });
      ta.value = json;
      card.appendChild(ta);
      const actions = el("div", { style: { display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" } });
      const closeBtn = el("button", { class: "btn btn-ghost" }, t("common.close"));
      closeBtn.addEventListener("click", () => overlay.remove());
      const saveBtn = el("button", { class: "btn btn-primary" }, t("manifest.save"));
      saveBtn.addEventListener("click", async () => {
        try {
          const parsed = JSON.parse(ta.value);
          await invoke("write_manifest", { category, json: parsed });
          toast(t("toast.saved"), "success");
          overlay.remove();
          refresh();
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      });
      actions.appendChild(closeBtn);
      actions.appendChild(saveBtn);
      card.appendChild(actions);
      overlay.appendChild(card);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function refresh() {
    const tableBody = document.getElementById("manifest-table-body");
    if (!tableBody) return;
    tableBody.innerHTML = "";
    const cats = await loadCategories();
    if (cats.length === 0) {
      const empty = el("div", { class: "empty-state" },
        el("div", { class: "empty-state-text" }, t("manifest.empty"))
      );
      tableBody.appendChild(el("tr", {}, el("td", { colspan: "4" }, empty)));
      return;
    }
    for (const c of cats) {
      const tr = el("tr", {});
      tr.appendChild(el("td", {}, el("span", { class: "badge " + (c.present ? "primary" : "") }, c.category)));
      tr.appendChild(el("td", {}, c.type));
      tr.appendChild(el("td", {}, String(c.leaves)));
      const actions = el("td", { style: { textAlign: "end" } });
      const viewBtn = el("button", { class: "btn btn-ghost btn-sm", disabled: !c.present }, t("manifest.view"));
      viewBtn.addEventListener("click", () => viewManifest(c.category));
      actions.appendChild(viewBtn);
      tr.appendChild(actions);
      tableBody.appendChild(tr);
    }
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.manifest = async function (view) {
    if (!requireProject()) {
      window.OslerAdmin.navigate("dashboard");
      return;
    }

    const wrap = el("div", { class: "view" });
    const header = el("div", { class: "view-header" });
    header.appendChild(el("div", {},
      el("h1", { class: "view-title" }, t("manifest.title")),
      el("p", { class: "view-subtitle" }, t("manifest.subtitle"))
    ));
    const regenBtn = el("button", { class: "btn btn-primary", id: "regen-btn" }, t("manifest.regenerate"));
    regenBtn.addEventListener("click", async () => {
      regenBtn.disabled = true;
      regenBtn.textContent = t("common.loading");
      try {
        const res = await invoke("generate_manifest");
        const n = (res.generated || []).length;
        toast(t("manifest.regenerateDone", { n }), "success");
        await refresh();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        regenBtn.disabled = false;
        regenBtn.textContent = t("manifest.regenerate");
      }
    });
    header.appendChild(regenBtn);
    wrap.appendChild(header);

    const table = el("table", { class: "table" });
    const thead = el("thead", {}, el("tr", {},
      el("th", {}, t("manifest.category")),
      el("th", {}, t("manifest.type")),
      el("th", {}, t("manifest.leaves")),
      el("th", { style: { textAlign: "end" } }, "")
    ));
    table.appendChild(thead);
    const tbody = el("tbody", { id: "manifest-table-body" });
    table.appendChild(tbody);
    wrap.appendChild(table);

    view.appendChild(wrap);
    await refresh();
  };
})();
