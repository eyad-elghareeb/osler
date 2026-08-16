// views/start.js — "Start" tab group (Overview + Setup wizard + New instance).
//
// This is a wrapper view that absorbs three old top-level nav items:
//   - dashboard.js  → Overview tab (status + first-run banner)
//   - wizard.js     → Setup wizard tab (auto-launched on first run)
//   - instance.js   → New instance tab (scaffold a fresh Osler project)
//
// The wrapper renders a tab bar at the top, then mounts the original view's
// render function inside a child container. The originals stay untouched
// (so they can still be invoked programmatically if needed).

(function () {
  "use strict";

  const { helpers } = window.OslerAdmin;
  const { el, svgIcon, t } = helpers;

  // Tab definitions — each `render` calls the original view's handler with
  // a fresh child container.
  const TABS = [
    { id: "overview",  label: "start.tab.overview",  render: renderOverview  },
    { id: "wizard",    label: "start.tab.wizard",    render: renderWizard    },
    { id: "instance",  label: "start.tab.instance",  render: renderInstance  },
  ];

  // Honour a hint set by external code (e.g. dashboard.js auto-launching the
  // wizard on first run does `window.__oslerStartTab = "wizard"`).
  function initialTab() {
    const hint = window.__oslerStartTab;
    if (hint && TABS.some((tab) => tab.id === hint)) {
      window.__oslerStartTab = null;
      return hint;
    }
    return "overview";
  }

  function renderOverview(host) {
    if (window.OslerAdminViews.dashboard) {
      window.OslerAdminViews.dashboard(host);
    } else {
      host.appendChild(el("div", { class: "empty-state" },
        el("div", { class: "empty-state-title" }, "Dashboard view missing")
      ));
    }
  }

  function renderWizard(host) {
    if (window.OslerAdminViews.wizard) {
      window.OslerAdminViews.wizard(host);
    }
  }

  function renderInstance(host) {
    if (window.OslerAdminViews.instance) {
      window.OslerAdminViews.instance(host);
    }
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
  window.OslerAdminViews.start = async function (view) {
    const wrap = el("div", { class: "view osler-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("start.title")),
        el("p", { class: "subtitle" }, t("start.subtitle"))
      )
    ));

    let active = initialTab();
    const bar = tabBar(active, (id) => {
      active = id;
      // Update active styling
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
