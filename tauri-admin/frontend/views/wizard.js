// views/wizard.js — First-time setup wizard for osler.config.json.
//
// Runs automatically on first launch (when no osler.config.json exists in the
// project root). Walks the user through:
//   1. Site identity (name, short name, tagline, organisation)
//   2. GitHub repo reference (always required)
//   3. Engine plugins — toggle which engines are enabled
//   4. Default theme (built-in + any custom themes the user defines)
//   5. Default language
//   6. Review + save → writes osler.config.json via the Tauri backend
//
// The wizard can be re-run any time from the sidebar — it loads the current
// config as the starting state so the user can amend fields without losing
// the rest.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  // Canonical engine plugin list — kept in sync with ENGINE_PLUGIN_IDS in
  // src/lib/osler/config.ts. The Rust backend also knows about these.
  const ENGINES = [
    { id: "quiz",      label: "Quiz",           desc: "Standard MCQ quizzes with 5 choices",           icon: "M9 11l3 3 8-8M4 14l3 3 8-8M4 6l3 3 8-8" },
    { id: "bank",      label: "Question Bank",  desc: "Passage-based questions with shared context",   icon: "M4 4h16v16H4zM4 9h16M9 4v16" },
    { id: "written",   label: "Written",        desc: "Free-text prompts with rubric review",          icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" },
    { id: "flashcard", label: "Flashcards",     desc: "Spaced-repetition decks with subdecks",         icon: "M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-3H4a1 1 0 0 0-1 1z" },
    { id: "osce",      label: "OSCE",           desc: "Clinical exam simulator with AI voice",         icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
    { id: "library",   label: "Library",        desc: "Markdown article reader with highlighting",     icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" },
    { id: "video",     label: "Videos",         desc: "Video library with YouTube / mp4 / HLS",        icon: "m22 8-6 4 6 4V8zM2 6h12v12H2z" },
  ];

  // Built-in + preset theme options. The user can add more in the Config
  // editor — the wizard only offers the common ones for a fast first-run.
  const THEME_PRESETS = [
    { id: "dark",          name: "Dark",          variant: "dark"  },
    { id: "light",         name: "Light",         variant: "light" },
    { id: "navy-clinic",   name: "Navy Clinic",   variant: "dark"  },
    { id: "forest-rounds", name: "Forest Rounds", variant: "dark"  },
    { id: "cream-journal", name: "Cream Journal", variant: "light" },
    { id: "crimson-ed",    name: "Crimson ED",    variant: "dark"  },
  ];

  const STEPS = [
    { id: "site",     label: "Site identity" },
    { id: "repo",     label: "GitHub repo"   },
    { id: "engines",  label: "Engine plugins" },
    { id: "theme",    label: "Theme" },
    { id: "language", label: "Language" },
    { id: "review",   label: "Review" },
  ];

  // Default state for a fresh wizard run. Merged over the existing config
  // (if any) when the wizard loads.
  function defaultState() {
    return {
      siteName: "Osler",
      shortName: "Osler",
      tagline: "Medical Study Platform",
      organisation: "Osler Team",
      supportEmail: "",
      githubRepo: "https://github.com/eyad-elghareeb/osler",
      engines: Object.fromEntries(ENGINES.map((e) => [e.id, true])),
      defaultTheme: "dark",
      defaultLang: "en",
      includeSampleContent: false,
    };
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.wizard = async function (view) {
    const wrap = el("div", { class: "view medos-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("wizard.title")),
        el("p", { class: "subtitle" }, t("wizard.subtitle"))
      )
    ));

    if (!requireProject()) {
      view.appendChild(wrap);
      return;
    }

    // Step state — 0-indexed into STEPS.
    let step = 0;
    let state = defaultState();

    // Try to load the existing config so re-running the wizard pre-fills
    // with the current values rather than defaults.
    try {
      const cfg = await invoke("read_config");
      if (cfg && typeof cfg === "object") {
        state.siteName = cfg.site?.name ?? state.siteName;
        state.shortName = cfg.site?.shortName ?? state.shortName;
        state.tagline = cfg.site?.tagline ?? state.tagline;
        state.organisation = cfg.site?.organisation ?? state.organisation;
        state.supportEmail = cfg.site?.supportEmail ?? state.supportEmail;
        state.githubRepo = cfg.site?.githubRepo ?? state.githubRepo;
        state.defaultTheme = cfg.themes?.default ?? state.defaultTheme;
        state.defaultLang = cfg.defaults?.language?.ui ?? state.defaultLang;
        if (cfg.engines && typeof cfg.engines === "object") {
          for (const e of ENGINES) {
            const v = cfg.engines[e.id];
            state.engines[e.id] = v && typeof v === "object" ? v.enabled !== false : true;
          }
        }
      }
    } catch {
      // No config yet — keep defaults.
    }

    // ── Step indicator ──────────────────────────────────────────────
    const stepBar = el("div", { class: "wizard-stepbar", style: { display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" } });
    STEPS.forEach((s, i) => {
      const chip = el("div", {
        class: "wizard-step-chip",
        style: {
          display: "flex", alignItems: "center", gap: "0.4rem",
          padding: "0.4rem 0.75rem",
          borderRadius: "var(--radius-sm)",
          fontSize: "0.75rem",
          cursor: "pointer",
          border: i === step ? "1px solid var(--primary)" : "1px solid var(--border)",
          background: i === step ? "var(--primary-dim)" : "var(--surface)",
          color: i === step ? "var(--primary)" : "var(--text-muted)",
        },
        onClick: () => { step = i; render(); },
      },
        el("span", { style: { fontWeight: "600" } }, String(i + 1)),
        el("span", {}, s.label)
      );
      stepBar.appendChild(chip);
    });
    wrap.appendChild(stepBar);

    // ── Step content container ──────────────────────────────────────
    const stepContent = el("div", { class: "wizard-content" });
    wrap.appendChild(stepContent);

    // ── Footer (prev / next / save) ─────────────────────────────────
    const footer = el("div", { class: "wizard-footer", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" } });
    wrap.appendChild(footer);

    function renderFooter() {
      footer.innerHTML = "";
      const prev = el("button", { class: "btn btn-ghost", onClick: () => { if (step > 0) { step--; render(); } } }, "← " + t("wizard.previous"));
      if (step === 0) prev.disabled = true;
      footer.appendChild(prev);

      const right = el("div", { style: { display: "flex", gap: "0.5rem" } });
      if (step < STEPS.length - 1) {
        right.appendChild(el("button", { class: "btn btn-primary", onClick: () => { step++; render(); } }, t("wizard.next") + " →"));
      } else {
        const save = el("button", { class: "btn btn-primary", onClick: save }, t("wizard.save"));
        right.appendChild(save);
      }
      footer.appendChild(right);
    }

    async function save() {
      // Build the config object from the wizard state. We mirror the schema
      // in src/lib/osler/config.ts so the resulting file is consumable by
      // the Next.js client without further transformation.
      const engines = {};
      for (const e of ENGINES) {
        engines[e.id] = { enabled: !!state.engines[e.id] };
      }
      const cfg = {
        schemaVersion: 1,
        site: {
          name: state.siteName.trim() || "Osler",
          shortName: state.shortName.trim() || state.siteName.trim() || "Osler",
          tagline: state.tagline.trim() || "Medical Study Platform",
          githubRepo: state.githubRepo.trim() || "https://github.com/eyad-elghareeb/osler",
          organisation: state.organisation.trim() || "Osler Team",
          supportEmail: state.supportEmail || "",
        },
        engines,
        themes: {
          default: state.defaultTheme,
          // Preserve any custom themes from the existing config.
          custom: [],
        },
        defaults: {
          view: "dashboard",
          language: { ui: state.defaultLang, content: "all" },
          quiz: { questionCount: 10, secondsPerQuestion: 60, tutorMode: false, shuffle: true },
          ai: { model: "gemini-2.5-flash", enabled: true, temperature: 0.4 },
          sync: { method: "network", defaultRoom: "osler-default" },
        },
        wizard: { completed: true, completedAt: new Date().toISOString(), version: 1 },
      };

      // Pull in any custom themes from the existing config so we don't blow
      // them away when re-running the wizard.
      try {
        const existing = await invoke("read_config");
        if (existing?.themes?.custom && Array.isArray(existing.themes.custom)) {
          cfg.themes.custom = existing.themes.custom;
        }
      } catch { /* no existing config — fine */ }

      try {
        await invoke("write_config", { config: cfg });
        toast(t("wizard.saved"), "success");
        window.OslerAdmin.navigate("dashboard");
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    }

    function render() {
      // Update step bar active state.
      stepBar.querySelectorAll(".wizard-step-chip").forEach((chip, i) => {
        chip.style.border = i === step ? "1px solid var(--primary)" : "1px solid var(--border)";
        chip.style.background = i === step ? "var(--primary-dim)" : "var(--surface)";
        chip.style.color = i === step ? "var(--primary)" : "var(--text-muted)";
      });

      stepContent.innerHTML = "";
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      stepContent.appendChild(card);

      switch (STEPS[step].id) {
        case "site":     renderSite(card); break;
        case "repo":     renderRepo(card); break;
        case "engines":  renderEngines(card); break;
        case "theme":    renderTheme(card); break;
        case "language": renderLanguage(card); break;
        case "review":   renderReview(card); break;
      }
      renderFooter();
    }

    // ── Step renderers ──────────────────────────────────────────────

    function field(card, label, input, hint) {
      const wrap2 = el("div", { style: { marginBottom: "1rem" } });
      wrap2.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, label));
      wrap2.appendChild(input);
      if (hint) wrap2.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" } }, hint));
      card.appendChild(wrap2);
    }

    function textInput(value, onChange, opts) {
      opts = opts || {};
      const inp = el("input", {
        type: "text",
        class: "input",
        value: value,
        style: { width: "100%" },
        placeholder: opts.placeholder || "",
      });
      inp.addEventListener("input", () => onChange(inp.value));
      return inp;
    }

    function renderSite(card) {
      card.appendChild(el("h2", { style: { marginBottom: "0.5rem" } }, t("wizard.step.site.title")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" } }, t("wizard.step.site.desc")));

      field(card, t("wizard.step.site.name"), textInput(state.siteName, (v) => state.siteName = v), t("wizard.step.site.nameHint"));
      field(card, t("wizard.step.site.shortName"), textInput(state.shortName, (v) => state.shortName = v), t("wizard.step.site.shortNameHint"));
      field(card, t("wizard.step.site.tagline"), textInput(state.tagline, (v) => state.tagline = v));
      field(card, t("wizard.step.site.organisation"), textInput(state.organisation, (v) => state.organisation = v));
      field(card, t("wizard.step.site.supportEmail"), textInput(state.supportEmail, (v) => state.supportEmail = v));
    }

    function renderRepo(card) {
      card.appendChild(el("h2", { style: { marginBottom: "0.5rem" } }, t("wizard.step.repo.title")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" } }, t("wizard.step.repo.desc")));

      field(card, t("wizard.step.repo.url"), textInput(state.githubRepo, (v) => state.githubRepo = v), t("wizard.step.repo.urlHint"));

      // Live preview of how the link will appear.
      const preview = el("div", { class: "card", style: { marginTop: "1rem", background: "var(--surface-2)", padding: "0.75rem" } });
      preview.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.4rem" } }, t("wizard.step.repo.preview")));
      const link = el("a", {
        href: state.githubRepo || "#",
        target: "_blank",
        rel: "noopener noreferrer",
        style: { color: "var(--primary)", fontSize: "0.875rem", wordBreak: "break-all" },
      }, state.githubRepo || "—");
      preview.appendChild(link);
      card.appendChild(preview);

      card.appendChild(el("div", {
        style: { marginTop: "1rem", padding: "0.75rem", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", fontSize: "0.75rem", color: "var(--text-muted)" },
      }, el("strong", {}, "ℹ "), t("wizard.step.repo.policy")));
    }

    function renderEngines(card) {
      card.appendChild(el("h2", { style: { marginBottom: "0.5rem" } }, t("wizard.step.engines.title")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" } }, t("wizard.step.engines.desc")));

      const grid = el("div", { class: "grid grid-2" });
      for (const e of ENGINES) {
        const enabled = !!state.engines[e.id];
        const tile = el("div", {
          class: "card",
          style: {
            padding: "1rem",
            cursor: "pointer",
            border: enabled ? "2px solid var(--primary)" : "1px solid var(--border)",
            background: enabled ? "var(--primary-dim)" : "var(--surface)",
          },
          onClick: () => { state.engines[e.id] = !state.engines[e.id]; render(); },
        });
        const header = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" } });
        header.appendChild(el("div", { style: { flex: "1" } },
          el("div", { style: { fontWeight: "600", fontSize: "0.875rem" } }, e.label),
          el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" } }, e.desc)
        ));
        // Toggle indicator
        header.appendChild(el("div", {
          style: {
            width: "36px", height: "20px", borderRadius: "10px",
            background: enabled ? "var(--primary)" : "var(--border)",
            position: "relative", flexShrink: "0",
            transition: "background 0.2s",
          },
        }));
        tile.appendChild(header);
        grid.appendChild(tile);
      }
      card.appendChild(grid);

      card.appendChild(el("div", {
        style: { marginTop: "1rem", padding: "0.75rem", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", fontSize: "0.75rem", color: "var(--text-muted)" },
      }, el("strong", {}, "ℹ "), t("wizard.step.engines.note")));
    }

    function renderTheme(card) {
      card.appendChild(el("h2", { style: { marginBottom: "0.5rem" } }, t("wizard.step.theme.title")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" } }, t("wizard.step.theme.desc")));

      const grid = el("div", { class: "grid grid-3" });
      for (const th of THEME_PRESETS) {
        const active = state.defaultTheme === th.id;
        const tile = el("button", {
          class: "card",
          style: {
            padding: "0.75rem",
            cursor: "pointer",
            textAlign: "start",
            border: active ? "2px solid var(--primary)" : "1px solid var(--border)",
            background: active ? "var(--primary-dim)" : "var(--surface)",
          },
          onClick: () => { state.defaultTheme = th.id; render(); },
        },
          el("div", { style: { fontWeight: "600", fontSize: "0.875rem" } }, th.name),
          el("div", { style: { fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "0.2rem", textTransform: "uppercase", letterSpacing: "0.06em" } }, th.variant)
        );
        grid.appendChild(tile);
      }
      card.appendChild(grid);

      card.appendChild(el("div", {
        style: { marginTop: "1rem", padding: "0.75rem", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", fontSize: "0.75rem", color: "var(--text-muted)" },
      }, el("strong", {}, "ℹ "), t("wizard.step.theme.note")));
    }

    function renderLanguage(card) {
      card.appendChild(el("h2", { style: { marginBottom: "0.5rem" } }, t("wizard.step.language.title")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" } }, t("wizard.step.language.desc")));

      const grid = el("div", { class: "grid grid-2", style: { maxWidth: "480px" } });
      for (const opt of [
        { id: "en", label: "English", native: "English", dir: "LTR" },
        { id: "ar", label: "Arabic", native: "العربية", dir: "RTL" },
      ]) {
        const active = state.defaultLang === opt.id;
        const btn = el("button", {
          class: "card",
          style: {
            padding: "0.75rem",
            cursor: "pointer",
            textAlign: "start",
            display: "flex", gap: "0.75rem", alignItems: "center",
            border: active ? "2px solid var(--primary)" : "1px solid var(--border)",
            background: active ? "var(--primary-dim)" : "var(--surface)",
          },
          onClick: () => { state.defaultLang = opt.id; render(); },
        });
        btn.appendChild(el("div", {
          class: "brand-mark",
          style: { width: "36px", height: "36px", background: active ? "var(--primary)" : "var(--surface-2)", color: active ? "var(--primary-foreground)" : "var(--text-muted)" },
        }, opt.id === "ar" ? "ع" : "EN"));
        btn.appendChild(el("div", {},
          el("div", { style: { fontWeight: "600", fontSize: "0.875rem" } }, opt.label),
          el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)" }, dir: opt.id === "ar" ? "rtl" : "ltr", lang: opt.id }, opt.native + " · " + opt.dir)
        ));
        grid.appendChild(btn);
      }
      card.appendChild(grid);
    }

    function renderReview(card) {
      card.appendChild(el("h2", { style: { marginBottom: "0.5rem" } }, t("wizard.step.review.title")));
      card.appendChild(el("p", { style: { color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" } }, t("wizard.step.review.desc")));

      const enabledEngines = ENGINES.filter((e) => state.engines[e.id]).map((e) => e.label);
      const disabledEngines = ENGINES.filter((e) => !state.engines[e.id]).map((e) => e.label);

      function row(label, value) {
        return el("div", { style: { display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.5rem 0", borderBottom: "1px solid var(--border)", fontSize: "0.875rem" } },
          el("div", { style: { color: "var(--text-muted)" } }, label),
          el("div", { style: { fontWeight: "500", textAlign: "end" } }, value)
        );
      }

      card.appendChild(row(t("wizard.step.site.name"), state.siteName));
      card.appendChild(row(t("wizard.step.site.shortName"), state.shortName));
      card.appendChild(row(t("wizard.step.site.tagline"), state.tagline));
      card.appendChild(row(t("wizard.step.site.organisation"), state.organisation));
      card.appendChild(row(t("wizard.step.repo.url"), state.githubRepo));
      card.appendChild(row(t("wizard.step.engines.title"), enabledEngines.length + " / " + ENGINES.length));
      if (disabledEngines.length > 0) {
        card.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" } },
          t("wizard.step.review.disabled") + ": " + disabledEngines.join(", ")));
      }
      card.appendChild(row(t("wizard.step.theme.title"), THEME_PRESETS.find((x) => x.id === state.defaultTheme)?.name || state.defaultTheme));
      card.appendChild(row(t("wizard.step.language.title"), state.defaultLang === "ar" ? "Arabic (RTL)" : "English (LTR)"));

      card.appendChild(el("div", {
        style: { marginTop: "1rem", padding: "0.75rem", borderRadius: "var(--radius-sm)", background: "var(--primary-dim)", fontSize: "0.75rem", color: "var(--primary)" },
      }, el("strong", {}, "✓ "), t("wizard.step.review.ready")));
    }

    render();
    view.appendChild(wrap);
  };
})();
