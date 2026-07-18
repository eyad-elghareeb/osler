// components/log-console.js — Shared streaming log console.
//
// Replaces the duplicate renderLogs() helpers in build.js (line 39) and
// deploy.js (line 274). Both views polled different backends but rendered
// the exact same DOM — this component unifies them.
//
// Usage:
//   const console = OslerLogConsole.create({
//     id: "build-console",            // DOM id
//     emptyText: "No logs yet.",      // i18n string for empty state
//     pollFn: async () => status,     // returns { running, logs: [{ts, stream, text}], ... }
//     intervalMs: 600,                // poll interval
//     onStatus: (status) => {},       // optional status-change callback (for badges, etc.)
//   });
//   wrap.appendChild(console.el);
//   console.start();                  // begin polling
//   console.stop();                   // stop polling on view teardown
//   console.clear();                  // wipe the log area

(function () {
  "use strict";

  const { el, svgIcon, t } = window.OslerAdmin.helpers;

  function create(opts) {
    opts = opts || {};
    const id = opts.id || "log-console";
    const emptyText = opts.emptyText || "No logs yet.";
    const pollFn = opts.pollFn || (async () => null);
    const intervalMs = opts.intervalMs || 600;
    const onStatus = opts.onStatus || (() => {});

    const root = el("div", { class: "log-view", id: id });

    let timer = null;
    let lastRunning = null;

    function renderEmpty() {
      root.innerHTML = "";
      root.appendChild(el("div", { class: "empty-state", style: { padding: "2rem 1rem" } },
        el("div", { class: "empty-state-text" }, emptyText)
      ));
    }

    function renderLogs(status) {
      const wasAtBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 8;
      root.innerHTML = "";
      if (!status || !status.logs || status.logs.length === 0) {
        renderEmpty();
        return;
      }
      for (const line of status.logs) {
        const row = el("div", { class: "log-line" });
        const ts = line.ts ? new Date(line.ts).toLocaleTimeString() : "";
        row.appendChild(el("span", { class: "ts" }, ts));
        row.appendChild(el("span", { class: "stream-" + (line.stream || "stdout") }, line.text || ""));
        root.appendChild(row);
      }
      if (wasAtBottom) root.scrollTop = root.scrollHeight;
    }

    async function pollOnce() {
      try {
        const status = await pollFn();
        if (status) {
          renderLogs(status);
          onStatus(status);
          // Stop polling when the runner has gone idle (unless caller set keepPolling)
          if (status.running === false && timer && opts.stopWhenIdle !== false) {
            clearInterval(timer);
            timer = null;
          }
          lastRunning = status.running;
        }
      } catch (e) {
        // Swallow — the parent view's toast handler covers user-visible errors.
        console.warn("log-console poll failed:", e);
      }
    }

    function start() {
      if (timer) clearInterval(timer);
      timer = setInterval(pollOnce, intervalMs);
      pollOnce();
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function clear() {
      root.innerHTML = "";
      renderEmpty();
    }

    // Initial empty state
    renderEmpty();

    return { el: root, start, stop, clear, pollOnce };
  }

  window.OslerLogConsole = { create };
})();
