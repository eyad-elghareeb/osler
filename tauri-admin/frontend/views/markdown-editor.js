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
      {
        name: "Diagram",
        items: [
          { icon: "fas fa-project-diagram", label: "Mermaid diagram", insert: "```mermaid\ngraph TD\n  A --> B\n```", cursorOffset: -4 },
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

  function toBase64(arrayBuffer) {
    let binary = "";
    const bytes = new Uint8Array(arrayBuffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function toast(msg, kind) {
    try {
      const t = window.OslerAdmin && window.OslerAdmin.toast;
      if (t) t(msg, kind);
    } catch {}
  }

  async function create(host, initialMarkdown, opts) {
    opts = opts || {};
    const filePath = opts.filePath || "";
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

    /* ── Mermaid chip overlay ─────────────────────────────────────────
     *
     * Scans the CodeMirror document for ```mermaid fenced blocks.
     * For every opening fence line, it injects a CodeMirror line-widget
     * containing a small "✦ Edit Diagram" chip button.
     * Clicking the chip opens OslerMermaidEditor.openModal with the
     * extracted source, and replaces the block on save.
     * ──────────────────────────────────────────────────────────────── */

    const _chipWidgets = []; // { widget, lineNo } — cleared on each sync

    function syncMermaidChips() {
      if (!cm) return;

      // Clear previous widgets
      _chipWidgets.forEach(({ widget }) => widget.clear());
      _chipWidgets.length = 0;

      if (typeof window.OslerMermaidEditor === "undefined") return;

      const lineCount = cm.lineCount();

      for (let i = 0; i < lineCount; i++) {
        const lineText = cm.getLine(i);
        if (!/^\s*```mermaid\s*$/.test(lineText)) continue;

        // Found opening fence — record its line
        const openLine = i;

        // Find matching closing fence
        let closeLine = -1;
        for (let j = i + 1; j < lineCount; j++) {
          if (/^\s*```\s*$/.test(cm.getLine(j))) {
            closeLine = j;
            break;
          }
        }
        if (closeLine === -1) continue; // unclosed block — skip

        // Build the chip DOM node
        const chip = document.createElement("button");
        chip.className = "mermaid-chip";
        chip.type = "button";
        chip.innerHTML = '<i class="fas fa-project-diagram"></i> Edit Diagram';

        chip.addEventListener("click", () => {
          // Extract source between fences (exclusive)
          const sourceLines = [];
          for (let k = openLine + 1; k < closeLine; k++) {
            sourceLines.push(cm.getLine(k));
          }
          const currentCode = sourceLines.join("\n");

          window.OslerMermaidEditor.openModal(currentCode, (newCode) => {
            // Replace the content lines between the two fences
            const from = { line: openLine + 1, ch: 0 };
            const to   = { line: closeLine,     ch: 0 };
            cm.replaceRange(
              newCode.trim() + "\n",
              from,
              to
            );
            // Re-sync chips after replacement
            setTimeout(syncMermaidChips, 50);
          });
        });

        // Attach as a line widget below the opening fence
        const widget = cm.addLineWidget(openLine, chip, {
          above: false,
          handleMouseEvents: true,
          noHScroll: true,
        });
        _chipWidgets.push({ widget, lineNo: openLine });

        // Skip past this block so we don't double-scan
        i = closeLine;
      }
    }

    // Re-sync chips on every change (debounced 350 ms)
    let _chipTimer = null;
    if (cm) {
      cm.on("change", () => {
        clearTimeout(_chipTimer);
        _chipTimer = setTimeout(syncMermaidChips, 350);
      });
      // Initial scan after editor is ready
      setTimeout(syncMermaidChips, 200);
    }

    /* ── Image upload ──────────────────────────────────────────────────
     *
     * Lets an author pick an image from disk and have it copied into the
     * `images/` folder next to the current markdown file (matching the
     * QBank/Flashcard/Library asset convention). The reference
     * `![alt](images/name)` is inserted at the cursor.
     * ──────────────────────────────────────────────────────────────── */

    if (filePath && cm) {
      const uploadBar = document.createElement("div");
      uploadBar.className = "md-upload-bar";

      const uploadBtn = document.createElement("button");
      uploadBtn.type = "button";
      uploadBtn.className = "md-upload-btn";
      const uploadLabel = (window.OslerAdmin && window.OslerAdmin.t)
        ? window.OslerAdmin.t("content.file.uploadImage")
        : "Upload image";
      uploadBtn.innerHTML = '<i class="fas fa-image"></i> ' + uploadLabel;
      uploadBtn.addEventListener("click", () => pickAndUploadImage());

      const hint = document.createElement("span");
      hint.className = "md-upload-hint";
      hint.textContent = (window.OslerAdmin && window.OslerAdmin.t)
        ? window.OslerAdmin.t("content.file.imageHint")
        : "Images are saved to an images/ folder next to this file.";

      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.style.display = "none";
      fileInput.addEventListener("change", async (e) => {
        const input = e.target;
        const file = input.files && input.files[0];
        if (file) await uploadImageFile(file);
        input.value = "";
      });

      uploadBar.appendChild(uploadBtn);
      uploadBar.appendChild(hint);
      uploadBar.appendChild(fileInput);
      host.insertBefore(uploadBar, ta);

      async function pickAndUploadImage() {
        try {
          const res = await window.OslerAdmin.invoke("plugin:dialog|open", {
            options: {
              multiple: false,
              title: "Select an image",
              filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp"] }],
            },
          });
          // In Tauri the dialog returns an array of paths (or a single path).
          let chosen = res;
          if (Array.isArray(chosen)) chosen = chosen[0];
          if (!chosen) return;
          const read = await window.OslerAdmin.invoke("read_file_base64", { path: String(chosen) });
          if (!read || !read.data) {
            toast("Could not read the selected image.", "error");
            return;
          }
          await uploadImageFileFromBase64(read.data, read.name || String(chosen).split(/[\\/]/).pop());
        } catch (err) {
          // In a plain browser there's no Tauri dialog — fall back to the
          // native file input.
          fileInput.click();
        }
      }

      async function uploadImageFile(file, fallbackName) {
        try {
          const buf = await file.arrayBuffer();
          const b64 = toBase64(buf);
          await doUploadAsset(b64, fallbackName || file.name);
        } catch (err) {
          toast("Upload failed: " + String(err), "error");
        }
      }

      async function uploadImageFileFromBase64(b64, fallbackName) {
        try {
          await doUploadAsset(b64, fallbackName);
        } catch (err) {
          toast("Upload failed: " + String(err), "error");
        }
      }

      async function doUploadAsset(b64, fileName) {
        const res = await window.OslerAdmin.invoke("upload_content_asset", {
          contentPath: filePath,
          fileName: fileName,
          data: b64,
        });
        const reference = res && res.reference ? res.reference : "images/" + fileName;
        const cursor = cm.getCursor();
        cm.replaceSelection("![](" + reference + ")");
        cm.focus();
        cm.setCursor({ line: cursor.line, ch: cursor.ch + reference.length + 4 });
        toast("Image uploaded to images/ — reference inserted.", "success");
      }
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
        // Re-scan chips whenever content is programmatically set
        setTimeout(syncMermaidChips, 200);
      },
      destroy() {
        clearTimeout(_chipTimer);
        _chipWidgets.forEach(({ widget }) => widget.clear());
        _chipWidgets.length = 0;
        try { if (editor && typeof editor.toTextArea === "function") editor.toTextArea(); } catch {}
        document.querySelectorAll(".slash-palette, .slash-palette-overlay").forEach((el) => el.remove());
        host.classList.remove("milkdown-container");
        host.innerHTML = "";
      },
    };
  }

  window.OslerMarkdownEditor = { create };
})();
