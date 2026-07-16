// views/instance.js — Instance Generator view.
//
// Scaffolds a brand-new Osler project into a user-chosen directory. The Rust
// backend `generate_instance` command does the actual file creation; this
// view collects the options (target directory, site identity, engines, theme,
// language) and shows a summary after creation.
//
// Use case: an educator wants to spin up a fresh Osler instance for a
// different course / department / language — instead of cloning the repo
// and editing config by hand, they fill in 6 fields here and the admin
// app produces a ready-to-run project folder.

(function () {
  "use strict";

  const { invoke, toast, helpers } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  const ENGINES = [
    { id: "quiz",      label: "Quiz" },
    { id: "bank",      label: "Question Bank" },
    { id: "written",   label: "Written" },
    { id: "flashcard", label: "Flashcards" },
    { id: "osce",      label: "OSCE" },
    { id: "library",   label: "Library" },
    { id: "video",     label: "Videos" },
  ];

  const THEME_PRESETS = [
    { id: "dark",          name: "Dark" },
    { id: "light",         name: "Light" },
    { id: "navy-clinic",   name: "Navy Clinic" },
    { id: "forest-rounds", name: "Forest Rounds" },
    { id: "cream-journal", name: "Cream Journal" },
    { id: "crimson-ed",    name: "Crimson ED" },
  ];

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.instance = async function (view) {
    const wrap = el("div", { class: "view medos-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("instance.title")),
        el("p", { class: "subtitle" }, t("instance.subtitle"))
      )
    ));

    const state = {
      targetDir: "",
      siteName: "",
      shortName: "",
      tagline: "",
      githubRepo: "https://github.com/eyad-elghareeb/osler",
      organisation: "",
      enabledEngines: ENGINES.map((e) => e.id), // all enabled by default
      defaultTheme: "dark",
      defaultLang: "en",
      includeSampleContent: true,
      result: null, // set after generate_instance succeeds
      busy: false,
    };

    // ── Form card ───────────────────────────────────────────────────
    const form = el("div", { class: "card", style: { padding: "1.5rem", marginBottom: "1.5rem" } });
    wrap.appendChild(form);

    // Target directory picker
    form.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, t("instance.targetDir")));
    const dirRow = el("div", { style: { display: "flex", gap: "0.5rem", marginBottom: "1rem" } });
    const dirInput = el("input", { type: "text", class: "input", placeholder: "/path/to/new-project", style: { flex: "1", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" } });
    dirInput.addEventListener("input", () => state.targetDir = dirInput.value);
    const dirBtn = el("button", { class: "btn btn-sm" }, t("instance.browse"));
    dirBtn.addEventListener("click", async () => {
      try {
        const folder = await invoke("plugin:dialog|open", {
          options: { directory: true, title: t("instance.browse"), multiple: false },
        });
        const p = typeof folder === "string" ? folder : null;
        if (p) {
          state.targetDir = p;
          dirInput.value = p;
        }
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    dirRow.appendChild(dirInput);
    dirRow.appendChild(dirBtn);
    form.appendChild(dirRow);
    form.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "-0.5rem", marginBottom: "1rem" } }, t("instance.targetDirHint")));

    // Site identity
    form.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, t("instance.siteIdentity")));
    const idGrid = el("div", { class: "grid grid-2", style: { marginBottom: "1rem" } });

    function labeledInput(label, value, onChange, placeholder) {
      const cell = el("div", {});
      cell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, label));
      const inp = el("input", { type: "text", class: "input", value: value, placeholder: placeholder || "" });
      inp.addEventListener("input", () => onChange(inp.value));
      cell.appendChild(inp);
      return cell;
    }

    idGrid.appendChild(labeledInput(t("instance.siteName"), state.siteName, (v) => state.siteName = v, "My Medical School"));
    idGrid.appendChild(labeledInput(t("instance.shortName"), state.shortName, (v) => state.shortName = v, "MMS"));
    idGrid.appendChild(labeledInput(t("instance.tagline"), state.tagline, (v) => state.tagline = v, "Personalised medical study platform"));
    idGrid.appendChild(labeledInput(t("instance.organisation"), state.organisation, (v) => state.organisation = v, "Your organisation"));
    form.appendChild(idGrid);

    form.appendChild(labeledInput(t("instance.githubRepo"), state.githubRepo, (v) => state.githubRepo = v, "https://github.com/you/your-osler"));
    form.appendChild(el("div", { style: { height: "1rem" } }));

    // Engines
    form.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, t("instance.engines")));
    const egGrid = el("div", { class: "grid grid-3", style: { marginBottom: "1rem" } });
    for (const e of ENGINES) {
      const enabled = state.enabledEngines.includes(e.id);
      const tile = el("button", {
        class: "card",
        style: {
          padding: "0.6rem",
          cursor: "pointer",
          textAlign: "start",
          fontSize: "0.8125rem",
          border: enabled ? "2px solid var(--primary)" : "1px solid var(--border)",
          background: enabled ? "var(--primary-dim)" : "var(--surface)",
        },
        onClick: () => {
          const i = state.enabledEngines.indexOf(e.id);
          if (i >= 0) state.enabledEngines.splice(i, 1);
          else state.enabledEngines.push(e.id);
          renderEngines();
        },
      }, e.label);
      egGrid.appendChild(tile);
    }
    function renderEngines() {
      egGrid.querySelectorAll("button").forEach((btn, i) => {
        const enabled = state.enabledEngines.includes(ENGINES[i].id);
        btn.style.border = enabled ? "2px solid var(--primary)" : "1px solid var(--border)";
        btn.style.background = enabled ? "var(--primary-dim)" : "var(--surface)";
      });
    }
    form.appendChild(egGrid);

    // Theme + language row
    const tlRow = el("div", { class: "grid grid-2", style: { marginBottom: "1rem" } });
    const themeCell = el("div", {});
    themeCell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, t("instance.theme")));
    const themeSel = el("select", { class: "input" });
    for (const th of THEME_PRESETS) {
      const opt = el("option", { value: th.id }, th.name);
      if (th.id === state.defaultTheme) opt.selected = true;
      themeSel.appendChild(opt);
    }
    themeSel.addEventListener("change", () => state.defaultTheme = themeSel.value);
    themeCell.appendChild(themeSel);
    tlRow.appendChild(themeCell);

    const langCell = el("div", {});
    langCell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, t("instance.language")));
    const langSel = el("select", { class: "input" });
    for (const opt of [{ id: "en", label: "English (LTR)" }, { id: "ar", label: "العربية (RTL)" }]) {
      const o = el("option", { value: opt.id }, opt.label);
      if (opt.id === state.defaultLang) o.selected = true;
      langSel.appendChild(o);
    }
    langSel.addEventListener("change", () => state.defaultLang = langSel.value);
    langCell.appendChild(langSel);
    tlRow.appendChild(langCell);
    form.appendChild(tlRow);

    // Sample content checkbox
    const sampleRow = el("label", { style: { display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", marginBottom: "1rem", fontSize: "0.875rem" } });
    const sampleChk = el("input", { type: "checkbox" });
    sampleChk.checked = state.includeSampleContent;
    sampleChk.addEventListener("change", () => state.includeSampleContent = sampleChk.checked);
    sampleRow.appendChild(sampleChk);
    sampleRow.appendChild(el("span", {}, t("instance.includeSample")));
    form.appendChild(sampleRow);

    // Generate button
    const genBtn = el("button", { class: "btn btn-primary" }, t("instance.generate"));
    genBtn.addEventListener("click", doGenerate);
    form.appendChild(genBtn);

    // ── Result panel (populated after generation) ──────────────────
    const resultPanel = el("div", { class: "card", style: { padding: "1.5rem", display: "none" } });
    wrap.appendChild(resultPanel);

    async function doGenerate() {
      // Validate required fields.
      if (!state.targetDir.trim()) { toast(t("instance.err.noDir"), "error"); return; }
      if (!state.siteName.trim()) { toast(t("instance.err.noName"), "error"); return; }
      if (!state.shortName.trim()) state.shortName = state.siteName;
      if (state.enabledEngines.length === 0) { toast(t("instance.err.noEngines"), "error"); return; }

      state.busy = true;
      genBtn.disabled = true;
      genBtn.textContent = t("instance.generating");

      try {
        const opts = {
          targetDir: state.targetDir,
          siteName: state.siteName,
          shortName: state.shortName,
          tagline: state.tagline || "Medical Study Platform",
          githubRepo: state.githubRepo || "https://github.com/eyad-elghareeb/osler",
          organisation: state.organisation || "Osler Team",
          enabledEngines: state.enabledEngines,
          defaultTheme: state.defaultTheme,
          defaultLang: state.defaultLang,
          includeSampleContent: state.includeSampleContent,
        };
        const res = await invoke("generate_instance", { opts });
        state.result = res;
        renderResult();
        toast(t("instance.generated", { dir: state.targetDir }), "success");
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        state.busy = false;
        genBtn.disabled = false;
        genBtn.textContent = t("instance.generate");
      }
    }

    function renderResult() {
      const res = state.result;
      if (!res) {
        resultPanel.style.display = "none";
        return;
      }
      resultPanel.style.display = "";
      resultPanel.innerHTML = "";

      resultPanel.appendChild(el("div", { class: "label", style: { marginBottom: "0.5rem", color: "var(--primary)" } }, "✓ " + t("instance.result.title")));
      resultPanel.appendChild(el("p", { style: { fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1rem" } }, t("instance.result.desc")));

      // Path
      const pathRow = el("div", { style: { marginBottom: "1rem" } });
      pathRow.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)" } }, t("instance.result.path")));
      pathRow.appendChild(el("div", { style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem", wordBreak: "break-all" } }, res.targetDir || ""));
      resultPanel.appendChild(pathRow);

      // Files list
      resultPanel.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.4rem" } }, t("instance.result.files") + " (" + (res.files || []).length + ")"));
      const fileList = el("div", { style: { background: "var(--surface-2)", borderRadius: "var(--radius-sm)", padding: "0.75rem", marginBottom: "1rem", maxHeight: "240px", overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "0.75rem" } });
      for (const f of (res.files || [])) {
        fileList.appendChild(el("div", {}, "• " + f));
      }
      resultPanel.appendChild(fileList);

      // Next-steps actions
      const actions = el("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap" } });
      const openBtn = el("button", { class: "btn btn-sm" }, t("instance.result.openDir"));
      openBtn.addEventListener("click", async () => {
        try {
          await invoke("open_external", { url: res.targetDir });
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      });
      actions.appendChild(openBtn);

      const switchBtn = el("button", { class: "btn btn-sm btn-primary" }, t("instance.result.switchProject"));
      switchBtn.addEventListener("click", async () => {
        try {
          await invoke("set_project_root", { root: res.targetDir });
          try { localStorage.setItem("osler-admin-project-root", res.targetDir); } catch {}
          await window.OslerAdmin.refreshProjectState();
          toast(t("project.state.connected"), "success");
          window.OslerAdmin.navigate("dashboard");
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      });
      actions.appendChild(switchBtn);
      resultPanel.appendChild(actions);
    }

    view.appendChild(wrap);
  };
})();
