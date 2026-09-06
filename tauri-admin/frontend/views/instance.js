// views/instance.js — Advanced Step-by-Step Instance Generator & Cloudflare Deployer.
//
// Features:
//   1. Step-by-step wizard (Prerequisites -> Identity & Engines -> Cloudflare Stack -> Automated Deploy -> Actions)
//   2. Cloud-enabled instance setup (D1 SQL database, R2 content storage, Worker backend, Pages frontend)
//   3. Live execution pipeline with real-time logs
//   4. Direct CLI actions: "npm run deploy:pages", "npm run deploy:worker", admin seed command

(function () {
  "use strict";

  const { invoke, toast, helpers } = window.OslerAdmin;
  const { el, svgIcon, t } = helpers;

  const ENGINES = [
    { id: "quiz", label: "Quiz" },
    { id: "bank", label: "Question Bank" },
    { id: "written", label: "Written" },
    { id: "flashcard", label: "Flashcards" },
    { id: "osce", label: "OSCE" },
    { id: "library", label: "Library" },
    { id: "video", label: "Videos" },
  ];

  const THEME_PRESETS = [
    { id: "dark", name: "Dark" },
    { id: "light", name: "Light" },
    { id: "navy-clinic", name: "Navy Clinic" },
    { id: "forest-rounds", name: "Forest Rounds" },
    { id: "cream-journal", name: "Cream Journal" },
    { id: "crimson-ed", name: "Crimson ED" },
  ];

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.instance = async function (view) {
    const wrap = el("div", { class: "view osler-fade-in" });

    wrap.appendChild(
      el(
        "div",
        { class: "view-header" },
        el(
          "div",
          {},
          el("h1", {}, t("instance.title")),
          el("p", { class: "subtitle" }, t("instance.subtitle"))
        )
      )
    );

    const state = {
      step: 1, // 1: Prereqs, 2: Identity, 3: Cloud config, 4: Deploy pipeline, 5: Done
      targetDir: "",
      siteName: "",
      shortName: "",
      tagline: "",
      githubRepo: "https://github.com/eyad-elghareeb/osler",
      organisation: "",
      enabledEngines: ENGINES.map((e) => e.id),
      defaultTheme: "dark",
      defaultLang: "en",
      includeSampleContent: false, // Cloud instances default to R2 cloud storage
      cloud: {
        enabled: true,
        workerUrl: "",
        workerName: "osler-cloud",
        projectName: "osler",
        d1Name: "osler-cloud",
        r2Name: "osler-content",
        allowedOrigin: "http://localhost:3000",
        turnstileSiteKey: "",
        googleClientId: "",
        googleClientSecret: "",
        googleConfigured: false,
      },
      adminUsername: "",
      health: null,
      prereqReport: null,
      deployLogs: [],
      deployRunning: false,
      result: null,
    };

    // Step indicator bar
    const stepBar = el("div", { class: "step-indicator-bar", style: { display: "flex", gap: "0.5rem", marginBottom: "1.5rem" } });
    wrap.appendChild(stepBar);

    // Step content container
    const stepHost = el("div", { id: "instance-step-host" });
    wrap.appendChild(stepHost);

    view.appendChild(wrap);

    renderStepBar();
    renderCurrentStep();

    function renderStepBar() {
      stepBar.innerHTML = "";
      const steps = [
        { num: 1, label: t("instance.step.prereqs") },
        { num: 2, label: t("instance.step.identity") },
        { num: 3, label: t("instance.step.cloud") },
        { num: 4, label: t("instance.step.deploy") },
        { num: 5, label: t("instance.step.ready") },
      ];

      for (const s of steps) {
        const item = el(
          "div",
          {
            class: "step-pill" + (state.step === s.num ? " active" : "") + (state.step > s.num ? " completed" : ""),
            style: {
              flex: "1",
              padding: "0.6rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              background: state.step === s.num ? "var(--primary-dim)" : "var(--surface)",
              border: state.step === s.num ? "1px solid var(--primary)" : "1px solid var(--border)",
              fontSize: "0.75rem",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: s.num <= state.step ? "pointer" : "default",
            },
            onClick: () => {
              if (s.num <= state.step) {
                state.step = s.num;
                renderStepBar();
                renderCurrentStep();
              }
            },
          },
          el("span", {
            style: {
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: state.step >= s.num ? "var(--primary)" : "var(--border)",
              color: "#fff",
              fontSize: "0.6875rem",
            },
          }, String(s.num)),
          el("span", {}, s.label)
        );
        stepBar.appendChild(item);
      }
    }

    function renderCurrentStep() {
      stepHost.innerHTML = "";
      if (state.step === 1) renderStep1Prereqs();
      else if (state.step === 2) renderStep2Identity();
      else if (state.step === 3) renderStep3Cloud();
      else if (state.step === 4) renderStep4Deploy();
      else if (state.step === 5) renderStep5Ready();
    }

    // ── STEP 1: PREREQUISITES ──────────────────────────────────────────
    async function renderStep1Prereqs() {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { fontSize: "1.125rem", margin: "0 0 0.5rem" } }, t("instance.prereqs.title")));
      card.appendChild(el("p", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0 0 1.25rem" } }, t("instance.prereqs.desc")));

      const listContainer = el("div", { style: { display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" } });
      listContainer.innerHTML = `<div style="display:flex;align-items:center;gap:0.75rem;padding:1rem;color:var(--text-muted);"><div class="spinner"></div><span>${t("common.loading")}</span></div>`;
      card.appendChild(listContainer);

      const navRow = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "0.5rem" } });
      const nextBtn = el("button", { class: "btn btn-primary" }, t("common.next"), svgIcon("M9 5l7 7-7 7", 14));
      nextBtn.addEventListener("click", () => {
        state.step = 2;
        renderStepBar();
        renderCurrentStep();
      });
      navRow.appendChild(nextBtn);
      card.appendChild(navRow);

      stepHost.appendChild(card);

      try {
        const rep = await invoke("check_prerequisites");
        state.prereqReport = rep;
        listContainer.innerHTML = "";
        for (const item of rep.items || []) {
          const row = el(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem 1rem",
                background: "var(--surface-2)",
                borderRadius: "var(--radius-sm)",
              },
            },
            el(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "0.75rem" } },
              el("span", { class: "badge " + (item.satisfied ? "badge-success" : "badge-danger") }, item.satisfied ? "✓" : "✗"),
              el(
                "div",
                {},
                el("div", { style: { fontWeight: "600", fontSize: "0.875rem" } }, item.label),
                el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } }, item.details)
              )
            ),
            el("span", { style: { fontFamily: "var(--font-mono)", fontSize: "0.75rem" } }, item.version)
          );
          listContainer.appendChild(row);
        }
      } catch (e) {
        listContainer.innerHTML = `<div style="color:var(--danger);font-size:0.8125rem;">${t("toast.error", { msg: String(e) })}</div>`;
      }
    }

    // ── STEP 2: IDENTITY & ENGINES ─────────────────────────────────────
    function renderStep2Identity() {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { fontSize: "1.125rem", margin: "0 0 0.5rem" } }, t("instance.identity.title")));

      // Target Directory Picker
      card.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, t("instance.targetDir")));
      const dirRow = el("div", { style: { display: "flex", gap: "0.5rem", marginBottom: "0.5rem" } });
      const dirInput = el("input", {
        type: "text",
        class: "input",
        value: state.targetDir,
        placeholder: "/path/to/new-osler-instance",
        style: { flex: "1", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" },
      });
      dirInput.addEventListener("input", () => (state.targetDir = dirInput.value));
      const dirBtn = el("button", { class: "btn btn-sm" }, t("instance.browse"));
      dirBtn.addEventListener("click", async () => {
        try {
          const folder = await invoke("plugin:dialog|open", {
            options: { directory: true, title: t("instance.browse"), multiple: false },
          });
          if (typeof folder === "string" && folder) {
            state.targetDir = folder;
            dirInput.value = folder;
          }
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      });
      dirRow.append(dirInput, dirBtn);
      card.appendChild(dirRow);
      card.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "1rem" } }, t("instance.targetDirHint")));

      // Site Identity Grid
      const idGrid = el("div", { class: "grid grid-2", style: { marginBottom: "1rem" } });
      function field(label, val, set, ph) {
        const c = el("div", {});
        c.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, label));
        const inp = el("input", { type: "text", class: "input", value: val, placeholder: ph || "" });
        inp.addEventListener("input", () => set(inp.value));
        c.appendChild(inp);
        return c;
      }

      idGrid.appendChild(field(t("instance.siteName"), state.siteName, (v) => { state.siteName = v; if (!state.shortName) state.shortName = v.slice(0, 4).toUpperCase(); }, "My Medical School"));
      idGrid.appendChild(field(t("instance.shortName"), state.shortName, (v) => (state.shortName = v), "MMS"));
      idGrid.appendChild(field(t("instance.tagline"), state.tagline, (v) => (state.tagline = v), "Medical Learning Platform"));
      idGrid.appendChild(field(t("instance.organisation"), state.organisation, (v) => (state.organisation = v), "Faculty of Medicine"));
      card.appendChild(idGrid);

      // Engines selection
      card.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, t("instance.engines")));
      const egGrid = el("div", { class: "grid grid-3", style: { marginBottom: "1rem" } });
      for (const e of ENGINES) {
        const enabled = state.enabledEngines.includes(e.id);
        const tile = el(
          "button",
          {
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
              const idx = state.enabledEngines.indexOf(e.id);
              if (idx >= 0) state.enabledEngines.splice(idx, 1);
              else state.enabledEngines.push(e.id);
              renderStep2Identity();
            },
          },
          e.label
        );
        egGrid.appendChild(tile);
      }
      card.appendChild(egGrid);

      // Theme & Language
      const tlRow = el("div", { class: "grid grid-2", style: { marginBottom: "1.5rem" } });
      const themeCell = el("div", {});
      themeCell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, t("instance.theme")));
      const themeSel = el("select", { class: "input" });
      for (const th of THEME_PRESETS) {
        const opt = el("option", { value: th.id }, th.name);
        if (th.id === state.defaultTheme) opt.selected = true;
        themeSel.appendChild(opt);
      }
      themeSel.addEventListener("change", () => (state.defaultTheme = themeSel.value));
      themeCell.appendChild(themeSel);
      tlRow.appendChild(themeCell);

      const langCell = el("div", {});
      langCell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, t("instance.language")));
      const langSel = el("select", { class: "input" });
      for (const l of [{ id: "en", label: "English" }, { id: "ar", label: "العربية" }]) {
        const o = el("option", { value: l.id }, l.label);
        if (l.id === state.defaultLang) o.selected = true;
        langSel.appendChild(o);
      }
      langSel.addEventListener("change", () => (state.defaultLang = langSel.value));
      langCell.appendChild(langSel);
      tlRow.appendChild(langCell);
      card.appendChild(tlRow);

      // Nav
      const navRow = el("div", { style: { display: "flex", justifyContent: "space-between" } });
      const prevBtn = el("button", { class: "btn btn-ghost" }, svgIcon("M15 19l-7-7 7-7", 14), t("common.prev"));
      prevBtn.addEventListener("click", () => { state.step = 1; renderStepBar(); renderCurrentStep(); });
      const nextBtn = el("button", { class: "btn btn-primary" }, t("common.next"), svgIcon("M9 5l7 7-7 7", 14));
      nextBtn.addEventListener("click", () => {
        if (!state.targetDir.trim()) { toast(t("instance.err.noDir"), "error"); return; }
        if (!state.siteName.trim()) { toast(t("instance.err.noName"), "error"); return; }
        state.step = 3;
        renderStepBar();
        renderCurrentStep();
      });
      navRow.append(prevBtn, nextBtn);
      card.appendChild(navRow);

      stepHost.appendChild(card);
    }

    // ── STEP 3: CLOUDFLARE CONFIGURATION ──────────────────────────────
    function renderStep3Cloud() {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { fontSize: "1.125rem", margin: "0 0 0.5rem" } }, t("instance.cloud.title")));
      card.appendChild(el("p", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0 0 1.25rem" } }, t("instance.cloud.desc")));

      // Cloud enabled toggle
      const toggleRow = el("label", { style: { display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", cursor: "pointer", fontWeight: "600" } });
      const chk = el("input", { type: "checkbox" });
      chk.checked = state.cloud.enabled;
      chk.addEventListener("change", () => {
        state.cloud.enabled = chk.checked;
        renderStep3Cloud();
      });
      toggleRow.append(chk, el("span", {}, t("instance.cloud.enableFullStack")));
      card.appendChild(toggleRow);

      if (state.cloud.enabled) {
        const cloudGrid = el("div", { class: "grid grid-2", style: { marginBottom: "1.25rem" } });
        function field(label, val, set, ph) {
          const c = el("div", {});
          c.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, label));
          const inp = el("input", { type: "text", class: "input", value: val, placeholder: ph || "" });
          inp.addEventListener("input", () => set(inp.value));
          c.appendChild(inp);
          return c;
        }

        cloudGrid.appendChild(field(t("instance.cloud.projectName"), state.cloud.projectName, (v) => state.cloud.projectName = v, "osler-school"));
        cloudGrid.appendChild(field(t("instance.cloud.workerName"), state.cloud.workerName, (v) => state.cloud.workerName = v, "osler-school-cloud"));
        cloudGrid.appendChild(field(t("instance.cloud.d1Name"), state.cloud.d1Name, (v) => state.cloud.d1Name = v, "osler-school-d1"));
        cloudGrid.appendChild(field(t("instance.cloud.r2Name"), state.cloud.r2Name, (v) => state.cloud.r2Name = v, "osler-school-content"));
        cloudGrid.appendChild(field(t("instance.cloud.allowedOrigin"), state.cloud.allowedOrigin, (v) => state.cloud.allowedOrigin = v, "https://school.pages.dev"));
        cloudGrid.appendChild(field(t("instance.cloud.turnstileKey"), state.cloud.turnstileSiteKey, (v) => state.cloud.turnstileSiteKey = v, "Optional Turnstile Key"));
        card.appendChild(cloudGrid);

        // R2 Note banner
        const r2Banner = el(
          "div",
          {
            style: {
              background: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.2)",
              borderRadius: "var(--radius-sm)",
              padding: "0.75rem 1rem",
              marginBottom: "1.25rem",
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
            },
          },
          "☁️ " + t("instance.cloud.r2HostingNote")
        );
        card.appendChild(r2Banner);

        // ── Google Sign-In (optional, guided) ──
        const googleCard = el("div", {
          style: {
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "1rem",
            marginBottom: "1.25rem",
          },
        });
        googleCard.appendChild(
          el("div", { style: { fontWeight: "600", fontSize: "0.875rem", marginBottom: "0.35rem" } }, "🔐 " + t("instance.google.title"))
        );
        googleCard.appendChild(
          el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "0.75rem" } }, t("instance.google.hint"))
        );
        const googleGrid = el("div", { class: "grid grid-2" });
        googleGrid.appendChild(field(t("instance.google.clientId"), state.cloud.googleClientId, (v) => state.cloud.googleClientId = v, "1234567890-abc.apps.googleusercontent.com"));
        googleGrid.appendChild(field(t("instance.google.clientSecret"), state.cloud.googleClientSecret, (v) => state.cloud.googleClientSecret = v, "GOCSPX-…"));
        googleCard.appendChild(googleGrid);
        googleCard.appendChild(
          el("div", { style: { fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "0.5rem" } }, t("instance.google.postDeployNote"))
        );
        card.appendChild(googleCard);
      }

      // Nav
      const navRow = el("div", { style: { display: "flex", justifyContent: "space-between" } });
      const prevBtn = el("button", { class: "btn btn-ghost" }, svgIcon("M15 19l-7-7 7-7", 14), t("common.prev"));
      prevBtn.addEventListener("click", () => { state.step = 2; renderStepBar(); renderCurrentStep(); });
      const nextBtn = el("button", { class: "btn btn-primary" }, t("instance.deployBtn"), svgIcon("M13 10V3L4 14h7v7l9-11h-7z", 14));
      nextBtn.addEventListener("click", () => {
        state.step = 4;
        renderStepBar();
        renderCurrentStep();
        startDeployPipeline();
      });
      navRow.append(prevBtn, nextBtn);
      card.appendChild(navRow);

      stepHost.appendChild(card);
    }

    // ── STEP 4: DEPLOY PIPELINE & EXECUTION ───────────────────────────
    function renderStep4Deploy() {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { fontSize: "1.125rem", margin: "0 0 0.5rem" } }, t("instance.pipeline.title")));
      card.appendChild(el("p", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0 0 1.25rem" } }, t("instance.pipeline.desc")));

      // Pipeline progress status
      const pipeBox = el("div", { id: "pipeline-status-box", style: { marginBottom: "1rem" } });
      card.appendChild(pipeBox);

      // Terminal Log output
      const term = el("div", {
        id: "pipeline-terminal",
        style: {
          background: "#0d1117",
          color: "#c9d1d9",
          borderRadius: "var(--radius-sm)",
          padding: "1rem",
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          maxHeight: "280px",
          overflowY: "auto",
          marginBottom: "1.25rem",
        },
      });
      card.appendChild(term);

      const navRow = el("div", { id: "deploy-nav-row", style: { display: "flex", justifyContent: "flex-end", gap: "0.5rem" } });
      const finishBtn = el("button", { class: "btn btn-primary", id: "pipeline-finish-btn", disabled: true }, t("instance.viewActions"), svgIcon("M9 5l7 7-7 7", 14));
      finishBtn.addEventListener("click", () => {
        state.step = 5;
        renderStepBar();
        renderCurrentStep();
      });
      navRow.appendChild(finishBtn);
      card.appendChild(navRow);

      stepHost.appendChild(card);
    }

    async function startDeployPipeline() {
      const term = document.getElementById("pipeline-terminal");
      const pipeBox = document.getElementById("pipeline-status-box");
      const finishBtn = document.getElementById("pipeline-finish-btn");

      function addLog(msg, color = "#c9d1d9") {
        if (!term) return;
        const line = el("div", { style: { color, marginBottom: "0.2rem" } }, msg);
        term.appendChild(line);
        term.scrollTop = term.scrollHeight;
      }

      addLog("🚀 [1/3] Scaffolding instance files and configurations…", "#58a6ff");
      try {
        const genOpts = {
          targetDir: state.targetDir,
          siteName: state.siteName,
          shortName: state.shortName || state.siteName,
          tagline: state.tagline || "Medical Platform",
          githubRepo: state.githubRepo,
          organisation: state.organisation || "Osler",
          enabledEngines: state.enabledEngines,
          defaultTheme: state.defaultTheme,
          defaultLang: state.defaultLang,
          includeSampleContent: state.includeSampleContent,
          cloud: state.cloud.enabled ? state.cloud : null,
        };

        const res = await invoke("generate_instance", { opts: genOpts });
        state.result = res;
        addLog(`✓ Scaffolded ${res.files?.length || 0} files in ${state.targetDir}`, "#3fb950");

        if (state.cloud.enabled) {
          addLog("☁️ [2/3] Initializing Cloudflare D1, R2, Worker and Pages deploy…", "#58a6ff");
          const depRes = await invoke("deploy_cloudflare_full_stack", {
            targetDir: state.targetDir,
            origin: state.cloud.allowedOrigin || "http://localhost:3000",
            project: state.cloud.projectName,
            workerUrl: state.cloud.workerUrl || null,
            d1: state.cloud.d1Name,
            r2: state.cloud.r2Name,
          });
          addLog(`✓ Deployment pipeline triggered: ${depRes.pipeline}`, "#3fb950");

          // Poll deploy logs
          pollDeployStatus(addLog, finishBtn);
        } else {
          addLog("✓ [3/3] Local instance ready!", "#3fb950");
          if (finishBtn) finishBtn.disabled = false;
        }
      } catch (err) {
        addLog(`✗ Generation error: ${String(err)}`, "#f85149");
        toast(t("toast.error", { msg: String(err) }), "error");
        if (finishBtn) finishBtn.disabled = false;
      }
    }

    function pollDeployStatus(addLog, finishBtn) {
      let pollCount = 0;
      const timer = setInterval(async () => {
        pollCount++;
        try {
          const st = await invoke("deploy_status");
          if (st.logs && st.logs.length > state.deployLogs.length) {
            for (let i = state.deployLogs.length; i < st.logs.length; i++) {
              const l = st.logs[i];
              const c = l.stream === "error" ? "#f85149" : l.stream === "success" ? "#3fb950" : l.stream === "warn" ? "#d29922" : "#c9d1d9";
              addLog(l.text, c);
            }
            state.deployLogs = st.logs;
          }
          if (!st.running) {
            clearInterval(timer);
            if (st.success) {
              addLog("🎉 Cloudflare Full Stack Deployment Complete!", "#3fb950");
              toast(t("instance.deployComplete"), "success");
              // Post-deploy setup: the Worker is live, so optional secrets
              // collected in step 3 (Google OAuth) can be written now.
              try {
                if (state.cloud.enabled && state.cloud.googleClientSecret) {
                  addLog("🔐 Writing Google OAuth secrets…", "#58a6ff");
                  await invoke("setup_write_secrets", {
                    targetDir: state.targetDir,
                    secrets: [
                      { name: "GOOGLE_CLIENT_ID", value: state.cloud.googleClientId || "" },
                      { name: "GOOGLE_CLIENT_SECRET", value: state.cloud.googleClientSecret },
                    ],
                  });
                  state.cloud.googleConfigured = true;
                  addLog("✓ Google Sign-In is configured (sign-in enabled on next login)", "#3fb950");
                }
              } catch (e) {
                addLog(`⚠️ ${t("instance.google.saveFailed")}: ${String(e)}`, "#d29922");
              }
            } else if (st.error) {
              addLog(`⚠️ Deploy notice: ${st.error}`, "#d29922");
            }
            if (finishBtn) finishBtn.disabled = false;
          }
        } catch (e) {
          if (pollCount > 10) clearInterval(timer);
        }
      }, 1000);
    }

    // ── STEP 5: READY & ACTIONS ───────────────────────────────────────
    function renderStep5Ready() {
      const card = el("div", { class: "card", style: { padding: "1.5rem" } });
      card.appendChild(el("h2", { style: { fontSize: "1.25rem", margin: "0 0 0.5rem", color: "var(--success)" } }, "🎉 " + t("instance.ready.title")));
      card.appendChild(el("p", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", margin: "0 0 1.25rem" } }, t("instance.ready.desc")));

      // Summary details
      const summaryGrid = el("div", { style: { background: "var(--surface-2)", borderRadius: "var(--radius-sm)", padding: "1rem", marginBottom: "1.5rem" } });
      summaryGrid.appendChild(el("div", { style: { fontSize: "0.8125rem", marginBottom: "0.4rem" } }, `📁 Location: ${state.targetDir}`));
      let workerUrl = `https://${state.cloud.workerName || "osler-cloud"}.workers.dev`;
      if (state.cloud.enabled) {
        workerUrl = state.cloud.workerUrl || workerUrl;
        summaryGrid.appendChild(el("div", { style: { fontSize: "0.8125rem", marginBottom: "0.4rem" } }, `🌐 Pages Project: https://${state.cloud.projectName}.pages.dev`));
        summaryGrid.appendChild(el("div", { style: { fontSize: "0.8125rem" } }, `⚡ Worker: ${workerUrl}`));
      }
      card.appendChild(summaryGrid);

      // ── Finish setup (cloud instances) ──
      if (state.cloud.enabled) {
        const setupCard = el("div", {
          style: {
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "1rem",
            marginBottom: "1.5rem",
          },
        });
        setupCard.appendChild(el("div", { style: { fontWeight: "600", fontSize: "0.875rem", marginBottom: "0.75rem" } }, "🧭 " + t("instance.setup.title")));

        // 1) Health check
        const healthRow = el("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" } });
        const healthBtn = el("button", { class: "btn btn-sm" }, t("instance.setup.checkHealth"));
        const healthOut = el("span", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } }, "");
        healthBtn.addEventListener("click", async () => {
          healthOut.textContent = "…";
          healthOut.style.color = "var(--text-muted)";
          try {
            const res = await invoke("setup_check_health", { workerUrl });
            state.health = res;
            healthOut.textContent = res.ok ? `✓ ${t("instance.setup.healthy")}` : `✗ ${res.status}`;
            healthOut.style.color = res.ok ? "var(--success)" : "var(--danger)";
          } catch (e) {
            state.health = { ok: false };
            healthOut.textContent = `✗ ${String(e).slice(0, 80)}`;
            healthOut.style.color = "var(--danger)";
          }
        });
        healthRow.append(healthBtn, healthOut);
        setupCard.appendChild(healthRow);

        // 2) Google Sign-In (if not already configured during deploy)
        if (!state.cloud.googleConfigured) {
          const gLabel = (txt) => el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", margin: "0.6rem 0 0.25rem" } }, txt);
          setupCard.appendChild(el("div", { style: { fontWeight: "600", fontSize: "0.8125rem" } }, "🔐 " + t("instance.google.title")));
          const cb = el("code", { style: { display: "block", fontSize: "0.6875rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)", margin: "0.25rem 0 0.5rem", wordBreak: "break-all" } }, t("instance.google.callbackPrefix") + `${workerUrl}/v1/auth/google/callback`);
          setupCard.appendChild(cb);
          const gId = el("input", { type: "text", class: "input", value: state.cloud.googleClientId, placeholder: "…apps.googleusercontent.com", style: { marginBottom: "0.5rem" } });
          const gSecret = el("input", { type: "text", class: "input", value: state.cloud.googleClientSecret, placeholder: "GOCSPX-…" });
          setupCard.append(gLabel(t("instance.google.clientId")), gId, gLabel(t("instance.google.clientSecret")), gSecret);
          const gSave = el("button", { class: "btn btn-sm", style: { marginTop: "0.6rem" } }, t("instance.google.save"));
          const gOut = el("span", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "0.5rem" } }, "");
          gSave.addEventListener("click", async () => {
            if (!gId.value.trim() || !gSecret.value.trim()) { toast(t("instance.google.missing"), "error"); return; }
            gOut.textContent = "…";
            try {
              await invoke("setup_write_secrets", {
                targetDir: state.targetDir,
                secrets: [
                  { name: "GOOGLE_CLIENT_ID", value: gId.value.trim() },
                  { name: "GOOGLE_CLIENT_SECRET", value: gSecret.value.trim() },
                ],
              });
              state.cloud.googleConfigured = true;
              gOut.textContent = "✓ " + t("instance.setup.saved");
              gOut.style.color = "var(--success)";
              toast(t("instance.setup.googleDone"), "success");
            } catch (e) {
              gOut.textContent = "✗ " + String(e).slice(0, 80);
              gOut.style.color = "var(--danger)";
            }
          });
          setupCard.append(gSave, gOut);
        }

        // 3) First admin promotion
        setupCard.appendChild(el("div", { style: { fontWeight: "600", fontSize: "0.8125rem", margin: "0.75rem 0 0.25rem" } }, "👤 " + t("instance.admin.title")));
        setupCard.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "0.5rem" } }, t("instance.admin.hint")));
        const adminRow = el("div", { style: { display: "flex", gap: "0.5rem" } });
        const adminInput = el("input", { type: "text", class: "input", value: state.adminUsername, placeholder: t("instance.admin.placeholder") });
        adminInput.addEventListener("input", () => state.adminUsername = adminInput.value);
        const adminBtn = el("button", { class: "btn btn-sm" }, t("instance.admin.promote"));
        adminBtn.addEventListener("click", async () => {
          if (!state.adminUsername.trim()) { toast(t("instance.admin.missing"), "error"); return; }
          try {
            await invoke("setup_promote_admin", {
              targetDir: state.targetDir,
              d1Name: state.cloud.d1Name || "osler-cloud",
              username: state.adminUsername.trim(),
            });
            toast(t("instance.admin.done"), "success");
          } catch (e) {
            toast(t("toast.error", { msg: String(e) }), "error");
          }
        });
        adminRow.append(adminInput, adminBtn);
        setupCard.appendChild(adminRow);

        card.appendChild(setupCard);
      }

      // Direct Deploy & Management Actions
      card.appendChild(el("div", { class: "label", style: { marginBottom: "0.6rem" } }, t("instance.quickActions")));
      const actionRow = el("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" } });

      const deployPagesBtn = el("button", { class: "btn btn-sm btn-primary" }, svgIcon("M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", 14), "Deploy Pages (npm run deploy:pages)");
      deployPagesBtn.addEventListener("click", async () => {
        try {
          await invoke("set_project_root", { root: state.targetDir });
          await invoke("deploy_pages_cli");
          toast("Deploy Pages started", "success");
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      });
      actionRow.appendChild(deployPagesBtn);

      const deployWorkerBtn = el("button", { class: "btn btn-sm btn-primary" }, svgIcon("M13 10V3L4 14h7v7l9-11h-7z", 14), "Deploy Worker (npm run deploy:worker)");
      deployWorkerBtn.addEventListener("click", async () => {
        try {
          await invoke("set_project_root", { root: state.targetDir });
          await invoke("deploy_worker_cli");
          toast("Deploy Worker started", "success");
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      });
      actionRow.appendChild(deployWorkerBtn);

      const switchBtn = el("button", { class: "btn btn-sm" }, t("instance.result.switchProject"));
      switchBtn.addEventListener("click", async () => {
        try {
          await invoke("set_project_root", { root: state.targetDir });
          try { localStorage.setItem("osler-admin-project-root", state.targetDir); } catch {}
          await window.OslerAdmin.refreshProjectState();
          toast(t("project.state.connected"), "success");
          window.OslerAdmin.navigate("dashboard");
        } catch (e) {
          toast(t("toast.error", { msg: String(e) }), "error");
        }
      });
      actionRow.appendChild(switchBtn);

      const openDirBtn = el("button", { class: "btn btn-sm" }, t("instance.result.openDir"));
      openDirBtn.addEventListener("click", () => {
        invoke("open_external", { url: state.targetDir });
      });
      actionRow.appendChild(openDirBtn);

      card.appendChild(actionRow);
      stepHost.appendChild(card);
    }
  };
})();
