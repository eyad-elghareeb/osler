// views/settings.js — UI language, theme, project root.

(function () {
  "use strict";

  const { invoke, toast, helpers, pickProjectRoot, projectState, refreshProjectState } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.settings = async function (view) {
    const wrap = el("div", { class: "view" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", { class: "view-title" }, t("settings.title")),
        el("p", { class: "view-subtitle" }, t("settings.subtitle"))
      )
    ));

    // Language card
    const langCard = el("div", { class: "card", style: { marginBottom: "1rem" } });
    langCard.appendChild(el("div", { class: "card-title" }, t("settings.section.language")));
    langCard.appendChild(el("div", { style: { fontSize: "0.875rem", marginBottom: "0.75rem" } }, t("settings.language.uiLangDesc")));

    const langGrid = el("div", { class: "grid grid-2", style: { maxWidth: "480px" } });
    const currentLang = window.OslerAdminI18n.lang;
    for (const opt of [
      { id: "en", label: t("settings.language.enName"), native: "English", dir: "LTR" },
      { id: "ar", label: t("settings.language.arName"), native: "العربية", dir: "RTL" },
    ]) {
      const active = currentLang === opt.id;
      const btn = el("button", {
        class: "card" + (active ? " active-lang" : ""),
        style: {
          textAlign: "start",
          cursor: "pointer",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          padding: "0.75rem",
          border: active ? "2px solid var(--primary)" : "1px solid var(--border)",
          background: active ? "var(--primary-dim)" : "var(--surface)",
        },
      });
      const mark = el("div", {
        class: "brand-mark",
        style: { width: "36px", height: "36px", background: active ? "var(--primary)" : "var(--surface-2)", color: active ? "var(--primary-foreground)" : "var(--text-muted)" },
      }, opt.id === "ar" ? "ع" : "EN");
      btn.appendChild(mark);
      btn.appendChild(el("div", {},
        el("div", { style: { fontWeight: "600", fontSize: "0.875rem" } }, opt.label),
        el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)" }, dir: opt.id === "ar" ? "rtl" : "ltr", lang: opt.id }, opt.native + " · " + opt.dir)
      ));
      btn.addEventListener("click", () => window.OslerAdminI18n.setLang(opt.id));
      langGrid.appendChild(btn);
    }
    langCard.appendChild(langGrid);

    langCard.appendChild(el("div", {
      style: { marginTop: "1rem", padding: "0.75rem", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", fontSize: "0.75rem", color: "var(--text-muted)" },
    }, el("strong", {}, "ℹ ") , t("settings.language.rtlNote")));
    wrap.appendChild(langCard);

    // Theme card
    const themeCard = el("div", { class: "card", style: { marginBottom: "1rem" } });
    themeCard.appendChild(el("div", { class: "card-title" }, t("settings.section.theme")));
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    const themeGrid = el("div", { style: { display: "flex", gap: "0.5rem" } });
    for (const opt of [
      { id: "dark", label: t("settings.theme.dark") },
      { id: "light", label: t("settings.theme.light") },
    ]) {
      const active = currentTheme === opt.id;
      const btn = el("button", {
        class: "btn " + (active ? "btn-primary" : "btn-outline"),
        onClick: () => {
          document.documentElement.setAttribute("data-theme", opt.id);
          try { localStorage.setItem("osler-admin-theme", opt.id); } catch {}
          window.OslerAdmin.navigate("settings");
        },
      }, opt.label);
      themeGrid.appendChild(btn);
    }
    themeCard.appendChild(themeGrid);
    wrap.appendChild(themeCard);

    // Project card
    const projCard = el("div", { class: "card" });
    projCard.appendChild(el("div", { class: "card-title" }, t("settings.section.project")));
    const rootRow = el("div", { style: { display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" } });
    rootRow.appendChild(el("div", { style: { flex: "1", minWidth: "200px" } },
      el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)" }, }, t("settings.project.root")),
      el("div", { style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem", wordBreak: "break-all" } }, projectState && projectState.root ? projectState.root : "—")
    ));
    const changeBtn = el("button", { class: "btn btn-outline btn-sm" }, t("settings.project.change"));
    changeBtn.addEventListener("click", async () => {
      await pickProjectRoot();
      window.OslerAdmin.navigate("settings");
    });
    rootRow.appendChild(changeBtn);
    projCard.appendChild(rootRow);

    if (projectState && projectState.root) {
      const meta = el("div", { class: "grid grid-2", style: { marginTop: "0.5rem" } });
      meta.appendChild(el("div", {},
        el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)" }, }, t("settings.project.gitRemote")),
        el("div", { style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem", wordBreak: "break-all" } }, projectState.gitRemote || "—")
      ));
      meta.appendChild(el("div", {},
        el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)" }, }, t("settings.project.gitBranch")),
        el("div", { style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem" } }, projectState.gitBranch || "—")
      ));
      projCard.appendChild(meta);
    }
    wrap.appendChild(projCard);

    view.appendChild(wrap);
  };
})();
