// views/content.js — File tree + JSON/markdown editor.

(function () {
  "use strict";

  const { invoke, toast, helpers, requireProject } = window.OslerAdmin;
  const { el, svgIcon, escapeHtml, t } = helpers;

  let currentPath = null;
  let currentContent = "";
  let dirty = false;

  function treeRow(item, depth) {
    const row = el("div", { class: "tree-row", "data-path": item.path });
    if (item.type === "folder") {
      row.appendChild(svgIcon("M9 18l6-6-6-6", 12));
      row.classList.add("has-children");
      const icon = svgIcon("M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-9l-2-3H4a1 1 0 0 0-1 1z", 14);
      icon.classList.add("icon");
      row.appendChild(icon);
      const name = el("span", { class: "name" }, item.name);
      row.appendChild(name);
      if (item.items && item.items.length) {
        row.appendChild(el("span", { class: "meta" }, String(item.items.length)));
      }
    } else {
      // Spacer for alignment
      row.appendChild(el("span", { style: { width: "12px", flexShrink: "0" } }));
      const icon = svgIcon("M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", 14);
      icon.classList.add("icon");
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

  function renderTree(items, container, depth) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const row = treeRow(item, depth);
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
        renderTree(item.items, childWrap, depth + 1);
      } else {
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (dirty && !confirm(t("content.file.dirty") + " — " + t("common.save") + "?")) {
            // user canceled — keep editing current file
            return;
          }
          openFile(item.path);
          document.querySelectorAll(".tree-row.active").forEach((r) => r.classList.remove("active"));
          row.classList.add("active");
        });
      }
    }
  }

  async function openFile(path) {
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
      if (parsed.questions && Array.isArray(parsed.questions)) {
        if (parsed.questions[0] && parsed.questions[0].front) return "flashcard";
        return "quiz";
      }
      if (parsed.passages) return "bank";
      if (parsed.prompts) return "written";
      if (parsed.stations) return "osce";
      if (parsed.cards) return "flashcard";
    } catch {}
    return null;
  }

  async function renderEditor() {
    const editorPane = document.getElementById("editor-pane");
    if (!editorPane) return;
    editorPane.innerHTML = "";

    if (!currentPath) {
      editorPane.appendChild(el("div", { class: "empty-state" },
        el("div", { class: "empty-state-icon" }, svgIcon("M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", 24)),
        el("div", { class: "empty-state-title" }, t("content.file.empty"))
      ));
      return;
    }

    const toolbar = el("div", { class: "editor-toolbar" });
    toolbar.appendChild(el("div", { class: "editor-path" }, currentPath));
    const isJson = currentPath.endsWith(".json");
    if (isJson) {
      const detectBtn = el("button", { class: "btn btn-ghost btn-sm" }, t("content.file.validate"));
      detectBtn.addEventListener("click", validateCurrent);
      toolbar.appendChild(detectBtn);
    }
    const saveBtn = el("button", { class: "btn btn-primary btn-sm", id: "save-btn" }, t("common.save"));
    saveBtn.addEventListener("click", saveCurrent);
    toolbar.appendChild(saveBtn);
    const delBtn = el("button", { class: "btn btn-danger btn-sm" }, t("common.delete"));
    delBtn.addEventListener("click", deleteCurrent);
    toolbar.appendChild(delBtn);
    editorPane.appendChild(toolbar);

    const ta = el("textarea", { class: "editor-textarea", id: "editor-textarea", spellcheck: "false" });
    ta.value = currentContent;
    ta.addEventListener("input", () => {
      dirty = true;
      updateStatus();
    });
    // Ctrl/Cmd+S to save
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrent();
      }
    });
    editorPane.appendChild(ta);

    const status = el("div", { class: "editor-status", id: "editor-status" });
    editorPane.appendChild(status);
    updateStatus();
  }

  function updateStatus() {
    const status = document.getElementById("editor-status");
    if (!status) return;
    status.innerHTML = "";
    if (dirty) {
      status.appendChild(el("span", { class: "badge accent" }, t("content.file.dirty")));
    } else if (currentPath) {
      status.appendChild(el("span", { class: "badge success" }, t("content.file.saved")));
    }
    const ta = document.getElementById("editor-textarea");
    if (ta) {
      const lines = ta.value.split("\n").length;
      const chars = ta.value.length;
      status.appendChild(el("span", { style: { marginInlineStart: "auto", color: "var(--text-dim)" } }, lines + " lines · " + chars + " chars"));
    }
  }

  async function saveCurrent() {
    if (!currentPath) return;
    const ta = document.getElementById("editor-textarea");
    if (!ta) return;
    const btn = document.getElementById("save-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("content.file.saving");
    }
    try {
      await invoke("save_file", { path: currentPath, content: ta.value });
      currentContent = ta.value;
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
      currentPath = null;
      currentContent = "";
      dirty = false;
      renderEditor();
      // Refresh tree
      await refreshTree();
    } catch (e) {
      toast(t("toast.error", { msg: String(e) }), "error");
    }
  }

  async function validateCurrent() {
    const ta = document.getElementById("editor-textarea");
    if (!ta) return;
    const contentType = detectContentType(ta.value);
    if (!contentType) {
      toast("Could not detect content type", "error");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(ta.value);
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
      renderTree(res.items, treeEl, 0);
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

    const wrap = el("div", { class: "view", style: { padding: "0", height: "100%", display: "flex", flexDirection: "column" } });

    // Header
    const header = el("div", { class: "view-header", style: { padding: "1.5rem 1.5rem 0.75rem", margin: "0" } });
    header.appendChild(el("div", {},
      el("h1", { class: "view-title" }, t("content.title")),
      el("p", { class: "view-subtitle" }, t("content.subtitle"))
    ));
    const headerActions = el("div", { style: { display: "flex", gap: "0.5rem" } });
    const newFileBtn = el("button", { class: "btn btn-outline btn-sm" }, t("common.newFile"));
    newFileBtn.addEventListener("click", () => {
      const path = prompt("New file path (under public/osler-content/):", "public/osler-content/quiz/new-pack/questions.json");
      if (!path) return;
      invoke("create_file", { path, content: null })
        .then(() => { toast(t("toast.created"), "success"); refreshTree(); })
        .catch((e) => toast(t("toast.error", { msg: String(e) }), "error"));
    });
    headerActions.appendChild(newFileBtn);
    const newFolderBtn = el("button", { class: "btn btn-outline btn-sm" }, t("common.newFolder"));
    newFolderBtn.addEventListener("click", () => {
      const path = prompt("New folder path (under public/osler-content/):", "public/osler-content/quiz/new-pack");
      if (!path) return;
      invoke("create_folder", { path })
        .then(() => { toast(t("toast.created"), "success"); refreshTree(); })
        .catch((e) => toast(t("toast.error", { msg: String(e) }), "error"));
    });
    headerActions.appendChild(newFolderBtn);
    const refreshBtn = el("button", { class: "btn btn-ghost btn-sm" }, t("common.refresh"));
    refreshBtn.addEventListener("click", refreshTree);
    headerActions.appendChild(refreshBtn);
    header.appendChild(headerActions);
    wrap.appendChild(header);

    // Two-column body
    const body = el("div", { style: { flex: "1", display: "flex", gap: "0.75rem", padding: "0 1.5rem 1.5rem", minHeight: "0" } });

    const treeCol = el("div", { class: "card", style: { flex: "0 0 280px", padding: "0.75rem", overflowY: "auto" } });
    const tree = el("div", { class: "tree", id: "tree" });
    treeCol.appendChild(tree);
    body.appendChild(treeCol);

    const editorCol = el("div", { class: "card editor-pane", id: "editor-pane", style: { flex: "1", padding: "0", overflow: "hidden" } });
    body.appendChild(editorCol);

    wrap.appendChild(body);
    view.appendChild(wrap);

    await refreshTree();
    renderEditor();
  };
})();
