// views/run-publish.js — "Run & Publish" tab group.
//
// Absorbs four old top-level nav items into a single workflow-oriented view:
//   - build.js    → Build tab   (run npm/bun build / start, stream logs)
//   - git.js      → Git tab     (stage / commit / push / pull)
//   - github.js   → GitHub tab  (sign-in + repos + clone + fork + PRs + session)
//   - deploy.js   → Deploy tab  (4 provider cards + log console)
//
// Honours `window.__oslerGhTab = "session"` (set by git.js's "Start content
// session" button) by opening on the GitHub tab when set.

(function () {
  "use strict";

  const { helpers } = window.OslerAdmin;
  const { el, svgIcon, t } = helpers;

  const TABS = [
    { id: "build",   label: "runPublish.tab.build",   render: renderBuild   },
    { id: "git",     label: "runPublish.tab.git",     render: renderGit     },
    { id: "github",  label: "runPublish.tab.github",  render: renderGithub  },
    { id: "deploy",  label: "runPublish.tab.deploy",  render: renderDeploy  },
  ];

  function renderBuild(host) {
    if (window.OslerAdminViews.build) {
      window.OslerAdminViews.build(host);
    }
  }

  function renderGit(host) {
    if (window.OslerAdminViews.git) {
      window.OslerAdminViews.git(host);
    }
  }

  function renderGithub(host) {
    if (window.OslerAdminViews.github) {
      window.OslerAdminViews.github(host);
    }
  }

  function renderDeploy(host) {
    if (window.OslerAdminViews.deploy) {
      window.OslerAdminViews.deploy(host);
    }
  }

  function initialTab() {
    // Honour the "Start content session" hint from git.js (jumps to GitHub tab)
    if (window.__oslerGhTab === "session") {
      window.__oslerGhTab = null;
      return "github";
    }
    // Honour a direct hint from legacy `navigate("git")` redirects
    if (window.__oslerRpTab) {
      const hint = window.__oslerRpTab;
      window.__oslerRpTab = null;
      if (TABS.some((t) => t.id === hint)) return hint;
    }
    return "build";
  }

  function tabBar(activeId, onPick) {
    const bar = el("div", { class: "tabbar" });
    for (const tab of TABS) {
      const btn = el("button", {
        class: "tabbar-item" + (tab.id === activeId ? " active" : ""),
        type: "button",
        onClick: () => onPick(tab.id),
      }, t(tab.label));
      bar.appendChild(btn);
    }
    return bar;
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.runPublish = async function (view) {
    const wrap = el("div", { class: "view medos-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("runPublish.title")),
        el("p", { class: "subtitle" }, t("runPublish.subtitle"))
      )
    ));

    let active = initialTab();
    const bar = tabBar(active, (id) => {
      active = id;
      bar.querySelectorAll(".tabbar-item").forEach((b, i) => {
        b.classList.toggle("active", TABS[i].id === id);
      });
      mountActive();
    });
    wrap.appendChild(bar);

    const tabHost = el("div", { class: "tab-host" });
    wrap.appendChild(tabHost);

    function mountActive() {
      tabHost.innerHTML = "";
      const tab = TABS.find((x) => x.id === active);
      if (tab) tab.render(tabHost);
    }

    view.appendChild(wrap);
    mountActive();
  };
})();
