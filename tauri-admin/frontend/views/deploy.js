// views/deploy.js — Connect Provider & Deploy page.
//
// Lets the user connect one or more hosting providers (Vercel, GitHub Pages,
// Cloudflare Pages, Netlify) using Personal Access Tokens, then trigger
// production deploys via the Rust backend in src/deploy.rs.
//
// All token fields are redacted when re-read back from the backend — empty
// submissions preserve the saved token, so users can update non-secret fields
// without re-entering their PAT each time.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  /* ─── Provider metadata ──────────────────────────────────────────── */

  const PROVIDERS = [
    {
      id: "vercel",
      name: "Vercel",
      glyph: "▲",
      logoClass: "vercel",
      desc: t("deploy.vercel.desc"),
      fields: [
        { id: "token", label: t("deploy.field.token"), type: "password", placeholder: "vercel_xxxxxxxxxxxxxxxxxxxx", hint: t("deploy.vercel.tokenHint") },
        { id: "project_name", label: t("deploy.field.projectName"), type: "text", placeholder: "osler-web" },
        { id: "branch", label: t("deploy.field.branch"), type: "text", placeholder: "main", hint: t("deploy.field.branchHint") },
      ],
      docsUrl: "https://vercel.com/account/tokens",
    },
    {
      id: "github_pages",
      name: "GitHub Pages",
      glyph: "GH",
      logoClass: "gh",
      desc: t("deploy.gh.desc"),
      fields: [
        { id: "token", label: t("deploy.field.token"), type: "password", placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx", hint: t("deploy.gh.tokenHint") },
        { id: "owner", label: t("deploy.field.owner"), type: "text", placeholder: "your-username" },
        { id: "repo", label: t("deploy.field.repo"), type: "text", placeholder: "your-username.github.io" },
        { id: "branch", label: t("deploy.field.branch"), type: "text", placeholder: "gh-pages", hint: t("deploy.gh.branchHint") },
        { id: "source_dir", label: t("deploy.field.sourceDir"), type: "text", placeholder: "auto", hint: t("deploy.gh.sourceHint") },
      ],
      docsUrl: "https://github.com/settings/tokens",
    },
    {
      id: "cloudflare_pages",
      name: "Cloudflare Pages",
      glyph: "CF",
      logoClass: "cf",
      desc: t("deploy.cf.desc"),
      fields: [
        { id: "api_token", label: t("deploy.field.apiToken"), type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx", hint: t("deploy.cf.tokenHint") },
        { id: "account_id", label: t("deploy.field.accountId"), type: "text", placeholder: "abcd1234abcd1234abcd1234abcd1234" },
        { id: "project_name", label: t("deploy.field.projectName"), type: "text", placeholder: "osler-web" },
        { id: "branch", label: t("deploy.field.branch"), type: "text", placeholder: "main" },
      ],
      docsUrl: "https://dash.cloudflare.com/profile/api-tokens",
    },
    {
      id: "netlify",
      name: "Netlify",
      glyph: "NF",
      logoClass: "netlify",
      desc: t("deploy.netlify.desc"),
      fields: [
        { id: "token", label: t("deploy.field.token"), type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx", hint: t("deploy.netlify.tokenHint") },
        { id: "site_id", label: t("deploy.field.siteId"), type: "text", placeholder: "abcd1234-1234-1234-1234-abcdef123456" },
        { id: "deploy_title", label: t("deploy.field.deployTitle"), type: "text", placeholder: "Osler Admin deploy" },
      ],
      docsUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
    },
  ];

  /* ─── State ──────────────────────────────────────────────────────── */

  let savedConfig = {};
  let pollTimer = null;

  /* ─── Helpers ────────────────────────────────────────────────────── */

  function isConfigured(providerId) {
    const cfg = savedConfig[providerId];
    if (!cfg) return false;
    // A provider is "connected" if at least one token-shaped field is set.
    // The saved config returns redacted tokens as "••••••••" — that counts
    // as configured (the real value is on disk). Empty/missing means not set.
    return Object.keys(cfg).some((k) => {
      if (!(k.includes("token") || k === "api_key")) return false;
      const v = cfg[k];
      // Non-empty string (including redacted "••••••••") counts as configured.
      return typeof v === "string" && v.length > 0;
    });
  }

  function getConfiguredProviders() {
    return PROVIDERS.filter((p) => isConfigured(p.id));
  }

  async function loadConfig() {
    try {
      savedConfig = (await invoke("get_deploy_config")) || {};
    } catch (e) {
      savedConfig = {};
    }
  }

  /* ─── Provider card ──────────────────────────────────────────────── */

  function providerCard(provider) {
    const connected = isConfigured(provider.id);
    const card = el("div", { class: "provider-card" + (connected ? " connected" : ""), "data-provider": provider.id });
    card.classList.add("medos-fade-in");

    const head = el("div", { class: "provider-head" });
    head.appendChild(el("div", { class: "provider-logo " + provider.logoClass }, provider.glyph));
    head.appendChild(el("div", {},
      el("div", { class: "provider-name" }, provider.name),
      el("div", { class: "provider-desc" }, provider.desc)
    ));
    head.appendChild(el("div", { class: "provider-status" },
      connected
        ? el("span", { class: "badge badge-success" }, svgIcon("M9 12l2 2 4-4", 12), t("deploy.connected"))
        : el("span", { class: "badge" }, t("deploy.notConnected"))
    ));
    card.appendChild(head);

    // Fields
    const saved = savedConfig[provider.id] || {};
    for (const field of provider.fields) {
      const isSecret = field.type === "password";
      const value = isSecret && saved[field.id] ? "••••••••" : (saved[field.id] || "");
      const fieldEl = el("div", { class: "field" });
      fieldEl.appendChild(el("label", { class: "label", for: `pf-${provider.id}-${field.id}` }, field.label));
      const input = el("input", {
        class: "input",
        id: `pf-${provider.id}-${field.id}`,
        type: field.type,
        placeholder: field.placeholder || "",
        "data-provider": provider.id,
        "data-field": field.id,
        autocomplete: "off",
        spellcheck: "false",
      });
      if (isSecret) input.setAttribute("autocomplete", "new-password");
      input.value = value;
      fieldEl.appendChild(input);
      if (field.hint) {
        fieldEl.appendChild(el("div", { class: "hint" }, field.hint));
      }
      card.appendChild(fieldEl);
    }

    // Action row
    const actions = el("div", { class: "fe-toolbar", style: { marginTop: "0.25rem" } });

    const saveBtn = el("button", { class: "btn btn-sm", "data-action": "save" }, svgIcon("M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z", 12), t("deploy.save"));
    saveBtn.addEventListener("click", () => saveProvider(provider));
    actions.appendChild(saveBtn);

    const testBtn = el("button", { class: "btn btn-ghost btn-sm", "data-action": "test" }, svgIcon("M21 12a9 9 0 1 1-9-9c2.39 0 4.68.94 6.36 2.64L21 9", 12), t("deploy.test"));
    testBtn.addEventListener("click", () => testProvider(provider));
    actions.appendChild(testBtn);

    const deployBtn = el("button", { class: "btn btn-primary btn-sm", "data-action": "deploy" }, svgIcon("M5 12h14M13 5l7 7-7 7", 12), t("deploy.deployNow"));
    deployBtn.disabled = !connected;
    deployBtn.addEventListener("click", () => triggerDeploy(provider));
    actions.appendChild(deployBtn);

    if (connected) {
      const clearBtn = el("button", { class: "btn btn-danger btn-sm", "data-action": "clear", style: { marginInlineStart: "auto" } }, svgIcon("M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", 12), t("deploy.clear"));
      clearBtn.addEventListener("click", () => clearProvider(provider));
      actions.appendChild(clearBtn);
    }

    const docsLink = el("a", { class: "btn btn-ghost btn-sm", href: provider.docsUrl, target: "_blank", rel: "noreferrer" }, svgIcon("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3", 12), t("deploy.getToken"));
    actions.appendChild(docsLink);

    card.appendChild(actions);
    return card;
  }

  /* ─── Actions ────────────────────────────────────────────────────── */

  function collectFieldValues(provider) {
    const out = {};
    for (const field of provider.fields) {
      const input = document.getElementById(`pf-${provider.id}-${field.id}`);
      if (!input) continue;
      out[field.id] = input.value;
    }
    return out;
  }

  async function saveProvider(provider) {
    const values = collectFieldValues(provider);
    try {
      const res = await invoke("set_deploy_config", {
        config: { [provider.id]: values },
      });
      savedConfig = res || savedConfig;
      toast(t("deploy.toast.saved", { name: provider.name }), "success");
      rerenderProviderCard(provider.id);
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function testProvider(provider) {
    // Save first so the backend has the latest values, then test.
    await saveProvider(provider);
    toast(t("deploy.toast.testing", { name: provider.name }), "info");
    try {
      const res = await invoke("test_deploy_connection", { provider: provider.id });
      if (res && res.ok) {
        const details = res.details || {};
        const detailStr = Object.keys(details).map((k) => `${k}: ${details[k]}`).join(" · ");
        toast(t("deploy.toast.testOk", { name: provider.name }) + (detailStr ? " — " + detailStr : ""), "success");
      } else {
        toast(t("deploy.toast.testFail", { name: provider.name }) + " — " + (res && res.error || "unknown error"), "error");
      }
    } catch (e) {
      toast(t("deploy.toast.testFail", { name: provider.name }) + " — " + String(e), "error");
    }
  }

  async function clearProvider(provider) {
    if (!confirm(t("deploy.confirmClear", { name: provider.name }))) return;
    try {
      const res = await invoke("clear_deploy_provider", { provider: provider.id });
      savedConfig = res || savedConfig;
      toast(t("deploy.toast.cleared", { name: provider.name }), "info");
      rerenderProviderCard(provider.id);
      updateDeployPanel();
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function triggerDeploy(provider) {
    // Persist current field values first so the deploy uses the latest config.
    await saveProvider(provider);
    if (!isConfigured(provider.id)) {
      toast(t("deploy.toast.notConfigured", { name: provider.name }), "error");
      return;
    }
    const skipBuild = document.getElementById("skip-build-checkbox");
    try {
      await invoke("deploy", {
        provider: provider.id,
        skipBuild: !!(skipBuild && skipBuild.checked),
      });
      toast(t("deploy.toast.started", { name: provider.name }), "info");
      startPolling();
      updateDeployPanel();
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  /* ─── Deploy console (live log + status) ─────────────────────────── */

  function renderConsole() {
    const consoleEl = document.getElementById("deploy-console");
    if (!consoleEl) return;
    invoke("deploy_status").then((status) => {
      consoleEl.innerHTML = "";
      if (!status || (!status.logs && !status.running && !status.error)) {
        consoleEl.appendChild(el("div", { class: "empty-state", style: { padding: "2rem 1rem" } },
          el("div", { class: "empty-state-text" }, t("deploy.console.empty"))
        ));
        return;
      }
      if (status.logs && status.logs.length) {
        for (const line of status.logs) {
          const row = el("div", { class: "log-line" });
          const ts = new Date(line.ts).toLocaleTimeString();
          row.appendChild(el("span", { class: "ts" }, ts));
          row.appendChild(el("span", { class: "stream-" + line.stream }, line.text));
          consoleEl.appendChild(row);
        }
        consoleEl.scrollTop = consoleEl.scrollHeight;
      }
    });
  }

  function renderProgress() {
    const progressEl = document.getElementById("deploy-progress");
    if (!progressEl) return;
    invoke("deploy_status").then((status) => {
      progressEl.innerHTML = "";
      if (!status || !status.running) return;
      const meta = el("div", { style: { display: "flex", alignItems: "center", gap: "0.625rem", flex: "1", minWidth: "0" } });
      meta.appendChild(el("span", { class: "spinner" }));
      meta.appendChild(el("span", { style: { fontWeight: "500" } }, t("deploy.inProgress", { provider: status.provider })));
      progressEl.appendChild(meta);
      const stopBtn = el("button", { class: "btn btn-danger btn-sm" }, t("common.close"));
      stopBtn.addEventListener("click", async () => {
        await invoke("deploy_stop");
        stopPolling();
        renderProgress();
      });
      progressEl.appendChild(stopBtn);
    });
  }

  function startPolling() {
    if (pollTimer) return;
    renderProgress();
    renderConsole();
    pollTimer = setInterval(() => {
      renderProgress();
      renderConsole();
      invoke("deploy_status").then((status) => {
        if (!status || !status.running) {
          stopPolling();
          if (status && status.success) {
            toast(t("deploy.toast.success", { provider: status.provider }), "success");
          } else if (status && status.error) {
            toast(t("deploy.toast.failed", { provider: status.provider }) + " — " + status.error, "error");
          }
          updateDeployPanel();
        }
      });
    }, 1200);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // One last render so the final state shows.
    renderProgress();
    renderConsole();
  }

  /* ─── Quick-deploy panel ─────────────────────────────────────────── */

  function updateDeployPanel() {
    const panel = document.getElementById("deploy-panel");
    if (!panel) return;
    panel.innerHTML = "";

    const connected = getConfiguredProviders();
    if (connected.length === 0) {
      panel.appendChild(el("div", { class: "empty-state", style: { padding: "2rem 1rem" } },
        el("div", { class: "empty-state-icon" }, svgIcon("M3.5 13.5 12 5l8.5 8.5", 24)),
        el("div", { class: "empty-state-title" }, t("deploy.panel.empty")),
        el("div", { class: "empty-state-text" }, t("deploy.panel.emptyHint"))
      ));
      return;
    }

    const row = el("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" } });
    row.appendChild(el("span", { class: "label", style: { marginBottom: "0", whiteSpace: "nowrap" } }, t("deploy.panel.quickDeploy")));
    for (const p of connected) {
      const btn = el("button", { class: "btn btn-primary btn-sm" },
        el("span", { class: "provider-logo " + p.logoClass, style: { width: "22px", height: "22px", fontSize: "0.6875rem" } }, p.glyph),
        t("deploy.panel.deployTo", { name: p.name })
      );
      btn.addEventListener("click", () => triggerDeploy(p));
      row.appendChild(btn);
    }
    panel.appendChild(row);

    // Skip-build checkbox
    const skipRow = el("label", { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.75rem", cursor: "pointer" } });
    const cb = el("input", { type: "checkbox", id: "skip-build-checkbox", checked: true });
    skipRow.appendChild(cb);
    skipRow.appendChild(el("span", {}, t("deploy.panel.skipBuild")));
    panel.appendChild(skipRow);

    // Result URL display
    invoke("deploy_status").then((status) => {
      if (status && status.resultUrl) {
        const result = el("div", { class: "card", style: { marginTop: "0.75rem", background: "var(--success-dim)", borderColor: "color-mix(in oklch, var(--success) 30%, transparent)" } });
        result.appendChild(el("div", { class: "label", style: { color: "var(--success)", marginBottom: "0.25rem" } }, t("deploy.panel.resultUrl")));
        const link = el("a", { href: status.resultUrl, target: "_blank", rel: "noreferrer", style: { color: "var(--success)", fontSize: "0.875rem", wordBreak: "break-all" } }, status.resultUrl);
        result.appendChild(link);
        panel.appendChild(result);
      }
    });
  }

  /* ─── Card rerender without losing scroll ────────────────────────── */

  function rerenderProviderCard(providerId) {
    const old = document.querySelector(`.provider-card[data-provider="${providerId}"]`);
    if (!old) return;
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;
    const fresh = providerCard(provider);
    old.replaceWith(fresh);
  }

  /* ─── View entry point ───────────────────────────────────────────── */

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.deploy = async function (view) {
    if (!requireProject()) {
      window.OslerAdmin.navigate("dashboard");
      return;
    }

    await loadConfig();

    const wrap = el("div", { class: "view medos-fade-in" });

    // Header
    const header = el("div", { class: "view-header" });
    header.appendChild(el("div", {},
      el("h1", {}, t("deploy.title")),
      el("p", { class: "subtitle" }, t("deploy.subtitle"))
    ));
    const headerActions = el("div", { class: "view-header-actions" });
    const refreshBtn = el("button", { class: "btn btn-ghost btn-sm" }, svgIcon("M21 12a9 9 0 1 1-9-9c2.39 0 4.68.94 6.36 2.64L21 9", 14), t("common.refresh"));
    refreshBtn.addEventListener("click", async () => {
      await loadConfig();
      window.OslerAdmin.navigate("deploy");
    });
    headerActions.appendChild(refreshBtn);
    header.appendChild(headerActions);
    wrap.appendChild(header);

    // Quick-deploy panel
    const panel = el("div", { class: "card", id: "deploy-panel", style: { marginBottom: "1rem" } });
    wrap.appendChild(panel);
    updateDeployPanel();

    // Progress
    const progress = el("div", { class: "deploy-progress", id: "deploy-progress" });
    wrap.appendChild(progress);

    // Provider cards — 2×2 grid
    const grid = el("div", { class: "deploy-grid" });
    for (const provider of PROVIDERS) {
      grid.appendChild(providerCard(provider));
    }
    wrap.appendChild(grid);

    // Console
    wrap.appendChild(el("div", { class: "label", style: { marginTop: "1rem" } }, t("deploy.console.title")));
    const consoleEl = el("div", { class: "deploy-console", id: "deploy-console" });
    wrap.appendChild(consoleEl);

    // Security note
    wrap.appendChild(el("div", { class: "card", style: { marginTop: "1rem", background: "var(--info-dim)", borderColor: "color-mix(in oklch, var(--info) 30%, transparent)" } },
      el("div", { style: { display: "flex", gap: "0.625rem", alignItems: "flex-start" } },
        el("div", { style: { color: "var(--info)", flexShrink: "0" } }, svgIcon("M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z", 18)),
        el("div", {},
          el("div", { style: { fontWeight: "600", color: "var(--info)", fontSize: "0.8125rem", marginBottom: "0.25rem" } }, t("deploy.security.title")),
          el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: "1.6" } }, t("deploy.security.body"))
        )
      )
    ));

    view.appendChild(wrap);

    // Initial render of progress + console (in case a deploy is already running)
    renderProgress();
    renderConsole();
    // If a deploy is in-flight, resume polling.
    invoke("deploy_status").then((status) => {
      if (status && status.running) startPolling();
    });
  };
})();
