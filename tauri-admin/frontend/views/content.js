// views/content.js — File tree + JSON/markdown editor.
//
// For `.md` files, opens a Milkdown Crepe WYSIWYG markdown editor (loaded
// on demand from the CDN by views/markdown-editor.js). For `.json` files
// with a known shape, falls back to the structured form editor in
// views/content-editor.js. Everything else uses a plain textarea.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  let currentPath = null;
  let currentContent = "";
  let dirty = false;
  let activeMarkdownEditor = null;

  function treeRow(item) {
    const row = el("div", { class: "tree-row", "data-path": item.path });
    if (item.type === "folder") {
      row.appendChild(svgIcon("M9 18l6-6-6-6", 12));
      row.classList.add("has-children");
      const icon = svgIcon("M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-3H4a1 1 0 0 0-1 1z", 14);
      icon.classList.add("icon");
      row.appendChild(icon);
      row.appendChild(el("span", { class: "name" }, item.name));
      if (item.items && item.items.length) {
        row.appendChild(el("span", { class: "meta" }, String(item.items.length)));
      }
    } else {
      // Spacer for alignment
      row.appendChild(el("span", { style: { width: "12px", flexShrink: "0" } }));
      const iconPath = item.ext === "md"
        ? "M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        : "M4 4h16v16H4z";
      const icon = svgIcon(iconPath, 14);
      icon.classList.add("icon");
      if (item.ext === "md") icon.style.color = "var(--accent)";
      row.appendChild(icon);
      row.appendChild(el("span", { class: "name" }, item.name));
      if (item.size) {
        row.appendChild(el("span", { class: "meta" }, formatSize(item.size)));
      }
    }
    return row;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderTree(items, container) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const row = treeRow(item);
      container.appendChild(row);
      if (item.type === "folder") {
        const childWrap = el("div", { class: "tree-children", style: { display: "none" } });
        container.appendChild(childWrap);
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          const expanded = childWrap.style.display !== "none";
          childWrap.style.display = expanded ? "none" : "";
          row.classList.toggle("expanded", !expanded);
        });
        renderTree(item.items, childWrap);
      } else {
        row.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (dirty && !confirm(t("content.file.dirty") + " — " + t("common.save") + "?")) {
            return;
          }
          await openFile(item.path);
          document.querySelectorAll(".tree-row.active").forEach((r) => r.classList.remove("active"));
          row.classList.add("active");
        });
      }
    }
  }

  async function openFile(path) {
    // Tear down any active markdown editor before swapping the DOM.
    if (activeMarkdownEditor) {
      try { activeMarkdownEditor.destroy(); } catch {}
      activeMarkdownEditor = null;
    }
    try {
      const res = await invoke("load_file", { path });
      currentPath = res.path;
      currentContent = res.content;
      dirty = false;
      renderEditor();
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  function detectContentType(content) {
    try {
      const parsed = JSON.parse(content);
      if (window.OslerAdminContentEditor && window.OslerAdminContentEditor.detectType) {
        return window.OslerAdminContentEditor.detectType(parsed);
      }
      if (parsed.questions && Array.isArray(parsed.questions)) {
        if (parsed.questions[0] && parsed.questions[0].front) return "flashcard";
        return "quiz";
      }
      if (parsed.passages) return "bank";
      if (parsed.prompts) return "written";
      if (parsed.stations) return "osce";
      if (parsed.videos) return "video";
      if (parsed.cards) return "flashcard";
    } catch {}
    return null;
  }

  async function renderEditor() {
    const editorPane = document.getElementById("editor-pane");
    if (!editorPane) return;
    editorPane.innerHTML = "";

    if (!currentPath) {
      editorPane.appendChild(el("div", { class: "empty-state", style: { height: "100%" } },
        el("div", { class: "empty-state-icon" }, svgIcon("M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", 24)),
        el("div", { class: "empty-state-title" }, t("content.file.empty")),
        el("div", { class: "empty-state-text" }, t("content.subtitle"))
      ));
      return;
    }

    // Header
    const header = el("div", { class: "editor-header" });
    header.appendChild(el("div", { class: "editor-title" }, currentPath));
    const actions = el("div", { style: { display: "flex", gap: "0.375rem" } });

    const isMd = currentPath.endsWith(".md");
    const isJson = currentPath.endsWith(".json");

    if (isJson) {
      const detectBtn = el("button", { class: "btn btn-ghost btn-sm" }, svgIcon("M9 12l2 2 4-4", 14), t("content.file.validate"));
      detectBtn.addEventListener("click", validateCurrent);
      actions.appendChild(detectBtn);
    }
    if (isMd) {
      actions.appendChild(el("span", { class: "badge badge-accent" }, "Markdown"));
    }
    const saveBtn = el("button", { class: "btn btn-primary btn-sm", id: "save-btn" }, svgIcon("M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8", 14), t("common.save"));
    saveBtn.addEventListener("click", saveCurrent);
    actions.appendChild(saveBtn);
    const delBtn = el("button", { class: "btn btn-danger btn-sm" }, svgIcon("M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", 14));
    delBtn.title = t("common.delete");
    delBtn.addEventListener("click", deleteCurrent);
    actions.appendChild(delBtn);
    header.appendChild(actions);
    editorPane.appendChild(header);

    // Body
    const body = el("div", { class: "editor-body", id: "editor-body" });
    editorPane.appendChild(body);

    // Markdown → EasyMDE editor
    if (isMd) {
      body.classList.add("editor-body-flex");
      const host = el("div", { id: "markdown-host" });
      body.appendChild(host);
      try {
        activeMarkdownEditor = await window.OslerMarkdownEditor.create(host, currentContent, {
          onChange(md) {
            currentContent = md;
            dirty = true;
            updateStatus();
          },
        });
      } catch (e) {
        // Fallback: plain textarea if the CDN editor fails to load
        body.innerHTML = "";
        body.classList.add("auto");
        const ta = el("textarea", { class: "code-editor", id: "editor-textarea", spellcheck: "false" });
        ta.value = currentContent;
        ta.addEventListener("input", () => { dirty = true; updateStatus(); });
        ta.addEventListener("keydown", (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            saveCurrent();
          }
        });
        body.appendChild(ta);
        toast("Markdown editor unavailable — showing raw textarea.", "warn");
      }
    } else if (isJson) {
      // Try the structured form editor first
      let useFormEditor = false;
      try {
        const parsed = JSON.parse(currentContent);
        const type = window.OslerAdminContentEditor && window.OslerAdminContentEditor.detectType(parsed);
        if (type) {
          useFormEditor = true;
          body.classList.add("auto");
          window.OslerAdminContentEditor.render(body, currentPath, parsed, () => {
            currentContent = JSON.stringify(parsed, null, 2);
            dirty = true;
            updateStatus();
          });
        }
      } catch {}
      if (!useFormEditor) {
        const ta = el("textarea", { class: "code-editor", id: "editor-textarea", spellcheck: "false" });
        ta.value = currentContent;
        ta.addEventListener("input", () => { dirty = true; updateStatus(); });
        ta.addEventListener("keydown", (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            saveCurrent();
          }
        });
        body.appendChild(ta);
      }
    } else {
      // Anything else → plain textarea
      const ta = el("textarea", { class: "code-editor", id: "editor-textarea", spellcheck: "false" });
      ta.value = currentContent;
      ta.addEventListener("input", () => { dirty = true; updateStatus(); });
      ta.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveCurrent();
        }
      });
      body.appendChild(ta);
    }

    // Footer
    const footer = el("div", { class: "editor-footer", id: "editor-footer" });
    editorPane.appendChild(footer);
    updateStatus();
  }

  function updateStatus() {
    const footer = document.getElementById("editor-footer");
    if (!footer) return;
    footer.innerHTML = "";
    const left = el("div", { style: { display: "flex", alignItems: "center", gap: "0.5rem" } });
    if (dirty) {
      left.appendChild(el("span", {}, el("span", { class: "dirty-dot" }), t("content.file.dirty")));
    } else if (currentPath) {
      left.appendChild(el("span", { class: "badge badge-success" }, t("content.file.saved")));
    }
    footer.appendChild(left);

    const ta = document.getElementById("editor-textarea");
    if (ta) {
      const lines = ta.value.split("\n").length;
      const chars = ta.value.length;
      footer.appendChild(el("span", { style: { color: "var(--text-dim)" } }, lines + " lines · " + chars + " chars"));
    } else if (activeMarkdownEditor) {
      const md = currentContent || "";
      const chars = md.length;
      const words = md.trim() ? md.trim().split(/\s+/).length : 0;
      footer.appendChild(el("span", { style: { color: "var(--text-dim)" } }, words + " words · " + chars + " chars"));
    }
  }

  async function saveCurrent() {
    if (!currentPath) return;

    // If the markdown editor is active, pull the latest markdown out of it
    // before saving — the onChange handler keeps `currentContent` in sync,
    // but call getMarkdown() once more to be safe.
    let content = currentContent;
    if (activeMarkdownEditor) {
      try {
        const md = await activeMarkdownEditor.getMarkdownAsync();
        if (typeof md === "string") {
          content = md;
          currentContent = md;
        }
      } catch (e) {
        console.warn("getMarkdownAsync failed:", e);
      }
    } else {
      const ta = document.getElementById("editor-textarea");
      if (ta) content = ta.value;
    }

    const btn = document.getElementById("save-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("content.file.saving");
    }
    try {
      await invoke("save_file", { path: currentPath, content });
      currentContent = content;
      dirty = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("common.save");
      }
      toast(t("toast.saved"), "success");
      updateStatus();
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("common.save");
      }
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function deleteCurrent() {
    if (!currentPath) return;
    if (!confirm(t("content.file.confirmDelete", { name: currentPath.split("/").pop() }))) return;
    try {
      await invoke("delete_path", { path: currentPath });
      toast(t("toast.deleted"), "success");
      if (activeMarkdownEditor) {
        try { activeMarkdownEditor.destroy(); } catch {}
        activeMarkdownEditor = null;
      }
      currentPath = null;
      currentContent = "";
      dirty = false;
      renderEditor();
      await refreshTree();
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function validateCurrent() {
    const ta = document.getElementById("editor-textarea");
    const src = ta ? ta.value : currentContent;
    if (!src) return;
    const contentType = detectContentType(src);
    if (!contentType) {
      toast("Could not detect content type", "error");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(src);
    } catch (e) {
      toast("Invalid JSON: " + e.message, "error");
      return;
    }
    try {
      const res = await invoke("validate_content", { contentType, contentJson: parsed });
      if (res.valid) {
        toast(t("content.file.valid"), "success");
      } else {
        toast(t("content.file.invalid", { n: res.errors.length }) + " — " + res.errors[0], "error");
      }
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function refreshTree() {
    const treeEl = document.getElementById("tree");
    if (!treeEl) return;
    treeEl.innerHTML = "";
    try {
      const res = await invoke("list_files");
      if (!res.items || res.items.length === 0) {
        treeEl.appendChild(el("div", { class: "empty-state", style: { padding: "2rem 1rem" } },
          el("div", { class: "empty-state-text" }, t("content.tree.empty"))
        ));
        return;
      }
      renderTree(res.items, treeEl);
    } catch (e) {
      treeEl.appendChild(el("div", { class: "empty-state", style: { padding: "2rem 1rem" } },
        el("div", { class: "empty-state-text" }, t("toast.error", { msg: String(e) }))
      ));
    }
  }

  window.OslerAdminViews = window.OslerAdminViews || {};
  window.OslerAdminViews.content = async function (view) {
    if (!requireProject()) {
      window.OslerAdmin.navigate("dashboard");
      return;
    }

    const wrap = el("div", { class: "view medos-fade-in", style: { height: "calc(100vh - var(--topbar-h))", display: "flex", flexDirection: "column", maxWidth: "none" } });

    // Header
    const header = el("div", { class: "view-header" });
    header.appendChild(el("div", {},
      el("h1", {}, t("content.title")),
      el("p", { class: "subtitle" }, t("content.subtitle"))
    ));
    const headerActions = el("div", { class: "view-header-actions" });
    const newFileBtn = el("button", { class: "btn btn-sm" }, svgIcon("M12 5v14M5 12h14", 14), t("common.newFile"));
    newFileBtn.addEventListener("click", () => {
      const path = prompt("New file path (under public/osler-content/):", "public/osler-content/library/new-article.md");
      if (!path) return;
      invoke("create_file", { path, content: null })
        .then(() => { toast(t("toast.created"), "success"); refreshTree(); })
        .catch((e) => toast(t("toast.error", { msg: String(e) }), "error"));
    });
    headerActions.appendChild(newFileBtn);
    const newFolderBtn = el("button", { class: "btn btn-sm" }, svgIcon("M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-3H4a1 1 0 0 0-1 1z", 14), t("common.newFolder"));
    newFolderBtn.addEventListener("click", () => {
      const path = prompt("New folder path (under public/osler-content/):", "public/osler-content/library/new-section");
      if (!path) return;
      invoke("create_folder", { path })
        .then(() => { toast(t("toast.created"), "success"); refreshTree(); })
        .catch((e) => toast(t("toast.error", { msg: String(e) }), "error"));
    });
    headerActions.appendChild(newFolderBtn);
    const refreshBtn = el("button", { class: "btn btn-ghost btn-sm" }, svgIcon("M21 12a9 9 0 1 1-9-9c2.39 0 4.68.94 6.36 2.64L21 9", 14), t("common.refresh"));
    refreshBtn.addEventListener("click", refreshTree);
    headerActions.appendChild(refreshBtn);
    header.appendChild(headerActions);
    wrap.appendChild(header);

    // Two-column body — tree left, editor right
    const layout = el("div", { class: "content-layout", style: { flex: "1", minHeight: "0" } });

    const treeCol = el("div", { class: "tree" });
    const treeHeader = el("div", { class: "tree-header" },
      el("span", { class: "tree-header-title" }, t("content.tree.title"))
    );
    treeCol.appendChild(treeHeader);
    const tree = el("div", { id: "tree", style: { flex: "1", overflowY: "auto" } });
    treeCol.appendChild(tree);
    layout.appendChild(treeCol);

    const editorCol = el("div", { class: "editor-pane", id: "editor-pane" });
    layout.appendChild(editorCol);

    wrap.appendChild(layout);
    view.appendChild(wrap);

    await refreshTree();
    renderEditor();
  };
})();
