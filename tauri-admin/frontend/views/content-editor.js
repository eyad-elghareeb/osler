// content-editor.js — Structured form editors for each content type.
// Replaces the raw textarea with type-aware forms when editing JSON content.

(function () {
  "use strict";

  /* ── Helpers ─────────────────────────────────────────── */

  const { helpers } = window.OslerAdmin;
  const { el, svgIcon } = helpers;

  function ic(path, size) { return svgIcon(path, size || 14); }

  const ICONS = {
    add: "M12 5v14M5 12h14",
    remove: "M5 12h14",
    up: "M12 19V5M5 12l7-7 7 7",
    down: "M12 5v14M5 12l7 7 7-7",
    grab: "M8 6h8M8 12h8M8 18h8",
    chevronDown: "M6 9l6 6 6-6",
  };

  function makeLabel(text) {
    return el("label", { class: "fe-label" }, text);
  }

  function textInput(value, placeholder, onChange) {
    const inp = el("input", {
      class: "fe-input",
      type: "text",
      value: value || "",
      placeholder: placeholder || "",
      spellcheck: "true",
    });
    inp.addEventListener("input", () => { onChange(inp.value); });
    return inp;
  }

  function textArea(value, placeholder, onChange) {
    const ta = el("textarea", {
      class: "fe-textarea",
      spellcheck: "true",
      placeholder: placeholder || "",
    });
    ta.value = value || "";
    ta.addEventListener("input", () => { onChange(ta.value); });
    return ta;
  }

  function numberInput(value, onChange) {
    const inp = el("input", {
      class: "fe-input fe-input-narrow",
      type: "number",
      value: value != null ? value : "",
    });
    inp.addEventListener("input", () => {
      const v = inp.value === "" ? null : Number(inp.value);
      onChange(v);
    });
    return inp;
  }

  function selectInput(value, options, onChange) {
    const sel = el("select", { class: "fe-input fe-select" });
    options.forEach((opt) => {
      const optEl = el("option", { value: opt.value }, opt.label);
      if (String(opt.value) === String(value)) optEl.selected = true;
      sel.appendChild(optEl);
    });
    sel.addEventListener("change", () => { onChange(sel.value); });
    return sel;
  }

  function tagList(tags, onChange) {
    const wrap = el("div", { class: "fe-tags" });
    const arr = Array.isArray(tags) ? [...tags] : [];

    function render() {
      wrap.innerHTML = "";
      arr.forEach((tag, i) => {
        const pill = el("span", { class: "fe-tag" });
        pill.appendChild(el("span", {}, tag));
        const rm = el("button", {
          class: "fe-tag-remove",
          type: "button",
          title: "Remove tag",
          onClick: () => {
            arr.splice(i, 1);
            onChange([...arr]);
            render();
          },
        }, "×");
        pill.appendChild(rm);
        wrap.appendChild(pill);
      });
      const inp = el("input", {
        class: "fe-input fe-input-tag",
        type: "text",
        placeholder: "Add tag…",
      });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          const v = inp.value.trim();
          if (v && !arr.includes(v)) {
            arr.push(v);
            onChange([...arr]);
            render();
          }
        }
      });
      inp.addEventListener("blur", () => {
        const v = inp.value.trim();
        if (v && !arr.includes(v)) {
          arr.push(v);
          onChange([...arr]);
          render();
        }
      });
      wrap.appendChild(inp);
    }
    render();
    return wrap;
  }

  function fieldGroup(label, content) {
    const g = el("div", { class: "fe-group" });
    if (label) g.appendChild(makeLabel(label));
    if (Array.isArray(content)) content.forEach((c) => g.appendChild(c));
    else g.appendChild(content);
    return g;
  }

  function rowGroup(children) {
    const r = el("div", { class: "fe-row" });
    children.forEach((c) => r.appendChild(c));
    return r;
  }

  /* ── Meta section ─────────────────────────────────────── */

  function metaSection(data, onChange) {
    const s = el("div", { class: "fe-meta" });
    s.appendChild(fieldGroup("UID", textInput(data.uid, "Unique identifier", (v) => { data.uid = v; onChange(); })));
    s.appendChild(fieldGroup("Title", textInput(data.title, "Display title", (v) => { data.title = v; onChange(); })));
    s.appendChild(fieldGroup("Description", textArea(data.description, "Brief description", (v) => { data.description = v; onChange(); })));
    s.appendChild(fieldGroup("Language",
      selectInput(data.lang || "en", [
        { value: "en", label: "English" },
        { value: "ar", label: "العربية" },
      ], (v) => { data.lang = v; onChange(); })
    ));
    s.appendChild(fieldGroup("Tags", tagList(data.tags, (v) => { data.tags = v; onChange(); })));
    return s;
  }

  /* ── Question card (shared by quiz + bank) ────────────── */

  function renderQuestionCard(q, index, onChange, onRemove) {
    const card = el("div", { class: "fe-item-card" });
    const header = el("div", { class: "fe-item-header" });
    header.appendChild(el("span", { class: "fe-item-title" }, "Question " + (index + 1)));
    const hRight = el("div", { class: "fe-item-actions" });
    if (onRemove) {
      const delBtn = el("button", { class: "fe-icon-btn danger", type: "button", title: "Remove", onClick: onRemove }, ic(ICONS.remove));
      hRight.appendChild(delBtn);
    }
    header.appendChild(hRight);
    card.appendChild(header);

    const body = el("div", { class: "fe-item-body" });

    body.appendChild(fieldGroup("ID", textInput(q.id, "e.g. q-001", (v) => { q.id = v; onChange(); })));
    body.appendChild(fieldGroup("Question", textArea(q.question, "Question text", (v) => { q.question = v; onChange(); })));

    // Options
    const optsWrap = el("div", { class: "fe-options" });
    optsWrap.appendChild(makeLabel("Options"));
    const optsList = el("div", { class: "fe-options-list" });
    const opts = Array.isArray(q.options) ? q.options : [];

    function renderOptions() {
      optsList.innerHTML = "";
      opts.forEach((opt, oi) => {
        const or = el("div", { class: "fe-option-row" });
        const radio = el("input", {
          type: "radio",
          name: "correct_" + q.id + "_" + index,
          checked: q.correct === oi,
          title: "Correct answer",
        });
        radio.addEventListener("change", () => {
          if (radio.checked) { q.correct = oi; onChange(); }
        });
        or.appendChild(radio);
        const inp = textInput(opt, "Option " + (oi + 1), (v) => {
          opts[oi] = v;
          q.options = [...opts];
          onChange();
        });
        inp.style.flex = "1";
        or.appendChild(inp);
        const rmOpt = el("button", {
          class: "fe-icon-btn danger",
          type: "button",
          title: "Remove option",
          onClick: () => {
            opts.splice(oi, 1);
            if (q.correct === oi) q.correct = 0;
            else if (q.correct > oi) q.correct--;
            q.options = [...opts];
            onChange();
            renderOptions();
          },
        }, ic(ICONS.remove));
        or.appendChild(rmOpt);
        optsList.appendChild(or);
      });
      const addBtn = el("button", { class: "fe-btn-add", type: "button", onClick: () => {
        opts.push("");
        q.options = [...opts];
        onChange();
        renderOptions();
      }}, ic(ICONS.add, 12), " Add option");
      optsList.appendChild(addBtn);
    }
    renderOptions();
    optsWrap.appendChild(optsList);
    body.appendChild(optsWrap);

    body.appendChild(fieldGroup("Explanation (Markdown)", textArea(q.explanation, "Explanation", (v) => { q.explanation = v; onChange(); })));
    body.appendChild(fieldGroup("Tags", tagList(q.tags, (v) => { q.tags = v; onChange(); })));
    if (q.difficulty !== undefined) {
      body.appendChild(fieldGroup("Difficulty (1-5)", numberInput(q.difficulty, (v) => { q.difficulty = v; onChange(); })));
    }

    card.appendChild(body);
    return card;
  }

  /* ── Quiz Editor ──────────────────────────────────────── */

  function renderQuizEditor(container, data, onChange) {
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const wrap = el("div", { class: "fe-editor" });

    function renderAll() {
      wrap.innerHTML = "";
      const listWrap = el("div", { class: "fe-list" });
      listWrap.appendChild(el("div", { class: "fe-list-title" }, "Questions (" + questions.length + ")"));

      questions.forEach((q, i) => {
        const card = renderQuestionCard(q, i, onChange, () => {
          questions.splice(i, 1);
          onChange();
          renderAll();
        });
        listWrap.appendChild(card);
      });

      const addBtn = el("button", { class: "fe-btn-add fe-btn-add-wide", type: "button", onClick: () => {
        questions.push({
          id: "q-" + String(Date.now()).slice(-6),
          question: "",
          options: ["", "", "", ""],
          correct: 0,
          explanation: "",
          tags: [],
          difficulty: 2,
        });
        onChange();
        renderAll();
      }}, ic(ICONS.add, 14), " Add Question");
      listWrap.appendChild(addBtn);
      wrap.appendChild(listWrap);
    }

    container.appendChild(wrap);
    renderAll();
  }

  /* ── Bank Editor ──────────────────────────────────────── */

  function renderBankEditor(container, data, onChange) {
    const passages = Array.isArray(data.passages) ? data.passages : [];
    const wrap = el("div", { class: "fe-editor" });

    function renderAll() {
      wrap.innerHTML = "";
      const listWrap = el("div", { class: "fe-list" });
      listWrap.appendChild(el("div", { class: "fe-list-title" }, "Passages (" + passages.length + ")"));

      passages.forEach((p, i) => {
        const card = el("div", { class: "fe-item-card" });
        const header = el("div", { class: "fe-item-header" });
        header.appendChild(el("span", { class: "fe-item-title" }, "Passage " + (i + 1)));
        const hRight = el("div", { class: "fe-item-actions" });
        hRight.appendChild(el("button", { class: "fe-icon-btn danger", type: "button", title: "Remove", onClick: () => {
          passages.splice(i, 1);
          onChange();
          renderAll();
        }}, ic(ICONS.remove)));
        header.appendChild(hRight);
        card.appendChild(header);

        const body = el("div", { class: "fe-item-body" });
        body.appendChild(fieldGroup("ID", textInput(p.id, "e.g. p-001", (v) => { p.id = v; onChange(); })));
        body.appendChild(fieldGroup("Content", textArea(p.content, "Passage text", (v) => { p.content = v; onChange(); })));

        // Nested questions
        const qs = Array.isArray(p.questions) ? p.questions : [];
        const qWrap = el("div", { class: "fe-nested-list" });
        qWrap.appendChild(makeLabel("Questions"));
        qs.forEach((q, qi) => {
          q.passageId = p.id;
          const qCard = renderQuestionCard(q, qi, onChange, () => {
            qs.splice(qi, 1);
            onChange();
            renderAll();
          });
          qWrap.appendChild(qCard);
        });
        const addQ = el("button", { class: "fe-btn-add", type: "button", onClick: () => {
          qs.push({
            id: "bq-" + String(Date.now()).slice(-6),
            passageId: p.id,
            question: "",
            options: ["", "", "", ""],
            correct: 0,
            explanation: "",
            tags: [],
            difficulty: 2,
          });
          onChange();
          renderAll();
        }}, ic(ICONS.add, 12), " Add Question");
        qWrap.appendChild(addQ);
        body.appendChild(qWrap);

        card.appendChild(body);
        listWrap.appendChild(card);
      });

      const addBtn = el("button", { class: "fe-btn-add fe-btn-add-wide", type: "button", onClick: () => {
        passages.push({
          id: "p-" + String(Date.now()).slice(-6),
          content: "",
          questions: [],
        });
        onChange();
        renderAll();
      }}, ic(ICONS.add, 14), " Add Passage");
      listWrap.appendChild(addBtn);
      wrap.appendChild(listWrap);
    }

    container.appendChild(wrap);
    renderAll();
  }

  /* ── Flashcard Editor ─────────────────────────────────── */

  function renderFlashcardEditor(container, data, onChange) {
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const subdecks = Array.isArray(data.subdecks) ? data.subdecks : [];
    const wrap = el("div", { class: "fe-editor" });

    function renderAll() {
      wrap.innerHTML = "";

      // Subdecks
      if (subdecks.length > 0 || data.subdecks) {
        const sdWrap = el("div", { class: "fe-list" });
        sdWrap.appendChild(el("div", { class: "fe-list-title" }, "Subdecks (" + subdecks.length + ")"));
        subdecks.forEach((sd, si) => {
          const card = el("div", { class: "fe-item-card fe-item-card-sm" });
          const body = el("div", { class: "fe-item-body" });
          body.appendChild(fieldGroup("ID", textInput(sd.id, "", (v) => { sd.id = v; onChange(); })));
          body.appendChild(fieldGroup("Title", textInput(sd.title, "Subdeck name", (v) => { sd.title = v; onChange(); })));
          const hRight = el("div", { class: "fe-item-actions" });
          hRight.appendChild(el("button", { class: "fe-icon-btn danger", type: "button", onClick: () => {
            subdecks.splice(si, 1);
            onChange();
            renderAll();
          }}, ic(ICONS.remove)));
          card.appendChild(hRight);
          card.appendChild(body);
          sdWrap.appendChild(card);
        });
        const addSd = el("button", { class: "fe-btn-add", type: "button", onClick: () => {
          subdecks.push({ id: "sd-" + String(Date.now()).slice(-6), title: "" });
          onChange();
          renderAll();
        }}, ic(ICONS.add, 12), " Add Subdeck");
        sdWrap.appendChild(addSd);
        wrap.appendChild(sdWrap);
      }

      // Cards
      const listWrap = el("div", { class: "fe-list" });
      listWrap.appendChild(el("div", { class: "fe-list-title" }, "Cards (" + cards.length + ")"));

      cards.forEach((c, i) => {
        const card = el("div", { class: "fe-item-card" });
        const header = el("div", { class: "fe-item-header" });
        header.appendChild(el("span", { class: "fe-item-title" }, "Card " + (i + 1)));
        const hRight = el("div", { class: "fe-item-actions" });
        hRight.appendChild(el("button", { class: "fe-icon-btn danger", type: "button", onClick: () => {
          cards.splice(i, 1);
          onChange();
          renderAll();
        }}, ic(ICONS.remove)));
        header.appendChild(hRight);
        card.appendChild(header);

        const body = el("div", { class: "fe-item-body" });
        body.appendChild(fieldGroup("ID", textInput(c.id, "e.g. fc-001", (v) => { c.id = v; onChange(); })));
        body.appendChild(fieldGroup("Front", textArea(c.front, "Question side", (v) => { c.front = v; onChange(); })));
        body.appendChild(fieldGroup("Back", textArea(c.back, "Answer side", (v) => { c.back = v; onChange(); })));
        if (subdecks.length > 0) {
          body.appendChild(fieldGroup("Subdeck", selectInput(c.subdeckId || "", [
            { value: "", label: "None" },
            ...subdecks.map((sd) => ({ value: sd.id, label: sd.title || sd.id })),
          ], (v) => { c.subdeckId = v || undefined; onChange(); })));
        }
        body.appendChild(fieldGroup("Tags", tagList(c.tags, (v) => { c.tags = v; onChange(); })));
        card.appendChild(body);
        listWrap.appendChild(card);
      });

      const addBtn = el("button", { class: "fe-btn-add fe-btn-add-wide", type: "button", onClick: () => {
        cards.push({
          id: "fc-" + String(Date.now()).slice(-6),
          front: "",
          back: "",
          tags: [],
        });
        onChange();
        renderAll();
      }}, ic(ICONS.add, 14), " Add Card");
      listWrap.appendChild(addBtn);
      wrap.appendChild(listWrap);
    }

    container.appendChild(wrap);
    renderAll();
  }

  /* ── Written Editor ───────────────────────────────────── */

  function renderWrittenEditor(container, data, onChange) {
    const prompts = Array.isArray(data.prompts) ? data.prompts : [];
    const wrap = el("div", { class: "fe-editor" });

    function renderAll() {
      wrap.innerHTML = "";
      const listWrap = el("div", { class: "fe-list" });
      listWrap.appendChild(el("div", { class: "fe-list-title" }, "Prompts (" + prompts.length + ")"));

      prompts.forEach((p, i) => {
        const card = el("div", { class: "fe-item-card" });
        const header = el("div", { class: "fe-item-header" });
        header.appendChild(el("span", { class: "fe-item-title" }, "Prompt " + (i + 1)));
        const hRight = el("div", { class: "fe-item-actions" });
        hRight.appendChild(el("button", { class: "fe-icon-btn danger", type: "button", onClick: () => {
          prompts.splice(i, 1);
          onChange();
          renderAll();
        }}, ic(ICONS.remove)));
        header.appendChild(hRight);
        card.appendChild(header);

        const body = el("div", { class: "fe-item-body" });
        body.appendChild(fieldGroup("ID", textInput(p.id, "e.g. w-001", (v) => { p.id = v; onChange(); })));
        body.appendChild(fieldGroup("Prompt", textArea(p.prompt, "Essay prompt", (v) => { p.prompt = v; onChange(); })));
        body.appendChild(fieldGroup("Model Answer (Markdown)", textArea(p.modelAnswer, "Reference answer", (v) => { p.modelAnswer = v; onChange(); })));
        body.appendChild(rowGroup([
          fieldGroup("Explanation (Markdown)", textArea(p.explanation, "Teaching notes", (v) => { p.explanation = v; onChange(); })),
        ]));

        // Rubric — text field, one item per line
        body.appendChild(fieldGroup("Rubric", textArea(Array.isArray(p.rubric) ? p.rubric.join("\n") : "", "One rubric item per line", (v) => { p.rubric = v.split("\n").filter(Boolean); onChange(); })));
        body.appendChild(fieldGroup("Tags", tagList(p.tags, (v) => { p.tags = v; onChange(); })));

        // Word limit — small box appended to the card footer
        const footerRow = el("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", padding: "0.5rem 0.75rem", borderTop: "1px solid var(--border)", background: "var(--surface-2)", fontSize: "0.75rem" } });
        footerRow.appendChild(el("span", { style: { color: "var(--text-muted)" } }, "Word limit:"));
        const wl = el("input", { type: "number", value: p.wordLimit != null ? p.wordLimit : 500, style: { width: "64px", padding: "0.1875rem 0.375rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: "0.75rem", textAlign: "center" } });
        wl.addEventListener("input", () => { p.wordLimit = wl.value === "" ? null : Number(wl.value); onChange(); });
        footerRow.appendChild(wl);
        footerRow.appendChild(el("span", { style: { color: "var(--text-dim)" } }, "words"));
        card.appendChild(footerRow);

        // Children (sub-questions)
        const children = Array.isArray(p.children) ? p.children : [];
        if (children.length > 0 || p.children) {
          const cWrap = el("div", { class: "fe-nested-list" });
          cWrap.appendChild(makeLabel("Children"));
          children.forEach((ch, ci) => {
            const chCard = el("div", { class: "fe-item-card fe-item-card-sm" });
            const chBody = el("div", { class: "fe-item-body" });
            chBody.appendChild(fieldGroup("ID", textInput(ch.id, "", (v) => { ch.id = v; onChange(); })));
            chBody.appendChild(fieldGroup("Label", textInput(ch.label, "e.g. Part A", (v) => { ch.label = v; onChange(); })));
            chBody.appendChild(fieldGroup("Question", textArea(ch.question, "", (v) => { ch.question = v; onChange(); })));
            chBody.appendChild(fieldGroup("Model Answer", textArea(ch.modelAnswer, "", (v) => { ch.modelAnswer = v; onChange(); })));
            const chRight = el("div", { class: "fe-item-actions" });
            chRight.appendChild(el("button", { class: "fe-icon-btn danger", type: "button", onClick: () => {
              children.splice(ci, 1);
              onChange();
              renderAll();
            }}, ic(ICONS.remove)));
            chCard.appendChild(chRight);
            chCard.appendChild(chBody);
            cWrap.appendChild(chCard);
          });
          const addCh = el("button", { class: "fe-btn-add", type: "button", onClick: () => {
            children.push({ id: "c-" + String(Date.now()).slice(-6), label: "", question: "", modelAnswer: "" });
            onChange();
            renderAll();
          }}, ic(ICONS.add, 12), " Add Child");
          cWrap.appendChild(addCh);
          body.appendChild(cWrap);
        }

        card.appendChild(body);
        listWrap.appendChild(card);
      });

      const addBtn = el("button", { class: "fe-btn-add fe-btn-add-wide", type: "button", onClick: () => {
        prompts.push({
          id: "w-" + String(Date.now()).slice(-6),
          prompt: "",
          modelAnswer: "",
          rubric: [],
          wordLimit: 500,
          explanation: "",
          tags: [],
        });
        onChange();
        renderAll();
      }}, ic(ICONS.add, 14), " Add Prompt");
      listWrap.appendChild(addBtn);
      wrap.appendChild(listWrap);
    }

    container.appendChild(wrap);
    renderAll();
  }

  /* ── OSCE Editor ──────────────────────────────────────── */

  function renderOsceEditor(container, data, onChange) {
    const stations = Array.isArray(data.stations) ? data.stations : [];
    const wrap = el("div", { class: "fe-editor" });

    function renderAll() {
      wrap.innerHTML = "";
      const listWrap = el("div", { class: "fe-list" });
      listWrap.appendChild(el("div", { class: "fe-list-title" }, "Stations (" + stations.length + ")"));

      stations.forEach((s, i) => {
        const card = el("div", { class: "fe-item-card" });
        const header = el("div", { class: "fe-item-header" });
        header.appendChild(el("span", { class: "fe-item-title" }, "Station " + (i + 1) + ": " + (s.title || "")));
        const hRight = el("div", { class: "fe-item-actions" });
        hRight.appendChild(el("button", { class: "fe-icon-btn danger", type: "button", onClick: () => {
          stations.splice(i, 1);
          onChange();
          renderAll();
        }}, ic(ICONS.remove)));
        header.appendChild(hRight);
        card.appendChild(header);

        const body = el("div", { class: "fe-item-body" });

        // Core fields
        body.appendChild(fieldGroup("ID", textInput(s.id, "e.g. osce-001", (v) => { s.id = v; onChange(); })));
        body.appendChild(fieldGroup("Title", textInput(s.title, "Station title", (v) => { s.title = v; onChange(); renderAll(); })));
        body.appendChild(rowGroup([
          fieldGroup("Type", selectInput(s.type || "history", [
            { value: "history", label: "History Taking" },
            { value: "data-interp", label: "Data Interpretation" },
          ], (v) => { s.type = v; onChange(); })),
          fieldGroup("Specialty", textInput(s.specialty, "", (v) => { s.specialty = v; onChange(); })),
          fieldGroup("Difficulty", selectInput(s.difficulty || "Medium", [
            { value: "Easy", label: "Easy" },
            { value: "Medium", label: "Medium" },
            { value: "Hard", label: "Hard" },
          ], (v) => { s.difficulty = v; onChange(); })),
        ]));
        body.appendChild(fieldGroup("Task", textArea(s.task, "Task description", (v) => { s.task = v; onChange(); })));
        body.appendChild(fieldGroup("Time (minutes)", numberInput(s.time, (v) => { s.time = v; onChange(); })));

        // Examiner
        body.appendChild(el("div", { class: "fe-section-label" }, "Examiner"));
        body.appendChild(rowGroup([
          fieldGroup("Name", textInput(s.examiner?.name, "", (v) => {
            if (!s.examiner) s.examiner = { name: "", title: "" };
            s.examiner.name = v; onChange();
          })),
          fieldGroup("Title", textInput(s.examiner?.title, "", (v) => {
            if (!s.examiner) s.examiner = { name: "", title: "" };
            s.examiner.title = v; onChange();
          })),
        ]));

        // Patient
        body.appendChild(el("div", { class: "fe-section-label" }, "Patient"));
        body.appendChild(rowGroup([
          fieldGroup("Name", textInput(s.patient?.name, "", (v) => {
            if (!s.patient) s.patient = {};
            s.patient.name = v; onChange();
          })),
          fieldGroup("Age", numberInput(s.patient?.age, (v) => {
            if (!s.patient) s.patient = {};
            s.patient.age = v; onChange();
          })),
          fieldGroup("Gender", selectInput(s.patient?.gender || "male", [
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ], (v) => {
            if (!s.patient) s.patient = {};
            s.patient.gender = v; onChange();
          })),
        ]));
        body.appendChild(fieldGroup("Avatar Seed", textInput(s.patient?.avatarSeed, "", (v) => {
          if (!s.patient) s.patient = {};
          s.patient.avatarSeed = v; onChange();
        })));
        body.appendChild(fieldGroup("Opening", textArea(s.patient?.opening, "Patient's first line", (v) => {
          if (!s.patient) s.patient = {};
          s.patient.opening = v; onChange();
        })));

        // Hidden Profile
        body.appendChild(el("div", { class: "fe-section-label" }, "Hidden Profile"));
        if (!s.hiddenProfile) s.hiddenProfile = { diagnosis: "", keySymptoms: [], redFlags: [], pastHistory: [], vitalSigns: "" };
        const hp = s.hiddenProfile;
        body.appendChild(fieldGroup("Diagnosis", textArea(hp.diagnosis, "Working diagnosis", (v) => { hp.diagnosis = v; onChange(); })));
        body.appendChild(fieldGroup("Key Symptoms", tagList(hp.keySymptoms, (v) => { hp.keySymptoms = v; onChange(); })));
        body.appendChild(fieldGroup("Red Flags", tagList(hp.redFlags, (v) => { hp.redFlags = v; onChange(); })));
        body.appendChild(fieldGroup("Past History", tagList(hp.pastHistory, (v) => { hp.pastHistory = v; onChange(); })));
        body.appendChild(fieldGroup("Vital Signs", textArea(hp.vitalSigns, "BP, HR, RR, O2 sat, Temp", (v) => { hp.vitalSigns = v; onChange(); })));

        // Rubric
        body.appendChild(el("div", { class: "fe-section-label" }, "Rubric"));
        if (!s.rubric) s.rubric = { mustAsk: [], bonus: [] };
        body.appendChild(fieldGroup("Must Ask", tagList(s.rubric.mustAsk, (v) => { s.rubric.mustAsk = v; onChange(); })));
        body.appendChild(fieldGroup("Bonus", tagList(s.rubric.bonus, (v) => { s.rubric.bonus = v; onChange(); })));

        // Questions
        const qs = Array.isArray(s.questions) ? s.questions : [];
        const qWrap = el("div", { class: "fe-nested-list" });
        qWrap.appendChild(makeLabel("Questions"));
        qs.forEach((q, qi) => {
          const qCard = el("div", { class: "fe-item-card fe-item-card-sm" });
          const qBody = el("div", { class: "fe-item-body" });
          qBody.appendChild(fieldGroup("Question", textArea(q.question, "", (v) => { q.question = v; onChange(); })));
          qBody.appendChild(fieldGroup("Answer", textArea(q.answer, "", (v) => { q.answer = v; onChange(); })));
          qBody.appendChild(fieldGroup("Rubric", textArea(q.rubric, "", (v) => { q.rubric = v; onChange(); })));
          const qRight = el("div", { class: "fe-item-actions" });
          qRight.appendChild(el("button", { class: "fe-icon-btn danger", type: "button", onClick: () => {
            qs.splice(qi, 1);
            onChange();
            renderAll();
          }}, ic(ICONS.remove)));
          qCard.appendChild(qRight);
          qCard.appendChild(qBody);
          qWrap.appendChild(qCard);
        });
        const addQ = el("button", { class: "fe-btn-add", type: "button", onClick: () => {
          qs.push({ question: "", answer: "", rubric: "" });
          onChange();
          renderAll();
        }}, ic(ICONS.add, 12), " Add Question");
        qWrap.appendChild(addQ);
        body.appendChild(qWrap);

        card.appendChild(body);
        listWrap.appendChild(card);
      });

      const addBtn = el("button", { class: "fe-btn-add fe-btn-add-wide", type: "button", onClick: () => {
        stations.push({
          id: "osce-" + String(Date.now()).slice(-6),
          title: "",
          type: "history",
          specialty: "",
          difficulty: "Medium",
          task: "",
          time: 10,
          examiner: { name: "", title: "" },
          patient: { name: "", age: 0, gender: "male", avatarSeed: "", opening: "" },
          hiddenProfile: { diagnosis: "", keySymptoms: [], redFlags: [], pastHistory: [], vitalSigns: "" },
          rubric: { mustAsk: [], bonus: [] },
          dataPresented: null,
          questions: [],
        });
        onChange();
        renderAll();
      }}, ic(ICONS.add, 14), " Add Station");
      listWrap.appendChild(addBtn);
      wrap.appendChild(listWrap);
    }

    container.appendChild(wrap);
    renderAll();
  }

  /* ── Detect content type from parsed object ───────────── */

  function detectType(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.questions && Array.isArray(parsed.questions)) {
      if (parsed.questions[0] && parsed.questions[0].front) return "flashcard";
      return "quiz";
    }
    if (parsed.passages) return "bank";
    if (parsed.prompts) return "written";
    if (parsed.stations) return "osce";
    if (parsed.cards) return "flashcard";
    if (parsed.type && ["quiz", "bank", "flashcard", "written", "osce"].includes(parsed.type)) return parsed.type;
    return null;
  }

  /* ── Main entry ───────────────────────────────────────── */

  function render(container, path, content, onChange) {
    const type = detectType(content);
    if (!type) return false;

    container.innerHTML = "";
    container.classList.add("fe-active");

    // Type badge header
    const badge = el("div", { class: "fe-type-badge" });
    badge.textContent = "Editing: " + type.toUpperCase();
    container.appendChild(badge);

    switch (type) {
      case "quiz":
        renderQuizEditor(container, content, onChange);
        break;
      case "bank":
        renderBankEditor(container, content, onChange);
        break;
      case "flashcard":
        renderFlashcardEditor(container, content, onChange);
        break;
      case "written":
        renderWrittenEditor(container, content, onChange);
        break;
      case "osce":
        renderOsceEditor(container, content, onChange);
        break;
    }

    return true;
  }

  /* ── Export ───────────────────────────────────────────── */

  window.OslerAdminContentEditor = { render, detectType };
})();
