// views/mermaid-editor.js — visual mermaid diagram editor for the Osler admin.
//
// Lazy-loads mermaid@11 from jsDelivr on first use (same pattern as EasyMDE).
// Exposes one public method:
//
//   OslerMermaidEditor.openModal(initialCode, onSave)
//     initialCode — the raw mermaid source string (without fence markers)
//     onSave(newCode) — called when the user clicks "Save"
//
// The modal is a full-screen overlay with three columns:
//   · left  — collapsible template / diagram-type picker
//   · center — monospace textarea for editing the source
//   · right — live-rendered SVG preview (debounced 500 ms)

(function () {
  "use strict";

  const MERMAID_VERSION = "11.4.1";
  const MERMAID_JS = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`;

  let mermaidReady = false;
  let mermaidPromise = null;

  /* ── CDN loader ──────────────────────────────────────────────────── */

  function loadMermaid() {
    if (!mermaidPromise) {
      mermaidPromise = new Promise((resolve, reject) => {
        if (typeof window.mermaid !== "undefined") {
          initMermaid();
          resolve(window.mermaid);
          return;
        }
        const s = document.createElement("script");
        s.src = MERMAID_JS;
        s.async = true;
        s.onload = () => {
          if (typeof window.mermaid !== "undefined") {
            initMermaid();
            resolve(window.mermaid);
          } else {
            reject(new Error("mermaid global not found after load"));
          }
        };
        s.onerror = () => reject(new Error("Failed to load mermaid from CDN"));
        document.head.appendChild(s);
      });
    }
    return mermaidPromise;
  }

  function getTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    return t === "light" ? "default" : "dark";
  }

  function initMermaid() {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: getTheme(),
      securityLevel: "loose",
      fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
    });
    mermaidReady = true;
  }

  /* ── Diagram templates ───────────────────────────────────────────── */

  const TEMPLATES = [
    {
      group: "Flow",
      items: [
        {
          label: "Flowchart",
          icon: "fas fa-project-diagram",
          code: `flowchart TD
    A([Start]) --> B{Decision?}
    B -- Yes --> C[Process A]
    B -- No  --> D[Process B]
    C --> E([End])
    D --> E`,
        },
        {
          label: "Sequence",
          icon: "fas fa-exchange-alt",
          code: `sequenceDiagram
    participant Patient
    participant Doctor
    Patient->>Doctor: Presents with symptoms
    Doctor->>Doctor: Examines patient
    Doctor-->>Patient: Diagnosis & treatment plan`,
        },
        {
          label: "State",
          icon: "fas fa-circle-notch",
          code: `stateDiagram-v2
    [*] --> Idle
    Idle --> Running : start
    Running --> Paused : pause
    Paused --> Running : resume
    Running --> [*] : stop`,
        },
      ],
    },
    {
      group: "Structural",
      items: [
        {
          label: "Class",
          icon: "fas fa-cubes",
          code: `classDiagram
    class Patient {
        +String name
        +int age
        +diagnose()
    }
    class Doctor {
        +String specialty
        +treat(Patient p)
    }
    Doctor "1" --> "*" Patient : treats`,
        },
        {
          label: "Entity-Relation",
          icon: "fas fa-table",
          code: `erDiagram
    PATIENT ||--o{ VISIT : has
    VISIT }o--|| DOCTOR : "seen by"
    VISIT {
        string date
        string notes
    }`,
        },
      ],
    },
    {
      group: "Planning",
      items: [
        {
          label: "Gantt",
          icon: "fas fa-bars",
          code: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Research    :a1, 2024-01-01, 14d
    Analysis    :after a1, 7d
    section Phase 2
    Development :2024-01-22, 21d`,
        },
        {
          label: "Timeline",
          icon: "fas fa-stream",
          code: `timeline
    title Medical History
    2020 : Hypertension diagnosed
         : Started antihypertensives
    2022 : Developed T2DM
    2024 : Cardiac event
         : Stenting performed`,
        },
        {
          label: "Journey",
          icon: "fas fa-route",
          code: `journey
    title Patient Journey
    section Presentation
        Symptom onset : 3 : Patient
        GP visit      : 5 : Patient, GP
    section Investigation
        Blood tests   : 4 : GP, Lab
        Imaging       : 4 : Radiologist`,
        },
      ],
    },
    {
      group: "Data",
      items: [
        {
          label: "Pie chart",
          icon: "fas fa-chart-pie",
          code: `pie title Aetiology of Stroke
    "Ischaemic (thrombotic)"  : 40
    "Ischaemic (embolic)"     : 30
    "Ischaemic (lacunar)"     : 15
    "Haemorrhagic"            : 10
    "Other / unknown"         : 5`,
        },
        {
          label: "Mindmap",
          icon: "fas fa-brain",
          code: `mindmap
  root((Hypertension))
    Causes
      Primary
      Secondary
        Renal
        Endocrine
    Complications
      Stroke
      MI
      CKD
    Management
      Lifestyle
      Pharmacology`,
        },
      ],
    },
  ];

  /* ── DOM helpers ─────────────────────────────────────────────────── */

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "style" && typeof v === "object") {
          Object.assign(node.style, v);
        } else if (v != null) {
          node.setAttribute(k, v);
        }
      }
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  /* ── Diagram type badge ──────────────────────────────────────────── */

  const DIAGRAM_LABELS = {
    flowchart: "Flowchart",
    graph: "Flowchart",
    sequencediagram: "Sequence",
    statediagram: "State",
    "statediagram-v2": "State",
    classdiagram: "Class",
    erdiagram: "ER Diagram",
    gantt: "Gantt",
    timeline: "Timeline",
    journey: "Journey",
    pie: "Pie Chart",
    mindmap: "Mindmap",
    gitgraph: "Git Graph",
    xychart: "XY Chart",
    quadrantchart: "Quadrant",
    block: "Block",
    sankey: "Sankey",
  };

  function detectDiagramType(code) {
    const first = (code || "").trim().split("\n")[0].trim().toLowerCase().split(/\s/)[0];
    return DIAGRAM_LABELS[first] ?? "Diagram";
  }

  /* ── Renderer ────────────────────────────────────────────────────── */

  let _renderId = 0;

  async function renderDiagram(code, previewEl, errorEl) {
    errorEl.style.display = "none";
    errorEl.textContent = "";
    previewEl.innerHTML =
      '<div class="mermaid-preview-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>';

    let m;
    try {
      m = await loadMermaid();
    } catch (e) {
      errorEl.textContent = "Could not load mermaid from CDN. Check your connection.";
      errorEl.style.display = "";
      previewEl.innerHTML = "";
      return;
    }

    // Re-init with current theme every render (theme may have been toggled)
    m.initialize({
      startOnLoad: false,
      theme: getTheme(),
      securityLevel: "loose",
      fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
    });

    const id = "mermaid-render-" + (++_renderId);
    try {
      const { svg } = await m.render(id, code.trim() || "graph TD\n  A --> B");
      previewEl.innerHTML = svg;
      // Make SVG fill container width
      const svgEl = previewEl.querySelector("svg");
      if (svgEl) {
        svgEl.style.maxWidth = "100%";
        svgEl.style.height = "auto";
        svgEl.removeAttribute("width");
      }
    } catch (err) {
      // Mermaid may leave a stale #id element in DOM — clean it up
      document.getElementById(id)?.remove();
      const msg = String(err?.message ?? err ?? "Parse error");
      // Strip ANSI / control codes mermaid sometimes adds
      errorEl.textContent = msg.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 300);
      errorEl.style.display = "";
      previewEl.innerHTML =
        '<div class="mermaid-preview-empty"><i class="fas fa-exclamation-triangle"></i><span>Fix the error to preview</span></div>';
    }
  }

  /* ── Modal ───────────────────────────────────────────────────────── */

  function openModal(initialCode, onSave) {
    // Prevent double-open
    if (document.querySelector(".mermaid-modal")) return;

    let code = (initialCode || "graph TD\n  A --> B").trim();
    let debounceTimer = null;

    /* ── Sidebar ── */

    const sidebar = el("div", { class: "mermaid-sidebar" });

    const sidebarHeader = el("div", { class: "mermaid-sidebar-header" });
    sidebarHeader.appendChild(el("span", {}, "Templates"));
    sidebar.appendChild(sidebarHeader);

    const sidebarList = el("div", { class: "mermaid-sidebar-list" });

    TEMPLATES.forEach((group) => {
      const groupLabel = el("div", { class: "mermaid-group-label" }, group.group);
      sidebarList.appendChild(groupLabel);
      group.items.forEach((tmpl) => {
        const btn = el("button", {
          class: "mermaid-tmpl-btn",
          type: "button",
          title: tmpl.label,
        });
        btn.innerHTML = `<i class="${tmpl.icon}"></i><span>${tmpl.label}</span>`;
        btn.addEventListener("click", () => {
          code = tmpl.code.trim();
          textarea.value = code;
          updateBadge();
          scheduleRender();
        });
        sidebarList.appendChild(btn);
      });
    });

    sidebar.appendChild(sidebarList);

    /* ── Center (textarea) ── */

    const center = el("div", { class: "mermaid-center" });

    const centerLabel = el("div", { class: "mermaid-center-label" });
    centerLabel.innerHTML =
      '<i class="fas fa-code"></i><span>Mermaid source</span>';

    const textarea = el("textarea", {
      class: "mermaid-src",
      spellcheck: "false",
      placeholder: "graph TD\n  A --> B",
    });
    textarea.value = code;

    const errorBanner = el("div", { class: "mermaid-error" });
    errorBanner.style.display = "none";

    center.appendChild(centerLabel);
    center.appendChild(textarea);
    center.appendChild(errorBanner);

    /* ── Right (preview) ── */

    const right = el("div", { class: "mermaid-right" });

    const rightLabel = el("div", { class: "mermaid-right-label" });
    rightLabel.innerHTML = '<i class="fas fa-eye"></i><span>Preview</span>';

    const previewEl = el("div", { class: "mermaid-preview" });
    previewEl.innerHTML =
      '<div class="mermaid-preview-empty"><i class="fas fa-circle-notch fa-spin"></i><span>Loading…</span></div>';

    right.appendChild(rightLabel);
    right.appendChild(previewEl);

    /* ── Type badge ── */

    const typeBadge = el("div", { class: "mermaid-type-badge" });

    function updateBadge() {
      code = textarea.value;
      typeBadge.textContent = detectDiagramType(code);
    }

    function scheduleRender() {
      code = textarea.value;
      updateBadge();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderDiagram(code, previewEl, errorBanner), 500);
    }

    textarea.addEventListener("input", scheduleRender);

    /* ── Header ── */

    const header = el("div", { class: "mermaid-header" });

    const headerLeft = el("div", { class: "mermaid-header-left" });
    headerLeft.innerHTML = '<i class="fas fa-project-diagram"></i>';
    headerLeft.appendChild(el("span", { class: "mermaid-header-title" }, "Edit Diagram"));
    typeBadge.textContent = detectDiagramType(code);
    headerLeft.appendChild(typeBadge);

    const headerRight = el("div", { class: "mermaid-header-right" });

    const closeBtn = el("button", {
      class: "mermaid-close-btn",
      type: "button",
      title: "Close without saving",
    });
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';

    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    headerRight.appendChild(closeBtn);

    /* ── Footer ── */

    const footer = el("div", { class: "mermaid-footer" });

    const cancelBtn = el("button", {
      class: "btn btn-ghost",
      type: "button",
    }, "Cancel");

    const saveBtn = el("button", {
      class: "btn btn-primary",
      type: "button",
    });
    saveBtn.innerHTML = '<i class="fas fa-check"></i> Save diagram';

    footer.appendChild(el("div", { class: "mermaid-footer-hint" },
      "Ctrl+S to save · Esc to cancel"
    ));
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    /* ── Layout ── */

    const layout = el("div", { class: "mermaid-layout" });
    layout.appendChild(sidebar);
    layout.appendChild(center);
    layout.appendChild(right);

    const card = el("div", { class: "mermaid-card" });
    card.appendChild(header);
    card.appendChild(layout);
    card.appendChild(footer);

    const overlay = el("div", { class: "mermaid-modal" });
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    /* ── Actions ── */

    function doClose() {
      clearTimeout(debounceTimer);
      overlay.remove();
    }

    function doSave() {
      const finalCode = textarea.value.trim();
      onSave(finalCode);
      doClose();
    }

    closeBtn.addEventListener("click", doClose);
    cancelBtn.addEventListener("click", doClose);
    saveBtn.addEventListener("click", doSave);

    // Click outside card to close
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) doClose();
    });

    // Keyboard shortcuts
    const keyHandler = (e) => {
      if (e.key === "Escape") { e.preventDefault(); doClose(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        doSave();
      }
    };
    document.addEventListener("keydown", keyHandler);
    overlay.addEventListener("remove", () => {
      document.removeEventListener("keydown", keyHandler);
    });

    // Use MutationObserver to clean up keyHandler when overlay is removed
    const observer = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        document.removeEventListener("keydown", keyHandler);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });

    // Focus textarea
    setTimeout(() => textarea.focus(), 60);

    // Initial render
    renderDiagram(code, previewEl, errorBanner);
  }

  /* ── Public API ──────────────────────────────────────────────────── */

  window.OslerMermaidEditor = { openModal };
})();
