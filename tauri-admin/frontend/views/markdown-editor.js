// views/markdown-editor.js — EasyMDE wrapper for editing markdown files.
//
// Loads EasyMDE from the jsDelivr CDN on first use. Supports RTL, slash
// command palette, table rendering, and the full EasyMDE toolbar.
//
// Font Awesome is loaded statically from index.html so toolbar icons are
// immediately available.
//
// API:
//   const editor = await OslerMarkdownEditor.create(hostElement, initialMarkdown, opts);
//   const md = editor.getMarkdown();      // string (synchronous)
//   editor.destroy();

(function () {
  "use strict";

  const EASYMDE_VERSION = "2.18.0";
  const EASYMDE_CSS = `https://cdn.jsdelivr.net/npm/easymde@${EASYMDE_VERSION}/dist/easymde.min.css`;
  const EASYMDE_JS = `https://cdn.jsdelivr.net/npm/easymde@${EASYMDE_VERSION}/dist/easymde.min.js`;

  let cssLoaded = false;
  let scriptPromise = null;

  function ensureCss() {
    if (cssLoaded) return;
    if (document.querySelector(`link[href="${EASYMDE_CSS}"]`)) { cssLoaded = true; return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = EASYMDE_CSS;
    document.head.appendChild(link);
    cssLoaded = true;
  }

  function loadScript() {
    if (!scriptPromise) {
      scriptPromise = new Promise((resolve, reject) => {
        if (typeof window.EasyMDE === "function") { resolve(window.EasyMDE); return; }
        const script = document.createElement("script");
        script.src = EASYMDE_JS;
        script.async = true;
        script.onload = () => {
          if (typeof window.EasyMDE === "function") { resolve(window.EasyMDE); }
          else { reject(new Error("EasyMDE failed to load: global not found")); }
        };
        script.onerror = () => reject(new Error("Failed to load EasyMDE script from CDN"));
        document.head.appendChild(script);
      });
    }
    return scriptPromise;
  }

  /* ── Slash command palette ─────────────────────────────── */

  let activeSlash = null;

  function buildSlashPalette(onPick) {
    const CMD_GROUPS = [
      {
        name: "Format",
        items: [
          { icon: "fas fa-heading", label: "Heading 1", insert: "# " },
          { icon: "fas fa-heading", label: "Heading 2", insert: "## " },
          { icon: "fas fa-heading", label: "Heading 3", insert: "### " },
        ],
      },
      {
        name: "Style",
        items: [
          { icon: "fas fa-bold", label: "Bold", insert: "****", cursorOffset: -2 },
          { icon: "fas fa-italic", label: "Italic", insert: "**", cursorOffset: -1 },
          { icon: "fas fa-strikethrough", label: "Strikethrough", insert: "~~~~", cursorOffset: -2 },
        ],
      },
      {
        name: "Block",
        items: [
          { icon: "fas fa-quote-right", label: "Blockquote", insert: "> " },
          { icon: "fas fa-list-ul", label: "Bullet list", insert: "- " },
          { icon: "fas fa-list-ol", label: "Ordered list", insert: "1. " },
          { icon: "fas fa-code", label: "Code block", insert: "```\n\n```", cursorOffset: -4 },
          { icon: "fas fa-table", label: "Table", insert: "| Col 1 | Col 2 |\n|-------|-------|\n|       |       |" },
          { icon: "fas fa-minus", label: "Horizontal rule", insert: "\n---\n" },
        ],
      },
      {
        name: "Insert",
        items: [
          { icon: "fas fa-link", label: "Link", insert: "[](url)", cursorOffset: -7 },
          { icon: "fas fa-image", label: "Image", insert: "![]()", cursorOffset: -1 },
        ],
      },
    ];

    const el = document.createElement("div");
    el.className = "slash-palette";
    document.body.appendChild(el);

    let selectedIdx = -1;
    let flatItems = [];

    function render(query) {
      el.innerHTML = "";
      flatItems = [];
      selectedIdx = -1;
      const q = query.toLowerCase();
      let hasAny = false;

      for (const group of CMD_GROUPS) {
        const matched = group.items.filter((i) => i.label.toLowerCase().includes(q));
        if (q && !matched.length) continue;
        hasAny = true;
        const hdr = document.createElement("div");
        hdr.className = "slash-group";
        hdr.textContent = group.name;
        el.appendChild(hdr);
        for (const item of matched) {
          flatItems.push(item);
          const btn = document.createElement("button");
          btn.className = "slash-item";
          btn.innerHTML = `<i class="${item.icon}"></i><span>${item.label}</span>`;
          btn.addEventListener("click", (e) => { e.stopPropagation(); hide(); onPick(item); });
          btn.addEventListener("mouseenter", () => {
            el.querySelectorAll(".slash-item.selected").forEach((s) => s.classList.remove("selected"));
            btn.classList.add("selected");
            selectedIdx = flatItems.indexOf(item);
          });
          el.appendChild(btn);
        }
      }
      if (!hasAny) {
        el.innerHTML = '<div class="slash-empty">No commands found</div>';
      }
    }

    function show(cm) {
      activeSlash = true;
      const coords = cm.cursorCoords(true);
      el.style.display = "block";
      el.style.top = (coords.bottom + 6) + "px";
      el.style.left = Math.max(8, coords.left) + "px";
      const cursor = cm.getCursor();
      const line = cm.getLine(cursor.line);
      const before = line.slice(0, cursor.ch);
      const match = before.match(/\/(\w*)$/);
      render(match ? match[1] : "");
    }

    function hide() {
      activeSlash = false;
      el.style.display = "none";
    }

    function selectNext() {
      const btns = el.querySelectorAll(".slash-item:not(.slash-empty)");
      if (!btns.length) return;
      selectedIdx = (selectedIdx + 1) % btns.length;
      btns.forEach((b, i) => b.classList.toggle("selected", i === selectedIdx));
      btns[selectedIdx].scrollIntoView({ block: "nearest" });
    }

    function selectPrev() {
      const btns = el.querySelectorAll(".slash-item:not(.slash-empty)");
      if (!btns.length) return;
      selectedIdx = (selectedIdx - 1 + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle("selected", i === selectedIdx));
      btns[selectedIdx].scrollIntoView({ block: "nearest" });
    }

    function confirm() {
      if (selectedIdx >= 0 && selectedIdx < flatItems.length) {
        hide();
        onPick(flatItems[selectedIdx]);
        return true;
      }
      return false;
    }

    el.addEventListener("mousedown", (e) => e.preventDefault());

    // Hide on click outside
    document.addEventListener("mousedown", (e) => {
      if (activeSlash && !el.contains(e.target)) hide();
    }, true);

    return { el, show, hide, render, selectNext, selectPrev, confirm };
  }

  /* ── Editor creation ───────────────────────────────────── */

  async function create(host, initialMarkdown, opts) {
    opts = opts || {};
    ensureCss();
    host.classList.add("milkdown-container");
    host.innerHTML = "";

    // Loading placeholder
    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.innerHTML =
      '<div class="empty-state-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.39 0 4.68.94 6.36 2.64L21 9"/><path d="M21 3v6h-6"/></svg></div><div class="empty-state-title">Loading editor…</div><div class="empty-state-text">Fetching the EasyMDE bundle from CDN.</div>';
    host.appendChild(loading);

    let EasyMDE;
    try {
      EasyMDE = await loadScript();
    } catch (e) {
      host.innerHTML = "";
      const err = document.createElement("div");
      err.className = "empty-state";
      err.innerHTML =
        '<div class="empty-state-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div><div class="empty-state-title">Failed to load markdown editor</div><div class="empty-state-text">Could not load EasyMDE from the CDN. Check your network connection or run inside Tauri (which whitelists the CDN in its CSP).</div>';
      host.appendChild(err);
      throw e;
    }

    host.innerHTML = "";

    const ta = document.createElement("textarea");
    host.appendChild(ta);

    // Detect RTL from app state
    const isRtl = window.OslerAdminI18n && window.OslerAdminI18n.lang === "ar";

    let suppressChange = false;
    let lastMd = initialMarkdown || "";

    const editor = new EasyMDE({
      element: ta,
      initialValue: initialMarkdown || "",
      spellChecker: false,
      autofocus: false,
      direction: isRtl ? "rtl" : "ltr",
      status: ["lines", "words", "cursor"],
      renderingConfig: { codeSyntaxHighlighting: false },
      toolbar: [
        "heading", "bold", "italic", "strikethrough", "|",
        "heading-1", "heading-2", "heading-3", "|",
        "quote", "unordered-list", "ordered-list", "code", "table", "horizontal-rule", "|",
        "link", "image", "|",
        "preview", "side-by-side", "fullscreen", "|",
        "undo", "redo", "|",
        "guide",
      ],
    });

    // Change tracking
    const cm = editor.codemirror;
    if (typeof cm !== "undefined" && opts.onChange) {
      cm.on("change", function () {
        if (suppressChange) return;
        const md = editor.value();
        if (md !== lastMd) { lastMd = md; opts.onChange(md); }
      });
    }

    // ── Slash command palette ──
    const slash = buildSlashPalette(function (item) {
      const cursor = cm.getCursor();
      const line = cm.getLine(cursor.line);
      const before = line.slice(0, cursor.ch);
      const slashIdx = before.lastIndexOf("/");
      if (slashIdx >= 0) {
        cm.replaceRange("", { line: cursor.line, ch: slashIdx }, cursor);
      }
      const txt = item.insert || "";
      const offset = item.cursorOffset || 0;
      const pos = cm.getCursor();
      cm.replaceSelection(txt);
      if (offset) {
        cm.setCursor({ line: pos.line, ch: pos.ch + offset });
      }
      cm.focus();
    });

    if (cm) {
      cm.on("keydown", function (cmInstance, event) {
        if (activeSlash) {
          if (event.key === "Escape") { event.preventDefault(); slash.hide(); return; }
          if (event.key === "ArrowDown") { event.preventDefault(); slash.selectNext(); return; }
          if (event.key === "ArrowUp") { event.preventDefault(); slash.selectPrev(); return; }
          if (event.key === "Enter" || event.key === "Tab") {
            if (slash.confirm()) { event.preventDefault(); return; }
          }
          if (event.key === "Backspace" || (event.key.length === 1 && event.key !== "/")) {
            setTimeout(() => {
              const cursor = cm.getCursor();
              const line = cm.getLine(cursor.line);
              const before = line.slice(0, cursor.ch);
              const m = before.match(/\/(\w*)$/);
              if (m) { slash.render(m[1]); } else { slash.hide(); }
            }, 10);
          }
        }
        if (event.key === "/" && !event.ctrlKey && !event.metaKey) {
          setTimeout(() => {
            const cursor = cm.getCursor();
            const line = cm.getLine(cursor.line);
            const before = line.slice(0, cursor.ch);
            if (before.endsWith("/")) { slash.show(cm); }
          }, 10);
        }
      });

      cm.on("cursorActivity", function () {
        if (!activeSlash) return;
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        const before = line.slice(0, cursor.ch);
        if (!before.match(/\/(\w*)$/)) { slash.hide(); }
      });
    }

    return {
      getMarkdown() {
        try { return editor.value(); } catch { return lastMd; }
      },
      async getMarkdownAsync() { return this.getMarkdown(); },
      setMarkdown(md) {
        suppressChange = true;
        try { editor.value(md || ""); } catch {}
        lastMd = md || "";
        suppressChange = false;
      },
      destroy() {
        try { if (editor && typeof editor.toTextArea === "function") editor.toTextArea(); } catch {}
        // Clean up slash palette
        document.querySelectorAll(".slash-palette, .slash-palette-overlay").forEach((el) => el.remove());
        host.classList.remove("milkdown-container");
        host.innerHTML = "";
      },
    };
  }

  window.OslerMarkdownEditor = { create };
})();
