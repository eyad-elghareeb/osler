// views/config.js — osler.config.json editor.
//
// A structured editor for the project's osler.config.json file. Surfaces
// every section of the config schema with form-style controls:
//   - Site identity (name, short name, tagline, github repo, organisation)
//   - Engine plugins (toggle enabled + override label/color/icon)
//   - Themes (default + custom palette editor)
//   - Defaults (landing view, language, quiz, AI, sync)
//   - Wizard state (read-only status badge)
//
// Also includes a raw JSON tab for power users who want to edit the file
// directly. Save writes via the Tauri backend's `write_config` command.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  const ENGINES = [
    { id: "quiz",      label: "Quiz",           defaultLabel: "Quiz",           defaultColor: "oklch(0.62 0.16 250)", defaultIcon: "clipboard" },
    { id: "bank",      label: "Bank",           defaultLabel: "Question Bank",  defaultColor: "oklch(0.58 0.14 245)", defaultIcon: "book" },
    { id: "written",   label: "Written",        defaultLabel: "Written",        defaultColor: "oklch(0.78 0.16 80)",  defaultIcon: "pen-tool" },
    { id: "flashcard", label: "Flashcards",     defaultLabel: "Flashcards",     defaultColor: "oklch(0.7 0.18 145)",  defaultIcon: "layers" },
    { id: "osce",      label: "OSCE",           defaultLabel: "OSCE",           defaultColor: "oklch(0.7 0.2 16)",    defaultIcon: "activity" },
    { id: "library",   label: "Library",        defaultLabel: "Library",        defaultColor: "oklch(0.65 0.15 280)", defaultIcon: "book-open" },
    { id: "video",     label: "Videos",         defaultLabel: "Videos",         defaultColor: "oklch(0.68 0.18 195)", defaultIcon: "video" },
  ];

  const VIEW_OPTIONS = [
    "dashboard", "learn", "library", "qbank", "flashcards", "osce", "videos", "profile", "settings",
  ];

  const QUIZ_METHODS = ["network", "qr", "file"];

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.config = async function (view) {
    const wrap = el("div", { class: "view osler-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("config.title")),
        el("p", { class: "subtitle" }, t("config.subtitle"))
      )
    ));

    if (!requireProject()) {
      view.appendChild(wrap);
      return;
    }

    // Config state — the in-memory mirror of osler.config.json.
    let cfg = null;
    let dirty = false;
    let activeTab = "site"; // site | engines | themes | defaults | raw

    // Load existing config (or default skeleton if missing).
    try {
      cfg = await invoke("read_config");
    } catch (e) {
      // No config yet — start with a default skeleton.
      cfg = {
        schemaVersion: 1,
        site: {
          name: "Osler", shortName: "Osler", tagline: "Medical Study Platform",
          githubRepo: "https://github.com/eyad-elghareeb/osler", organisation: "Osler Team",
        },
        engines: Object.fromEntries(ENGINES.map((e) => [e.id, { enabled: true }])),
        themes: { default: "dark", custom: [] },
        defaults: {
          view: "dashboard",
          language: { ui: "en", content: "all" },
          quiz: { questionCount: 10, secondsPerQuestion: 60, tutorMode: false, shuffle: true },
          ai: { model: "gemini-2.5-flash", enabled: true, temperature: 0.4 },
          sync: { method: "network", defaultRoom: "osler-default" },
        },
        wizard: { completed: false, version: 1 },
      };
      toast(t("config.noConfigLoaded"), "info");
    }

    // ── Tab bar ─────────────────────────────────────────────────────
    const tabBar = el("div", { style: { display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--border)", marginBottom: "1rem", flexWrap: "wrap" } });
    const tabs = [
      { id: "site",     label: t("config.tab.site") },
      { id: "engines",  label: t("config.tab.engines") },
      { id: "themes",   label: t("config.tab.themes") },
      { id: "defaults", label: t("config.tab.defaults") },
      { id: "raw",      label: t("config.tab.raw") },
    ];
    tabs.forEach((tab) => {
      const btn = el("button", {
        class: "config-tab",
        style: {
          padding: "0.5rem 0.875rem",
          background: "transparent",
          border: "none",
          borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
          color: activeTab === tab.id ? "var(--primary)" : "var(--text-muted)",
          cursor: "pointer",
          fontSize: "0.8125rem",
          fontWeight: "600",
        },
        onClick: () => { activeTab = tab.id; renderTabs(); renderBody(); },
      }, tab.label);
      tabBar.appendChild(btn);
    });
    wrap.appendChild(tabBar);

    function renderTabs() {
      tabBar.querySelectorAll(".config-tab").forEach((btn, i) => {
        const id = tabs[i].id;
        btn.style.borderBottom = activeTab === id ? "2px solid var(--primary)" : "2px solid transparent";
        btn.style.color = activeTab === id ? "var(--primary)" : "var(--text-muted)";
      });
    }

    // ── Body container ──────────────────────────────────────────────
    const body = el("div", {});
    wrap.appendChild(body);

    // ── Save bar (sticky at the bottom) ─────────────────────────────
    const saveBar = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" } });
    const resetBtn = el("button", { class: "btn btn-ghost" }, t("config.reset"));
    resetBtn.addEventListener("click", async () => {
      // Re-load from disk, discarding local edits.
      try {
        cfg = await invoke("read_config");
        dirty = false;
        renderBody();
        updateSaveBar();
        toast(t("config.resetDone"), "info");
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    const saveBtn = el("button", { class: "btn btn-primary" }, t("config.save"));
    saveBtn.addEventListener("click", async () => {
      try {
        await invoke("write_config", { config: cfg });
        dirty = false;
        updateSaveBar();
        toast(t("config.saved"), "success");
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    saveBar.appendChild(resetBtn);
    saveBar.appendChild(saveBtn);
    wrap.appendChild(saveBar);

    function updateSaveBar() {
      saveBtn.textContent = dirty ? t("config.save") + " *" : t("config.save");
      saveBtn.disabled = !dirty;
    }

    function renderBody() {
      body.innerHTML = "";
      switch (activeTab) {
        case "site":     renderSite(body); break;
        case "engines":  renderEngines(body); break;
        case "themes":   renderThemes(body); break;
        case "defaults": renderDefaults(body); break;
        case "raw":      renderRaw(body); break;
      }
      updateSaveBar();
    }

    function markDirty() {
      dirty = true;
      updateSaveBar();
    }

    // ── Field helpers ───────────────────────────────────────────────

    function labeled(label, inputNode, hint) {
      const cell = el("div", { style: { marginBottom: "1rem" } });
      cell.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, label));
      cell.appendChild(inputNode);
      if (hint) cell.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" } }, hint));
      return cell;
    }

    function textInput(value, onChange) {
      const inp = el("input", { type: "text", class: "input", value: value || "", style: { width: "100%" } });
      inp.addEventListener("input", () => { onChange(inp.value); markDirty(); });
      return inp;
    }

    function numberInput(value, onChange, opts) {
      opts = opts || {};
      const inp = el("input", { type: "number", class: "input", value: String(value ?? 0), style: { width: opts.width || "120px" } });
      if (opts.min != null) inp.min = String(opts.min);
      if (opts.step != null) inp.step = String(opts.step);
      inp.addEventListener("input", () => { onChange(Number(inp.value) || 0); markDirty(); });
      return inp;
    }

    function toggle(value, onChange) {
      const btn = el("button", {
        type: "button",
        style: {
          width: "40px", height: "22px", borderRadius: "11px",
          background: value ? "var(--primary)" : "var(--border)",
          position: "relative", cursor: "pointer", border: "none", padding: "0",
          transition: "background 0.2s",
        },
        onClick: () => { onChange(!value); btn.style.background = !value ? "var(--primary)" : "var(--border)"; btn.querySelector("span").style.transform = !value ? "translateX(18px)" : "translateX(0)"; markDirty(); },
      });
      const dot = el("span", { style: { position: "absolute", top: "2px", left: "2px", width: "18px", height: "18px", borderRadius: "50%", background: "white", transform: value ? "translateX(18px)" : "translateX(0)", transition: "transform 0.2s" } });
      btn.appendChild(dot);
      return btn;
    }

    function selectInput(value, options, onChange) {
      const sel = el("select", { class: "input" });
      for (const opt of options) {
        const o = el("option", { value: opt.value }, opt.label);
        if (opt.value === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => { onChange(sel.value); markDirty(); });
      return sel;
    }

    // ── Site tab ────────────────────────────────────────────────────

    function renderSite(parent) {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { marginBottom: "0.75rem" } }, t("config.tab.site")));
      card.appendChild(labeled(t("config.site.name"), textInput(cfg.site.name, (v) => cfg.site.name = v)));
      card.appendChild(labeled(t("config.site.shortName"), textInput(cfg.site.shortName, (v) => cfg.site.shortName = v), t("config.site.shortNameHint")));
      card.appendChild(labeled(t("config.site.tagline"), textInput(cfg.site.tagline, (v) => cfg.site.tagline = v)));
      card.appendChild(labeled(t("config.site.githubRepo"), textInput(cfg.site.githubRepo, (v) => cfg.site.githubRepo = v), t("config.site.githubRepoHint")));
      card.appendChild(labeled(t("config.site.organisation"), textInput(cfg.site.organisation, (v) => cfg.site.organisation = v)));
      card.appendChild(labeled(t("config.site.supportEmail"), textInput(cfg.site.supportEmail || "", (v) => cfg.site.supportEmail = v)));
      parent.appendChild(card);
    }

    // ── Engines tab ─────────────────────────────────────────────────

    function renderEngines(parent) {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { marginBottom: "0.75rem" } }, t("config.tab.engines")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" } }, t("config.engines.desc")));

      for (const e of ENGINES) {
        const entry = cfg.engines[e.id] || (cfg.engines[e.id] = { enabled: true });
        if (!entry || typeof entry !== "object") {
          cfg.engines[e.id] = { enabled: !!entry };
        }
        const row = el("div", { class: "card", style: { padding: "1rem", marginBottom: "0.75rem", background: "var(--surface-2)" } });

        // Header row: label + toggle
        const header = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" } });
        header.appendChild(el("div", { style: { fontWeight: "600", fontSize: "0.875rem" } }, e.label));
        header.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
          el("span", { style: { fontSize: "0.75rem", color: entry.enabled ? "var(--primary)" : "var(--text-muted)" } }, entry.enabled ? t("config.engines.enabled") : t("config.engines.disabled")),
          toggle(entry.enabled, (v) => { cfg.engines[e.id].enabled = v; header.querySelector("span").textContent = v ? t("config.engines.enabled") : t("config.engines.disabled"); header.querySelector("span").style.color = v ? "var(--primary)" : "var(--text-muted)"; })
        ));
        row.appendChild(header);

        // Override fields (label / color / icon) — collapsed by default
        const overrides = el("div", { class: "grid grid-3", style: { marginTop: "0.5rem" } });
        overrides.appendChild(labeled(t("config.engines.overrideLabel"), textInput(entry.label || "", (v) => { cfg.engines[e.id].label = v || undefined; })));
        overrides.appendChild(labeled(t("config.engines.overrideColor"), textInput(entry.color || "", (v) => { cfg.engines[e.id].color = v || undefined; })));
        overrides.appendChild(labeled(t("config.engines.overrideIcon"), textInput(entry.icon || "", (v) => { cfg.engines[e.id].icon = v || undefined; })));
        row.appendChild(overrides);

        card.appendChild(row);
      }

      parent.appendChild(card);
    }

    // ── Themes tab ──────────────────────────────────────────────────

    function renderThemes(parent) {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { marginBottom: "0.75rem" } }, t("config.tab.themes")));

      // Default theme selector
      const allThemeIds = ["dark", "light", ...(cfg.themes.custom || []).map((x) => x.id)];
      const opts = allThemeIds.map((id) => {
        if (id === "dark") return { value: "dark", label: "Dark (built-in)" };
        if (id === "light") return { value: "light", label: "Light (built-in)" };
        const ct = (cfg.themes.custom || []).find((x) => x.id === id);
        return { value: id, label: (ct && ct.name) || id };
      });
      card.appendChild(labeled(t("config.themes.default"), selectInput(cfg.themes.default, opts, (v) => cfg.themes.default = v)));

      // Custom themes
      card.appendChild(el("div", { class: "label", style: { marginTop: "1rem", marginBottom: "0.5rem" } }, t("config.themes.custom")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" } }, t("config.themes.customDesc")));

      const list = el("div", {});
      function renderList() {
        list.innerHTML = "";
        const custom = cfg.themes.custom || [];
        if (custom.length === 0) {
          list.appendChild(el("div", { style: { padding: "0.75rem", background: "var(--surface-2)", borderRadius: "var(--radius-sm)", fontSize: "0.8125rem", color: "var(--text-muted)" } }, t("config.themes.noCustom")));
        }
        for (let i = 0; i < custom.length; i++) {
          const ct = custom[i];
          const tile = el("div", { class: "card", style: { padding: "0.75rem", marginBottom: "0.5rem", background: "var(--surface-2)" } });
          const header = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" } });
          header.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
            el("span", { style: { width: "16px", height: "16px", borderRadius: "4px", background: ct.primary || "var(--primary)", border: "1px solid var(--border)" } }),
            el("span", { style: { fontWeight: "600", fontSize: "0.8125rem" } }, ct.name + " "),
            el("span", { style: { fontSize: "0.6875rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" } }, ct.variant + " · " + ct.id)
          ));
          const delBtn = el("button", { class: "btn btn-sm btn-ghost", style: { color: "var(--destructive)" } }, t("common.delete"));
          delBtn.addEventListener("click", () => {
            cfg.themes.custom.splice(i, 1);
            markDirty();
            renderList();
          });
          header.appendChild(delBtn);
          tile.appendChild(header);

          const fields = el("div", { class: "grid grid-3", style: { gap: "0.5rem" } });
          fields.appendChild(labeled("ID", textInput(ct.id, (v) => { ct.id = v; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.name"), textInput(ct.name, (v) => { ct.name = v; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.variant"), selectInput(ct.variant, [{ value: "dark", label: "dark" }, { value: "light", label: "light" }], (v) => { ct.variant = v; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.primary"), textInput(ct.primary || "", (v) => { ct.primary = v || undefined; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.background"), textInput(ct.background || "", (v) => { ct.background = v || undefined; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.foreground"), textInput(ct.foreground || "", (v) => { ct.foreground = v || undefined; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.accent"), textInput(ct.accent || "", (v) => { ct.accent = v || undefined; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.border"), textInput(ct.border || "", (v) => { ct.border = v || undefined; markDirty(); })));
          fields.appendChild(labeled(t("config.themes.field.destructive"), textInput(ct.destructive || "", (v) => { ct.destructive = v || undefined; markDirty(); })));
          tile.appendChild(fields);

          list.appendChild(tile);
        }
      }
      renderList();
      card.appendChild(list);

      const addBtn = el("button", { class: "btn btn-sm", style: { marginTop: "0.75rem" } }, "+ " + t("config.themes.add"));
      addBtn.addEventListener("click", () => {
        const n = (cfg.themes.custom || []).length + 1;
        if (!cfg.themes.custom) cfg.themes.custom = [];
        cfg.themes.custom.push({
          id: "custom-" + n,
          name: "Custom " + n,
          variant: "dark",
          primary: "oklch(0.58 0.14 245)",
          background: "oklch(0.14 0.018 260)",
          foreground: "oklch(0.96 0.005 240)",
        });
        markDirty();
        renderList();
      });
      card.appendChild(addBtn);

      parent.appendChild(card);
    }

    // ── Defaults tab ────────────────────────────────────────────────

    function renderDefaults(parent) {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { marginBottom: "0.75rem" } }, t("config.tab.defaults")));

      const d = cfg.defaults;
      card.appendChild(labeled(t("config.defaults.view"), selectInput(d.view, VIEW_OPTIONS.map((v) => ({ value: v, label: v })), (v) => d.view = v)));
      card.appendChild(labeled(t("config.defaults.uiLang"), selectInput(d.language.ui, [{ value: "en", label: "English" }, { value: "ar", label: "العربية" }], (v) => d.language.ui = v)));
      card.appendChild(labeled(t("config.defaults.contentFilter"), selectInput(d.language.content, [{ value: "all", label: "all" }, { value: "en", label: "en" }, { value: "ar", label: "ar" }], (v) => d.language.content = v)));

      // Quiz defaults
      card.appendChild(el("div", { class: "label", style: { marginTop: "1rem", marginBottom: "0.5rem" } }, t("config.defaults.quiz")));
      const qGrid = el("div", { class: "grid grid-2" });
      qGrid.appendChild(labeled(t("config.defaults.quizCount"), numberInput(d.quiz.questionCount, (v) => d.quiz.questionCount = v, { min: 1 })));
      qGrid.appendChild(labeled(t("config.defaults.quizSecPerQ"), numberInput(d.quiz.secondsPerQuestion, (v) => d.quiz.secondsPerQuestion = v, { min: 0 })));
      qGrid.appendChild(labeled(t("config.defaults.quizTutor"), toggle(d.quiz.tutorMode, (v) => d.quiz.tutorMode = v)));
      qGrid.appendChild(labeled(t("config.defaults.quizShuffle"), toggle(d.quiz.shuffle, (v) => d.quiz.shuffle = v)));
      card.appendChild(qGrid);

      // AI defaults
      card.appendChild(el("div", { class: "label", style: { marginTop: "1rem", marginBottom: "0.5rem" } }, t("config.defaults.ai")));
      const aiGrid = el("div", { class: "grid grid-2" });
      aiGrid.appendChild(labeled(t("config.defaults.aiModel"), textInput(d.ai.model, (v) => d.ai.model = v)));
      aiGrid.appendChild(labeled(t("config.defaults.aiEnabled"), toggle(d.ai.enabled, (v) => d.ai.enabled = v)));
      aiGrid.appendChild(labeled(t("config.defaults.aiTemp"), numberInput(d.ai.temperature, (v) => d.ai.temperature = v, { min: 0, step: 0.1 })));
      card.appendChild(aiGrid);

      // Sync defaults
      card.appendChild(el("div", { class: "label", style: { marginTop: "1rem", marginBottom: "0.5rem" } }, t("config.defaults.sync")));
      const syncGrid = el("div", { class: "grid grid-2" });
      syncGrid.appendChild(labeled(t("config.defaults.syncMethod"), selectInput(d.sync.method, QUIZ_METHODS.map((m) => ({ value: m, label: m })), (v) => d.sync.method = v)));
      syncGrid.appendChild(labeled(t("config.defaults.syncRoom"), textInput(d.sync.defaultRoom, (v) => d.sync.defaultRoom = v)));
      card.appendChild(syncGrid);

      parent.appendChild(card);
    }

    // ── Raw JSON tab ────────────────────────────────────────────────

    function renderRaw(parent) {
      const card = el("div", { class: "card", style: { padding: "1rem" } });
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.8125rem", marginBottom: "0.75rem" } }, t("config.raw.desc")));
      const ta = el("textarea", {
        class: "input",
        style: { width: "100%", minHeight: "480px", fontFamily: "var(--font-mono)", fontSize: "0.75rem" },
      });
      ta.value = JSON.stringify(cfg, null, 2);
      ta.addEventListener("input", () => {
        try {
          const next = JSON.parse(ta.value);
          cfg = next;
          markDirty();
          ta.style.borderColor = "";
        } catch {
          ta.style.borderColor = "var(--destructive)";
        }
      });
      card.appendChild(ta);
      parent.appendChild(card);
    }

    renderBody();
    updateSaveBar();
    view.appendChild(wrap);
  };
})();
