// views/configure.js — "Configure" tab group (config editor + app settings).
//
// Absorbs two old top-level nav items:
//   - config.js    → 5 tabs (Site / Engines / Themes / Defaults / Raw JSON)
//   - settings.js  → 1 tab (App settings: language, theme, project root)
//
// The original config.js already has its own internal tab bar (Site/Engines/
// Themes/Defaults/Raw), so we don't want to nest two tab bars. Instead we
// mount config.js in one of our outer tabs, and settings.js in another.
// Result: a single 2-tab wrapper around the two originals.

(function () {
  "use strict";

  const { helpers } = window.OslerAdmin;
  const { el, svgIcon, t } = helpers;

  const TABS = [
    { id: "config",   label: "configure.tab.config",   render: renderConfig   },
    { id: "settings", label: "configure.tab.settings", render: renderSettings },
  ];

  function renderConfig(host) {
    if (window.OslerAdminViews.config) {
      window.OslerAdminViews.config(host);
    }
  }

  function renderSettings(host) {
    if (window.OslerAdminViews.settings) {
      window.OslerAdminViews.settings(host);
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
  window.OslerAdminViews.configure = async function (view) {
    const wrap = el("div", { class: "view osler-fade-in" });
    wrap.appendChild(el("div", { class: "view-header" },
      el("div", {},
        el("h1", {}, t("configure.title")),
        el("p", { class: "subtitle" }, t("configure.subtitle"))
      )
    ));

    let active = "config";
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
