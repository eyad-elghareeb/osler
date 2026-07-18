// views/github.js — GitHub sign-in, repo browser, clone, fork, and the
// branch → PR → merge workflow that powers multi-user content management.
//
// Sections (shown/hidden based on auth state + active tab):
//   • Sign In card     — shown when not authenticated. Shows the OAuth client
//                        config + a "Sign in with GitHub" button.
//   • User card        — shown when authenticated. Shows avatar, login, scope.
//   • Tabs: Repos | Clone | Fork | Pull Requests | Content Session
//     – Repos: searchable list of the user's most recently updated repos.
//     – Clone: input a repo URL + target dir, runs `git clone`.
//     – Fork:  input owner/repo, forks it via the GitHub API.
//     – PRs:   list open PRs on the current project's repo with
//              Merge / Squash / Rebase / Close buttons.
//     – Content Session: wizard to start a new branch + commit + push + open PR.
//
// The Rust side (src/github.rs + extended src/commands.rs) does all the real
// work; this view just collects inputs and renders results.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  // ── State ────────────────────────────────────────────────────────────
  // The view re-renders on auth state changes and tab switches. We keep the
  // state at module scope so the OAuth polling loop (which calls refresh())
  // doesn't lose context across re-renders.
  const state = {
    auth: null,         // last GitHubAuthState from gh_auth_status
    oauthCfg: null,     // last gh_get_oauth_config result
    activeTab: "repos", // repos | clone | fork | prs | session
    repos: [],
    reposLoading: false,
    reposFilter: "",
    prs: [],
    prsLoading: false,
    busy: false,        // global busy flag for long-running actions
    oauthPollHandle: null,
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  function avatarImg(src, login, size) {
    if (!src) return el("div", { class: "brand-mark", style: { width: (size || 32) + "px", height: (size || 32) + "px" } }, login ? login[0].toUpperCase() : "?");
    const img = el("img", {
      src: src,
      alt: login || "avatar",
      width: size || 32,
      height: size || 32,
      style: { borderRadius: "50%", objectFit: "cover", flexShrink: "0" },
    });
    img.addEventListener("error", () => {
      img.replaceWith(el("div", { class: "brand-mark", style: { width: (size || 32) + "px", height: (size || 32) + "px" } }, login ? login[0].toUpperCase() : "?"));
    });
    return img;
  }

  function card(title, body) {
    const c = el("div", { class: "card", style: { padding: "1rem 1.25rem", marginBottom: "1rem" } });
    if (title) c.appendChild(el("div", { class: "label", style: { marginBottom: "0.5rem" } }, title));
    c.appendChild(body);
    return c;
  }

  function labeledInput(labelText, value, onChange, placeholder, opts) {
    const cell = el("div", {});
    cell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, labelText));
    const inp = el("input", Object.assign({ type: "text", class: "input", value: value, placeholder: placeholder || "" }, opts || {}));
    inp.addEventListener("input", () => onChange(inp.value));
    cell.appendChild(inp);
    return cell;
  }

  // ── Auth polling ─────────────────────────────────────────────────────
  // While an OAuth flow is pending, poll gh_auth_status every 1.5s. When
  // `authenticated` flips true, stop polling and reload everything.

  function startOAuthPoll() {
    stopOAuthPoll();
    state.oauthPollHandle = setInterval(async () => {
      try {
        const a = await invoke("gh_auth_status");
        state.auth = a;
        if (a && a.authenticated) {
          stopOAuthPoll();
          toast(t("gh.toast.signedIn", { user: a.login }), "success");
          window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
        } else if (a && a.oauthError) {
          stopOAuthPoll();
          toast(t("toast.error", { msg: a.oauthError }), "error");
          window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
        }
      } catch (e) {
        // ignore — keep polling
      }
    }, 1500);
  }

  function stopOAuthPoll() {
    if (state.oauthPollHandle) {
      clearInterval(state.oauthPollHandle);
      state.oauthPollHandle = null;
    }
  }

  // ── Render: Sign In card ─────────────────────────────────────────────

  function renderSignInCard() {
    const c = el("div", { class: "card", style: { padding: "1.5rem", marginBottom: "1rem" } });

    // Header row: GitHub mark + title + Sign In button
    const header = el("div", { style: { display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" } });
    const mark = el("div", {
      class: "brand-mark",
      style: { width: "44px", height: "44px", background: "var(--primary)", color: "var(--primary-foreground)" },
    });
    mark.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.8 1.7 2.6 1.2.1-.7.4-1.2.7-1.5-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.5-5.4 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" /></svg>';
    header.appendChild(mark);
    header.appendChild(el("div", { style: { flex: "1" } },
      el("div", { style: { fontWeight: "600", fontSize: "0.95rem" } }, t("gh.signIn.title")),
      el("div", { style: { fontSize: "0.8125rem", color: "var(--text-muted)" } }, t("gh.signIn.desc"))
    ));

    const signInBtn = el("button", { class: "btn btn-primary", type: "button" },
      el("span", { style: { display: "inline-flex", alignItems: "center", gap: "0.5rem" } },
        el("span", {}, "↗"),
        t("gh.signIn.button")
      )
    );
    signInBtn.addEventListener("click", async () => {
      try {
        signInBtn.disabled = true;
        signInBtn.textContent = t("gh.signIn.opening");
        await invoke("gh_sign_in");
        toast(t("gh.signIn.browserOpened"), "info");
        startOAuthPoll();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
        signInBtn.disabled = false;
        signInBtn.textContent = t("gh.signIn.button");
      }
    });
    header.appendChild(signInBtn);
    c.appendChild(header);

    // OAuth client_id config
    const cfg = state.oauthCfg || {};
    const cfgRow = el("div", { style: { display: "flex", gap: "0.5rem", alignItems: "end", flexWrap: "wrap", marginTop: "0.5rem" } });
    let clientIdVal = cfg.clientId || cfg.defaultClientId || "";
    const clientIdInput = labeledInput(t("gh.cfg.clientId"), clientIdVal, (v) => { clientIdVal = v; }, "Iv23xxxxxxxxxxxxxxxxxx");
    clientIdInput.style.flex = "1";
    clientIdInput.style.minWidth = "240px";
    cfgRow.appendChild(clientIdInput);

    let clientSecretVal = "";
    const clientSecretInput = labeledInput(t("gh.cfg.clientSecret"), "", (v) => { clientSecretVal = v; }, "•••••••• (optional — only for confidential OAuth apps)");
    clientSecretInput.style.flex = "1.5";
    clientSecretInput.style.minWidth = "280px";
    cfgRow.appendChild(clientSecretInput);

    const saveBtn = el("button", { class: "btn btn-sm", type: "button" }, t("common.save"));
    saveBtn.addEventListener("click", async () => {
      try {
        await invoke("gh_set_oauth_config", { clientId: clientIdVal, clientSecret: clientSecretVal || null });
        toast(t("gh.cfg.saved"), "success");
        const c2 = await invoke("gh_get_oauth_config");
        state.oauthCfg = c2;
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    cfgRow.appendChild(saveBtn);
    c.appendChild(cfgRow);

    c.appendChild(el("div", {
      style: { marginTop: "0.75rem", padding: "0.75rem", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: "1.5" },
      html: t("gh.cfg.help", { redirect: cfg.redirectUri || "http://localhost:7878/callback" }),
    }));

    // If a flow is pending, show a banner
    if (state.auth && state.auth.oauthPending) {
      c.appendChild(el("div", {
        style: { marginTop: "0.75rem", padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", background: "var(--primary-dim)", border: "1px solid color-mix(in oklch, var(--primary) 30%, transparent)", fontSize: "0.8125rem" },
      }, el("strong", {}, "⏳ " + t("gh.signIn.pending"))));
    }

    return c;
  }

  // ── Render: User info card ───────────────────────────────────────────

  function renderUserCard() {
    const a = state.auth;
    const c = el("div", { class: "card", style: { padding: "1rem 1.25rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.875rem", flexWrap: "wrap" } });
    c.appendChild(avatarImg(a.avatarUrl, a.login, 48));
    c.appendChild(el("div", { style: { flex: "1", minWidth: "180px" } },
      el("div", { style: { fontWeight: "600", fontSize: "0.95rem" } }, a.name || a.login),
      el("div", { style: { fontSize: "0.8125rem", color: "var(--text-muted)" } }, "@" + a.login + " · " + t("gh.user.tokenSource." + a.tokenSource))
    ));
    if (a.scopes && a.scopes.length > 0) {
      c.appendChild(el("div", { style: { display: "flex", gap: "0.25rem", flexWrap: "wrap" } },
        a.scopes.slice(0, 5).map((s) => el("span", { class: "badge accent", style: { fontSize: "0.6875rem" } }, s))
      ));
    }
    const signOutBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button" }, t("gh.user.signOut"));
    signOutBtn.addEventListener("click", async () => {
      try {
        await invoke("gh_sign_out");
        state.auth = null;
        state.repos = [];
        state.prs = [];
        toast(t("gh.toast.signedOut"), "info");
        window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    c.appendChild(signOutBtn);
    return c;
  }

  // ── Render: Tabs ─────────────────────────────────────────────────────

  function renderTabs() {
    const wrap = el("div", { style: { display: "flex", gap: "0.25rem", marginBottom: "1rem", borderBottom: "1px solid var(--border)", flexWrap: "wrap" } });
    const tabs = [
      { id: "repos",   label: t("gh.tab.repos") },
      { id: "clone",   label: t("gh.tab.clone") },
      { id: "fork",    label: t("gh.tab.fork") },
      { id: "prs",     label: t("gh.tab.prs") },
      { id: "session", label: t("gh.tab.session") },
    ];
    for (const tab of tabs) {
      const active = state.activeTab === tab.id;
      const btn = el("button", {
        type: "button",
        class: "btn btn-sm" + (active ? " btn-primary" : " btn-ghost"),
        style: {
          borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
          borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
          marginBottom: "-1px",
        },
      }, tab.label);
      btn.addEventListener("click", () => {
        state.activeTab = tab.id;
        window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
        // Lazy-load tab content
        if (tab.id === "repos" && state.repos.length === 0) loadRepos();
        if (tab.id === "prs") loadPRs();
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  // ── Tab: Repos ───────────────────────────────────────────────────────

  async function loadRepos() {
    if (state.reposLoading) return;
    state.reposLoading = true;
    window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
    try {
      const res = await invoke("gh_list_user_repos", { perPage: 50 });
      state.repos = res.repos || [];
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    } finally {
      state.reposLoading = false;
      window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
    }
  }

  function renderReposTab() {
    const wrap = el("div", {});

    // Filter input + refresh button
    const toolbar = el("div", { style: { display: "flex", gap: "0.5rem", marginBottom: "0.75rem" } });
    const filter = el("input", { type: "text", class: "input", placeholder: t("gh.repos.filter"), value: state.reposFilter });
    filter.style.flex = "1";
    filter.addEventListener("input", () => {
      state.reposFilter = filter.value;
      // Re-render the list without re-fetching
      const listEl = document.getElementById("gh-repos-list");
      if (listEl) {
        listEl.innerHTML = "";
        listEl.appendChild(renderRepoList());
      }
    });
    toolbar.appendChild(filter);
    const refreshBtn = el("button", { class: "btn btn-sm", type: "button" }, t("common.refresh"));
    refreshBtn.addEventListener("click", loadRepos);
    toolbar.appendChild(refreshBtn);
    wrap.appendChild(toolbar);

    const listWrap = el("div", { id: "gh-repos-list" });
    listWrap.appendChild(renderRepoList());
    wrap.appendChild(listWrap);
    return wrap;
  }

  function renderRepoList() {
    if (state.reposLoading) {
      return el("div", { class: "empty-state" }, el("div", { class: "empty-state-text" }, t("common.loading")));
    }
    const filter = (state.reposFilter || "").toLowerCase();
    const filtered = state.repos.filter((r) =>
      !filter || (r.fullName || "").toLowerCase().includes(filter) || (r.description || "").toLowerCase().includes(filter)
    );
    if (filtered.length === 0) {
      return el("div", { class: "empty-state", style: { padding: "1.5rem" } },
        el("div", { class: "empty-state-text" }, state.repos.length === 0 ? t("gh.repos.empty") : t("gh.repos.noMatch"))
      );
    }
    const grid = el("div", { class: "grid grid-2" });
    for (const r of filtered) {
      const cell = el("div", { class: "card", style: { padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.4rem" } });
      const head = el("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
        el("span", { style: { fontSize: "0.875rem", fontWeight: "600" } }, r.fullName),
        r.private ? el("span", { class: "badge danger", style: { fontSize: "0.6875rem" } }, t("gh.repo.private")) : null,
        r.fork ? el("span", { class: "badge", style: { fontSize: "0.6875rem" } }, t("gh.repo.fork")) : null
      );
      cell.appendChild(head);
      if (r.description) {
        cell.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: "1.4" } }, r.description));
      }
      cell.appendChild(el("div", { style: { fontSize: "0.6875rem", color: "var(--text-muted)", display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.25rem" } },
        el("span", {}, "⌥ " + (r.defaultBranch || "main")),
        el("span", {}, "◷ " + (r.updatedAt || "").slice(0, 10))
      ));
      const actions = el("div", { style: { display: "flex", gap: "0.375rem", marginTop: "0.25rem" } });
      const cloneBtn = el("button", { class: "btn btn-sm btn-ghost", type: "button" }, t("gh.repo.clone"));
      cloneBtn.addEventListener("click", () => {
        state.activeTab = "clone";
        // Pre-fill the clone form
        window.__oslerGhClonePreset = r.cloneUrl || ("https://github.com/" + r.fullName + ".git");
        window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
      });
      actions.appendChild(cloneBtn);
      const openBtn = el("button", { class: "btn btn-sm btn-ghost", type: "button" }, t("gh.repo.open"));
      openBtn.addEventListener("click", () => {
        invoke("open_external", { url: r.htmlUrl }).catch((e) => toast(t("toast.error", { msg: String(e) }), "error"));
      });
      actions.appendChild(openBtn);
      cell.appendChild(actions);
      grid.appendChild(cell);
    }
    return grid;
  }

  // ── Tab: Clone ───────────────────────────────────────────────────────

  function renderCloneTab() {
    const wrap = el("div", {});
    const c = el("div", { class: "card", style: { padding: "1.25rem" } });
    c.appendChild(el("div", { class: "label", style: { marginBottom: "0.5rem" } }, t("gh.clone.title")));
    c.appendChild(el("p", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "0.75rem" } }, t("gh.clone.desc")));

    let url = window.__oslerGhClonePreset || "";
    let targetDir = "";
    const urlInput = labeledInput(t("gh.clone.url"), url, (v) => { url = v; }, "https://github.com/owner/repo.git");
    c.appendChild(urlInput);
    c.appendChild(el("div", { style: { height: "0.5rem" } }));

    const dirRow = el("div", { style: { display: "flex", gap: "0.5rem", alignItems: "end" } });
    const targetInput = labeledInput(t("gh.clone.target"), targetDir, (v) => { targetDir = v; }, "/path/to/new-folder");
    targetInput.style.flex = "1";
    dirRow.appendChild(targetInput);
    const browseBtn = el("button", { class: "btn btn-sm", type: "button" }, t("instance.browse"));
    browseBtn.addEventListener("click", async () => {
      try {
        const folder = await invoke("plugin:dialog|open", {
          options: { directory: true, title: t("gh.clone.pickDir"), multiple: false },
        });
        const p = typeof folder === "string" ? folder : null;
        if (p) {
          targetDir = p;
          targetInput.querySelector("input").value = p;
        }
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      }
    });
    dirRow.appendChild(browseBtn);
    c.appendChild(dirRow);
    c.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" } }, t("gh.clone.hint")));

    const cloneBtn = el("button", { class: "btn btn-primary", type: "button", style: { marginTop: "0.875rem" } }, t("gh.clone.button"));
    cloneBtn.addEventListener("click", async () => {
      if (!url.trim()) { toast(t("gh.clone.err.noUrl"), "error"); return; }
      if (!targetDir.trim()) { toast(t("gh.clone.err.noDir"), "error"); return; }
      state.busy = true;
      cloneBtn.disabled = true;
      cloneBtn.textContent = t("gh.clone.cloning");
      try {
        const res = await invoke("git_clone", { url: url.trim(), targetDir: targetDir.trim() });
        toast(t("gh.clone.done", { dir: res.targetDir }), "success");
        // Show next-steps panel
        const result = el("div", { class: "card", style: { padding: "1rem 1.25rem", marginTop: "0.75rem", background: "var(--success-dim)", border: "1px solid color-mix(in oklch, var(--success) 40%, transparent)" } },
          el("div", { style: { fontWeight: "600", marginBottom: "0.5rem" } }, "✓ " + t("gh.clone.success")),
          el("div", { style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem", marginBottom: "0.5rem" } }, res.targetDir),
          el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem" } }, t("gh.clone.branch") + ": " + (res.branch || "main") + "  ·  " + t("gh.clone.remote") + ": " + (res.remote || url.trim()))
        );
        const actions = el("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap" } });
        const openBtn = el("button", { class: "btn btn-sm", type: "button" }, t("instance.result.openDir"));
        openBtn.addEventListener("click", () => invoke("open_external", { url: res.targetDir }).catch(() => {}));
        actions.appendChild(openBtn);
        const switchBtn = el("button", { class: "btn btn-sm btn-primary", type: "button" }, t("instance.result.switchProject"));
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
        result.appendChild(actions);
        // Replace any existing result panel
        const existing = document.getElementById("gh-clone-result");
        if (existing) existing.remove();
        result.id = "gh-clone-result";
        c.appendChild(result);
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        state.busy = false;
        cloneBtn.disabled = false;
        cloneBtn.textContent = t("gh.clone.button");
      }
    });
    c.appendChild(cloneBtn);
    wrap.appendChild(c);
    // Clear the preset so re-rendering doesn't keep overriding the input
    window.__oslerGhClonePreset = null;
    return wrap;
  }

  // ── Tab: Fork ────────────────────────────────────────────────────────

  function renderForkTab() {
    const wrap = el("div", {});
    const c = el("div", { class: "card", style: { padding: "1.25rem" } });
    c.appendChild(el("div", { class: "label", style: { marginBottom: "0.5rem" } }, t("gh.fork.title")));
    c.appendChild(el("p", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "0.75rem" } }, t("gh.fork.desc")));

    let owner = "", repo = "";
    const grid = el("div", { class: "grid grid-2", style: { marginBottom: "0.75rem" } });
    grid.appendChild(labeledInput(t("gh.fork.owner"), owner, (v) => { owner = v; }, "eyad-elghareeb"));
    grid.appendChild(labeledInput(t("gh.fork.repo"), repo, (v) => { repo = v; }, "osler"));
    c.appendChild(grid);

    const forkBtn = el("button", { class: "btn btn-primary", type: "button" }, t("gh.fork.button"));
    forkBtn.addEventListener("click", async () => {
      if (!owner.trim() || !repo.trim()) { toast(t("gh.fork.err.noRepo"), "error"); return; }
      state.busy = true;
      forkBtn.disabled = true;
      forkBtn.textContent = t("gh.fork.forking");
      try {
        const res = await invoke("gh_fork_repo", { owner: owner.trim(), repo: repo.trim() });
        if (res.pending) {
          toast(t("gh.fork.pending", { full: res.fullName }), "info");
        } else {
          toast(t("gh.fork.done", { full: res.fullName }), "success");
        }
        const result = el("div", { class: "card", style: { padding: "1rem 1.25rem", marginTop: "0.75rem", background: "var(--success-dim)", border: "1px solid color-mix(in oklch, var(--success) 40%, transparent)" } },
          el("div", { style: { fontWeight: "600", marginBottom: "0.5rem" } }, "✓ " + (res.pending ? t("gh.fork.queued") : t("gh.fork.success"))),
          el("div", { style: { fontFamily: "var(--font-mono)", fontSize: "0.8125rem", marginBottom: "0.5rem" } }, res.fullName),
          res.htmlUrl ? el("a", { href: res.htmlUrl, target: "_blank", rel: "noopener", style: { fontSize: "0.8125rem" } }, res.htmlUrl) : null
        );
        const actions = el("div", { style: { display: "flex", gap: "0.5rem", marginTop: "0.5rem" } });
        const cloneBtn = el("button", { class: "btn btn-sm", type: "button" }, t("gh.repo.clone"));
        cloneBtn.addEventListener("click", () => {
          state.activeTab = "clone";
          window.__oslerGhClonePreset = res.cloneUrl || ("https://github.com/" + res.fullName + ".git");
          window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
        });
        actions.appendChild(cloneBtn);
        result.appendChild(actions);
        const existing = document.getElementById("gh-fork-result");
        if (existing) existing.remove();
        result.id = "gh-fork-result";
        c.appendChild(result);
      } catch (e) {
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        state.busy = false;
        forkBtn.disabled = false;
        forkBtn.textContent = t("gh.fork.button");
      }
    });
    c.appendChild(forkBtn);
    wrap.appendChild(c);
    return wrap;
  }

  // ── Tab: PRs ─────────────────────────────────────────────────────────

  async function loadPRs() {
    if (state.prsLoading) return;
    state.prsLoading = true;
    window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
    try {
      // Determine owner/repo from the current project's origin remote.
      const ident = await invoke("git_repo_identity");
      if (!ident.owner || !ident.repo) {
        toast(t("gh.prs.noRemote"), "error");
        state.prs = [];
      } else {
        const res = await invoke("gh_list_prs", { owner: ident.owner, repo: ident.repo, prState: "open" });
        state.prs = res.prs || [];
      }
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    } finally {
      state.prsLoading = false;
      window.OslerAdminViews._githubRerender && window.OslerAdminViews._githubRerender();
    }
  }

  function renderPRsTab() {
    const wrap = el("div", {});

    // Toolbar: owner/repo from project + refresh
    const toolbar = el("div", { style: { display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" } });
    toolbar.appendChild(el("div", { style: { fontSize: "0.8125rem", color: "var(--text-muted)" } },
      window.OslerAdmin.projectState && window.OslerAdmin.projectState.gitRemote
        ? t("gh.prs.for") + ": " + window.OslerAdmin.projectState.gitRemote
        : t("gh.prs.noProject")
    ));
    const refreshBtn = el("button", { class: "btn btn-sm", type: "button" }, t("common.refresh"));
    refreshBtn.addEventListener("click", loadPRs);
    toolbar.appendChild(refreshBtn);
    wrap.appendChild(toolbar);

    if (state.prsLoading) {
      wrap.appendChild(el("div", { class: "empty-state" }, el("div", { class: "empty-state-text" }, t("common.loading"))));
      return wrap;
    }

    if (state.prs.length === 0) {
      wrap.appendChild(el("div", { class: "empty-state", style: { padding: "1.5rem" } },
        el("div", { class: "empty-state-text" }, t("gh.prs.empty"))
      ));
      return wrap;
    }

    for (const pr of state.prs) {
      const c = el("div", { class: "card", style: { padding: "1rem 1.25rem", marginBottom: "0.75rem" } });
      const head = el("div", { style: { display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.4rem" } });
      head.appendChild(el("span", { class: "badge accent", style: { fontSize: "0.6875rem" } }, "#" + pr.number));
      if (pr.draft) head.appendChild(el("span", { class: "badge", style: { fontSize: "0.6875rem" } }, t("gh.pr.draft")));
      head.appendChild(el("a", { href: pr.htmlUrl, target: "_blank", rel: "noopener", style: { fontWeight: "600", fontSize: "0.95rem" } }, pr.title));
      c.appendChild(head);

      c.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" } },
        "@" + (pr.user || "—") + " · " +
        (pr.headRepo || "?") + ":" + (pr.head || "?") + " → " +
        (pr.baseRepo || "?") + ":" + (pr.base || "?")
      ));

      if (pr.body) {
        const body = el("div", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "0.5rem", maxHeight: "6em", overflow: "hidden", whiteSpace: "pre-wrap" } }, pr.body);
        c.appendChild(body);
      }

      // Action buttons: Merge / Squash / Rebase / Close
      const actions = el("div", { style: { display: "flex", gap: "0.375rem", flexWrap: "wrap" } });

      const mergeBtn = el("button", { class: "btn btn-sm btn-primary", type: "button" }, t("gh.pr.merge"));
      mergeBtn.addEventListener("click", () => doMerge(pr, "merge"));
      actions.appendChild(mergeBtn);

      const squashBtn = el("button", { class: "btn btn-sm", type: "button" }, t("gh.pr.squash"));
      squashBtn.addEventListener("click", () => doMerge(pr, "squash"));
      actions.appendChild(squashBtn);

      const rebaseBtn = el("button", { class: "btn btn-sm", type: "button" }, t("gh.pr.rebase"));
      rebaseBtn.addEventListener("click", () => doMerge(pr, "rebase"));
      actions.appendChild(rebaseBtn);

      const closeBtn = el("button", { class: "btn btn-sm btn-ghost", type: "button" }, t("gh.pr.close"));
      closeBtn.addEventListener("click", () => doClose(pr));
      actions.appendChild(closeBtn);

      c.appendChild(actions);
      wrap.appendChild(c);
    }
    return wrap;
  }

  async function doMerge(pr, method) {
    const ident = await invoke("git_repo_identity").catch(() => null);
    if (!ident || !ident.owner || !ident.repo) {
      toast(t("gh.prs.noRemote"), "error");
      return;
    }
    const msg = window.prompt(t("gh.pr.mergePrompt", { method: method, title: pr.title }), t("gh.pr.mergeDefault", { title: pr.title, n: pr.number }));
    if (msg === null) return; // cancelled
    try {
      const res = await invoke("gh_merge_pr", {
        owner: ident.owner,
        repo: ident.repo,
        prNumber: pr.number,
        method: method,
        commitMessage: msg,
      });
      if (res.merged) {
        toast(t("gh.pr.merged", { n: pr.number }), "success");
        loadPRs();
      } else {
        toast(t("gh.pr.mergeFailed", { msg: res.message || "?" }), "error");
      }
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function doClose(pr) {
    const ident = await invoke("git_repo_identity").catch(() => null);
    if (!ident || !ident.owner || !ident.repo) {
      toast(t("gh.prs.noRemote"), "error");
      return;
    }
    if (!window.confirm(t("gh.pr.closeConfirm", { n: pr.number }))) return;
    try {
      await invoke("gh_close_pr", { owner: ident.owner, repo: ident.repo, prNumber: pr.number });
      toast(t("gh.pr.closed", { n: pr.number }), "info");
      loadPRs();
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  // ── Tab: Content Session (wizard) ────────────────────────────────────
  // User picks base branch + types new branch name + optional PR title.
  // Then makes content edits elsewhere in the app, comes back here to
  // commit + push + open PR.

  function renderSessionTab() {
    const wrap = el("div", {});

    if (!requireProject()) {
      wrap.appendChild(el("div", { class: "empty-state", style: { padding: "1.5rem" } },
        el("div", { class: "empty-state-text" }, t("gh.session.noProject"))
      ));
      return wrap;
    }

    const c = el("div", { class: "card", style: { padding: "1.25rem" } });
    c.appendChild(el("div", { class: "label", style: { marginBottom: "0.4rem" } }, t("gh.session.title")));
    c.appendChild(el("p", { style: { fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "0.75rem" } }, t("gh.session.desc")));

    // State for the wizard
    let baseBranch = "main";
    let newBranch = "";
    let prTitle = "";
    let prBody = "";

    // Base branch selector (populated from git_list_branches)
    const baseCell = el("div", {});
    baseCell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, t("gh.session.base")));
    const baseSel = el("select", { class: "input" });
    baseSel.appendChild(el("option", { value: "main" }, "main"));
    baseSel.addEventListener("change", () => { baseBranch = baseSel.value; });
    baseCell.appendChild(baseSel);
    c.appendChild(baseCell);

    // Load branches async and populate the selector
    invoke("git_list_branches").then((res) => {
      const branches = (res.branches || []).filter((b) => !b.remote);
      const current = res.current || "main";
      // Clear default
      baseSel.innerHTML = "";
      for (const b of branches) {
        const opt = el("option", { value: b.name }, b.name + (b.current ? " (" + t("gh.session.current") + ")" : ""));
        if (b.current) opt.selected = true;
        baseSel.appendChild(opt);
      }
      if (branches.length === 0) {
        baseSel.appendChild(el("option", { value: "main" }, "main"));
      }
      baseBranch = baseSel.value;
      // Suggest a branch name based on the base
      if (!newBranch) {
        newBranch = "content/" + new Date().toISOString().slice(0, 10) + "-" + Math.random().toString(36).slice(2, 6);
        newBranchInput.value = newBranch;
      }
    }).catch(() => {});

    c.appendChild(el("div", { style: { height: "0.6rem" } }));

    const newBranchInput = labeledInput(t("gh.session.newBranch"), newBranch, (v) => { newBranch = v; }, "content/add-cardiology-quiz");
    c.appendChild(newBranchInput);
    c.appendChild(el("div", { style: { fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem", marginBottom: "0.6rem" } }, t("gh.session.branchHint")));

    const prTitleInput = labeledInput(t("gh.session.prTitle"), prTitle, (v) => { prTitle = v; }, t("gh.session.prTitlePh"));
    c.appendChild(prTitleInput);
    c.appendChild(el("div", { style: { height: "0.6rem" } }));

    // PR body (textarea)
    const bodyCell = el("div", {});
    bodyCell.appendChild(el("div", { style: { fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-muted)", marginBottom: "0.25rem" } }, t("gh.session.prBody")));
    const bodyTa = el("textarea", { class: "input", rows: "4", placeholder: t("gh.session.prBodyPh") });
    bodyTa.style.fontFamily = "inherit";
    bodyTa.addEventListener("input", () => { prBody = bodyTa.value; });
    bodyCell.appendChild(bodyTa);
    c.appendChild(bodyCell);

    // Step 1: Create branch button
    const step1Row = el("div", { style: { marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" } });
    const step1Btn = el("button", { class: "btn btn-primary", type: "button" }, t("gh.session.step1"));
    const step1Status = el("span", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } });
    step1Btn.addEventListener("click", async () => {
      if (!newBranch.trim()) { toast(t("gh.session.err.noBranch"), "error"); return; }
      try {
        step1Btn.disabled = true;
        const res = await invoke("git_create_branch", { name: newBranch.trim(), base: baseBranch });
        step1Status.textContent = "✓ " + t("gh.session.step1Done", { branch: res.branch, base: res.base });
        toast(t("gh.session.step1Done", { branch: res.branch, base: res.base }), "success");
      } catch (e) {
        step1Status.textContent = "✗ " + String(e);
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        step1Btn.disabled = false;
      }
    });
    step1Row.appendChild(step1Btn);
    step1Row.appendChild(step1Status);
    c.appendChild(step1Row);

    // Step 2: Commit changes button (stages public/osler-content + commits)
    const step2Row = el("div", { style: { marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" } });
    const step2Btn = el("button", { class: "btn", type: "button" }, t("gh.session.step2"));
    const step2Status = el("span", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } });
    step2Btn.addEventListener("click", async () => {
      try {
        step2Btn.disabled = true;
        const msg = prTitle.trim() || t("gh.session.defaultCommit");
        const res = await invoke("git_commit", { message: msg });
        step2Status.textContent = "✓ " + t("gh.session.step2Done");
        toast(t("git.commitDone", { message: msg }), "success");
      } catch (e) {
        step2Status.textContent = "✗ " + String(e);
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        step2Btn.disabled = false;
      }
    });
    step2Row.appendChild(step2Btn);
    step2Row.appendChild(step2Status);
    c.appendChild(step2Row);

    // Step 3: Push branch (with auto-fork fallback)
    const step3Row = el("div", { style: { marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" } });
    const step3Btn = el("button", { class: "btn btn-accent", type: "button" }, t("gh.session.step3"));
    const step3Status = el("span", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } });
    step3Btn.addEventListener("click", async () => {
      try {
        step3Btn.disabled = true;
        step3Status.textContent = t("gh.session.pushing");
        await invoke("git_push_branch", { branch: newBranch.trim(), remote: "origin" });
        step3Status.textContent = "✓ " + t("gh.session.step3Done");
        toast(t("gh.session.step3Done"), "success");
      } catch (e) {
        // If push failed because of permission, try the auto-fork flow.
        const msg = String(e);
        if (/403|denied|permission|forbidden/i.test(msg)) {
          step3Status.textContent = t("gh.session.forking");
          toast(t("gh.session.noWriteAccess"), "info");
          try {
            await autoForkAndPush(newBranch.trim());
            step3Status.textContent = "✓ " + t("gh.session.forkedAndPushed");
          } catch (e2) {
            step3Status.textContent = "✗ " + String(e2);
            toast(t("toast.error", { msg: String(e2) }), "error");
          }
        } else {
          step3Status.textContent = "✗ " + msg;
          toast(t("toast.error", { msg: msg }), "error");
        }
      } finally {
        step3Btn.disabled = false;
      }
    });
    step3Row.appendChild(step3Btn);
    step3Row.appendChild(step3Status);
    c.appendChild(step3Row);

    // Step 4: Open PR
    const step4Row = el("div", { style: { marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" } });
    const step4Btn = el("button", { class: "btn btn-primary", type: "button" }, t("gh.session.step4"));
    const step4Status = el("span", { style: { fontSize: "0.75rem", color: "var(--text-muted)" } });
    step4Btn.addEventListener("click", async () => {
      try {
        step4Btn.disabled = true;
        const ident = await invoke("git_repo_identity");
        if (!ident.owner || !ident.repo) { toast(t("gh.prs.noRemote"), "error"); return; }
        // Determine head: if a fork was used, head = "<user>:<branch>"; else just the branch name.
        const head = state.forkUser ? (state.forkUser + ":" + newBranch.trim()) : newBranch.trim();
        const res = await invoke("gh_create_pr", {
          owner: ident.owner,
          repo: ident.repo,
          title: prTitle.trim() || t("gh.session.defaultPrTitle", { branch: newBranch.trim() }),
          head: head,
          base: baseBranch,
          body: prBody || null,
        });
        step4Status.innerHTML = '✓ <a href="' + escapeHtml(pr.htmlUrl || res.htmlUrl) + '" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline;">#' + res.number + '</a>';
        toast(t("gh.session.prOpened", { n: res.number }), "success");
      } catch (e) {
        step4Status.textContent = "✗ " + String(e);
        toast(t("toast.error", { msg: String(e) }), "error");
      } finally {
        step4Btn.disabled = false;
      }
    });
    step4Row.appendChild(step4Btn);
    step4Row.appendChild(step4Status);
    c.appendChild(step4Row);

    wrap.appendChild(c);

    // Helper: auto-fork + add remote + push to fork
    async function autoForkAndPush(branch) {
      const ident = await invoke("git_repo_identity");
      if (!ident.owner || !ident.repo) throw new Error("No GitHub remote on the current project");
      // Fork the upstream repo
      const fork = await invoke("gh_fork_repo", { owner: ident.owner, repo: ident.repo });
      // Wait for fork to materialise if pending
      if (fork.pending) {
        // Poll up to ~30s
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const info = await invoke("gh_get_repo_info", { owner: fork.fullName.split("/")[0], repo: fork.fullName.split("/")[1] });
            if (info && info.fullName) { state.forkUser = info.owner; break; }
          } catch {}
        }
      } else {
        state.forkUser = fork.fullName.split("/")[0];
      }
      if (!state.forkUser) throw new Error("Fork did not materialise in time");
      // Add fork as a remote named "fork"
      try {
        await invoke("git_add_remote", { name: "fork", url: "https://github.com/" + fork.fullName + ".git" });
      } catch (e) {
        // Remote may already exist — try to update its URL
        // (we don't have a set-url command; if it exists the user can fix manually)
      }
      // Push the branch to the fork
      await invoke("git_push_branch", { branch: branch, remote: "fork" });
    }

    return wrap;
  }

  // ── View entry point ─────────────────────────────────────────────────

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.github = async function (view) {
    // Honor a "open on tab X" hint from another view (e.g. the Git view's
    // "Start content session" button sets window.__oslerGhTab = "session").
    if (window.__oslerGhTab) {
      state.activeTab = window.__oslerGhTab;
      window.__oslerGhTab = null;
    }
    // Render the outer shell once, then populate via rerender()
    const shell = el("div", { class: "view medos-fade-in" });
    const header = el("div", { class: "view-header" });
    header.appendChild(el("div", {},
      el("h1", {}, t("gh.title")),
      el("p", { class: "subtitle" }, t("gh.subtitle"))
    ));
    shell.appendChild(header);

    const body = el("div", { id: "gh-body" });
    shell.appendChild(body);
    view.appendChild(shell);

    // The rerender function: rebuilds the body from current state.
    window.OslerAdminViews._githubRerender = function () {
      body.innerHTML = "";
      body.className = "";
      // Always show sign-in or user card first
      if (state.auth && state.auth.authenticated) {
        body.appendChild(renderUserCard());
        body.appendChild(renderTabs());
        if (state.activeTab === "repos") body.appendChild(renderReposTab());
        else if (state.activeTab === "clone") body.appendChild(renderCloneTab());
        else if (state.activeTab === "fork") body.appendChild(renderForkTab());
        else if (state.activeTab === "prs") body.appendChild(renderPRsTab());
        else if (state.activeTab === "session") body.appendChild(renderSessionTab());
      } else {
        body.appendChild(renderSignInCard());
        // Even when not signed in, show the clone tab (clone works without auth
        // for public repos — git clone doesn't need a token).
        body.appendChild(renderTabs());
        if (state.activeTab === "clone") body.appendChild(renderCloneTab());
        else body.appendChild(el("div", { class: "empty-state", style: { padding: "1.5rem" } },
          el("div", { class: "empty-state-text" }, t("gh.signIn.required"))
        ));
      }
    };

    // Initial load: fetch OAuth config + auth status
    try {
      state.oauthCfg = await invoke("gh_get_oauth_config");
    } catch (e) {
      state.oauthCfg = { clientId: "", redirectUri: "http://localhost:7878/callback" };
    }
    try {
      state.auth = await invoke("gh_auth_status");
      // If a flow was pending when we navigated away, resume polling
      if (state.auth && state.auth.oauthPending) startOAuthPoll();
    } catch (e) {
      state.auth = null;
    }

    window.OslerAdminViews._githubRerender();

    // Auto-load repos if signed in and on the repos tab
    if (state.auth && state.auth.authenticated && state.activeTab === "repos") {
      loadRepos();
    }
  };

  // Clean up the OAuth poll when navigating away — the view's body is
  // replaced wholesale by the router, so we hook into the next render.
  // (The router doesn't expose a teardown hook, so we rely on the next view's
  // boot to clear the interval via the global state. The poll is bounded by
  // the OAuth server's 5-minute timeout, so even if we miss cleanup it's
  // harmless.)
})();
