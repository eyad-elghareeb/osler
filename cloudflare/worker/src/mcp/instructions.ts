/**
 * MCP server instructions + prompt templates.
 *
 * Pure data — returned in the MCP `initialize` response so AI agents understand
 * Osler content schemas, workflows, privilege tiers, tricky metadata rules,
 * HTML article rules, safeguards, and manifest mechanics.
 */

export const SERVER_NAME = "osler-admin";
export const SERVER_VERSION = "2.2.0";
export const PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INSTRUCTIONS = `# Osler Medical Study Platform — Content Authoring & Admin MCP Server

You are connected to the Osler medical-education platform MCP server.

## 1. Privilege Tiers & Security Model

Your API token has one of two privilege levels:

1. **content_admin** (Authoring & Review Queue):
   - Create and edit drafts (\`create_content_draft\`, \`update_draft_body\`, \`create_content_pack\`).
   - Upload and delete pack assets (\`upload_asset\`, \`delete_asset\`).
   - Validate JSON payloads against engine schemas (\`validate_content\`).
   - Submit drafts for human admin review (\`submit_for_review\`).
   - Read published student files and manifests (\`read_content_file\`, \`list_content_files\`, \`get_content_manifest\`).
   - View own drafts, review queue, and instance overview.

2. **admin** (Full Unrestricted Access):
   - **WARNING**: Admin tokens have direct, irreversible write access to production database records, live student files, and platform configuration.
   - Directly publish content (\`publish_content\`, \`create_content_pack\` with \`publishImmediately: true\`).
   - Review queue actions: Approve (\`approve_content\`) or reject (\`reject_content\`).
   - Retract published items (\`unpublish_content\`).
   - Permanently delete objects and storage files (\`delete_content_object\`).
   - Hotfix live student files directly (\`update_published_content\`).
   - Edit library article sidecar metadata (\`update_article_metadata\`).
   - Read and modify platform site configuration (\`read_config\`, \`update_config\`).
   - Trigger smart incremental manifest updates (\`smart_update_manifest\`).
   - Inspect full audit trails (\`get_audit_trail\`).

---

## 2. Safety Safeguards & Best Practices

1. **Two-Step Confirmation for Deletion (\`delete_content_object\`)**:
   - Calling \`delete_content_object\` without \`confirm: true\` returns a detailed damage summary and a deterministic \`continueToken\`.
   - To proceed with deletion, re-invoke \`delete_content_object\` with \`"confirm": true\` and \`"continueToken": "<token>"\`.
   - Never bypass confirmation; always verify the target object before proceeding.

2. **Optimistic Concurrency on Live Hotfixes (\`update_published_content\`)**:
   - When modifying a published file under \`content-files/\`, first read it via \`read_content_file\`.
   - \`read_content_file\` returns a \`bodySha1\` hash of the file.
   - Pass this hash as \`expectedCurrentBody\` when calling \`update_published_content\`. If another process edited the file in the meantime, the hotfix is safely refused rather than silently overwriting work.

3. **Session Orientation**:
   - Call \`get_instance_overview\` at the start of a session to check token scope, current content counts, and the live content version stamp.
   - Call \`list_review_queue\` to inspect pending items awaiting review or rejected items needing revisions.
   - Call \`get_content_version\` to verify the current client-facing cache-buster stamp.

4. **PDF Import**:
   - \`parse_qbank_pdf\` and \`parse_written_pdf\` turn exam-style PDFs (supplied inline as base64) into draft quiz/written bodies via layout heuristics — numbered questions, A–E options, inline or tabular answer keys, marks annotations, model answers, marking schemes.
   - Parsing is best-effort: check the returned \`warnings\` and resolve every missing answer before uploading; use \`parse_pdf\` for raw page text when the layout is unrecognized (e.g. scanned PDFs return no text at all).
   - Pipeline: parse → review/fix the draft → \`validate_content\` → \`create_content_pack\`.

---

## 3. Content Engine Types & JSON Schemas

### 1. Quiz (USMLE Best-of-Five MCQs)
\`\`\`json
{
  "questions": [
    {
      "id": "q1",
      "question": "A 45-year-old male presents with acute crushing chest pain...",
      "options": ["Aortic dissection", "Acute STEMI", "Pericarditis", "PE", "Pneumothorax"],
      "correct": 1,
      "explanation": "STEMI is characterized by ST elevation and troponin rise...",
      "difficulty": "medium",
      "tags": ["Cardiology", "Emergency"]
    }
  ]
}
\`\`\`
- \`correct\` is zero-based index (0 to 4).
- Must have at least 2 options (standard: 5).
- Image paths: \`images/filename.png\` or \`filename.png\` (relative to the pack folder). Absolute \`https://\` (or \`//\`) CDN URLs and \`data:image/…\` URIs also pass through; HTML \`<img src="…">\` is supported in rich text.
- Any quiz/bank/written pack may carry an optional top-level \`chapters\` array (see §3.6 Mixed); sessions let students filter by chapter.

### 2. Question Bank (Case Passages with Sub-questions)
\`\`\`json
{
  "passages": [
    {
      "id": "p1",
      "content": "A 62-year-old female with long-standing hypertension...",
      "questions": [
        {
          "id": "q1_1",
          "question": "What is the initial diagnostic test of choice?",
          "options": ["Transthoracic Echocardiogram", "Chest CT Angiography", "Cardiac MRI", "Stress Test"],
          "correct": 1,
          "explanation": "CTA chest has high sensitivity for acute aortic syndromes."
        }
      ]
    }
  ]
}
\`\`\`

### 3. Flashcards (Atomic Cards & Cloze Deletions)
\`\`\`json
{
  "cards": [
    {
      "id": "c1",
      "front": "What is the classic triad of aortic stenosis?",
      "back": "SAD: Syncope, Angina, Dyspnea on exertion"
    },
    {
      "id": "c2",
      "type": "cloze",
      "text": "The first-line drug for anaphylaxis is {{c1::intramuscular epinephrine::drug}} at a dose of {{c2::0.3 to 0.5 mg::dose}}."
    }
  ]
}
\`\`\`

### 4. OSCE Clinical Stations (Simulations & Objective Rubrics)
\`\`\`json
{
  "stations": [
    {
      "id": "osce-stemi-01",
      "title": "Acute Chest Pain Management",
      "specialty": "Emergency Medicine",
      "difficulty": "medium",
      "type": "management",
      "time": 8,
      "task": "Take a focused history, interpret the ECG, and initiate emergency management.",
      "patient": {
        "name": "John Miller",
        "age": 58,
        "gender": "Male",
        "chiefComplaint": "Crushing chest pain radiating to left arm for 45 minutes",
        "vitalSigns": { "bp": "150/90", "hr": 96, "rr": 20, "spo2": "97% on room air" }
      },
      "hiddenProfile": {
        "medicalHistory": "Hypertension, heavy smoker (30 pack-years)",
        "patientResponses": { "painScale": "8 out of 10" }
      },
      "rubric": [
        { "id": "r1", "label": "Administered Aspirin 300mg chewable", "points": 2 },
        { "id": "r2", "label": "Ordered urgent 12-lead ECG", "points": 2 }
      ]
    }
  ]
}
\`\`\`

### 5. Written Prompts (Clinical Scenarios & Rubrics)
\`\`\`json
{
  "prompts": [
    {
      "id": "wp1",
      "prompt": "Outline the diagnostic criteria and initial fluid resuscitation protocol for severe diabetic ketoacidosis (DKA).",
      "sampleAnswer": "DKA criteria: Hyperglycemia >200 mg/dL, pH <7.3, bicarbonate <15 mEq/L, ketonemia...",
      "rubric": [
        { "id": "r1", "criterion": "Identified biochemical criteria (pH, HCO3, glucose, ketones)", "maxPoints": 5 },
        { "id": "r2", "criterion": "Specified 0.9% normal saline initial fluid rate and potassium replacement rules", "maxPoints": 5 }
      ]
    }
  ]
}
\`\`\`

### 6. Mixed Packs — MCQ + Written with Chapters
\`\`\`json
{
  "type": "mixed",
  "chapters": [
    { "id": "ch-arr", "title": "Arrhythmias", "start": 1, "end": 20 },
    { "id": "ch-hf", "title": "Heart Failure", "questionIds": ["q-hf-01", "w-hf-01"] }
  ],
  "questions": [{ "id": "q-hf-01", "question": "…", "options": ["…"], "correct": 2, "explanation": "…" }],
  "prompts": [{ "id": "w-hf-01", "prompt": "…", "rubric": ["…"], "modelAnswer": "…" }]
}
\`\`\`
- A pack holding MCQ content (\`questions\` and/or \`passages\`) alongside written \`prompts\` is typed \`"mixed"\` (auto-detected when both are present). Validate with contentType \`"mixed"\`: needs BOTH MCQ content and written \`prompts\`.
- Chapter entries: \`{ id, title, description? }\` plus one addressing mode — 1-based index ranges (\`start\`/\`end\`, \`from\`/\`to\`, or \`range: "1-40"\`), explicit \`questionIds\`/\`passageIds\`, or per-question \`chapter\`/\`chapterId\` fields.

### 7. Video Lessons
\`\`\`json
{
  "videos": [
    {
      "id": "v1",
      "title": "Approach to Wide Complex Tachycardia",
      "duration": 420,
      "source": { "type": "youtube", "id": "dQw4w9WgXcQ" }
    }
  ]
}
\`\`\`

### 8. Library Articles with Sidecar Metadata
- File format: \`<slug>.md\` or \`<slug>.html\`
- Sidecar file: \`<slug>.meta.json\` located adjacent to the article file.
\`\`\`json
{
  "title": "Asthma: Diagnosis & Stepwise Management",
  "specialty": "Pulmonology",
  "system": "Respiratory",
  "readTimeMin": 8,
  "tags": ["Asthma", "Spirometry", "Inhalers", "GINA Guidelines"],
  "lang": "en"
}
\`\`\`

---

## 4. Manifest Versioning & Cache-Busting

- Osler maintains category manifests under \`content-manifests/<category>/manifest.json\`.
- Whenever content is published, unpublished, deleted, or edited, the smart diff engine automatically updates node summaries and advances the platform content version stamp.
- Connected student clients poll \`/v1/content-version\` and automatically cache-bust manifest URLs (\`?v=<stamp>\`), making new and updated content available instantly without requiring hard browser refreshes.
`;

export interface McpPromptDef {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  build(args: Record<string, string>): string;
}

export const PROMPTS: McpPromptDef[] = [
  {
    name: "qbank_from_pdf",
    title: "QBank pack from PDF/Notes",
    description: "Parse a source document into an Osler best-of-five quiz pack with explanations, validate, and stage/publish.",
    arguments: [
      { name: "sourceDescription", description: "Path/text/URL of source medical text", required: true },
      { name: "packTitle", description: "Display title for the new pack" },
      { name: "targetCategory", description: 'Subfolder path (e.g. "cardiology/ecg")' },
      { name: "language", description: '"en" or "ar"' },
    ],
    build(args) {
      return [
        `Source: ${args.sourceDescription}`,
        args.packTitle ? `Pack title: ${args.packTitle}` : "",
        args.targetCategory ? `Target category path: ${args.targetCategory}` : "",
        args.language ? `Language: ${args.language}` : "",
        "",
        "Instructions:",
        "1. Read and analyze the clinical source material thoroughly.",
        "2. Formulate USMLE-style clinical vignettes with best-of-5 options, 0-indexed correct answer, and in-depth teaching explanations.",
        "3. Assemble JSON object matching { \"questions\": [...] }.",
        "4. Validate with `validate_content`.",
        "5. Upload with `create_content_pack`.",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "article_with_sidecar",
    title: "Author Library Article with Sidecar Meta",
    description: "Create a rich markdown or HTML library article with diagrams, expandable pearls, and structured sidecar metadata.",
    arguments: [
      { name: "title", description: "Article title", required: true },
      { name: "specialty", description: "Medical specialty (e.g. Cardiology, Pulmonology)", required: true },
      { name: "path", description: 'Relative path (e.g. "cardiology/ischemic/stemi.md")', required: true },
      { name: "body", description: "Article body in GFM markdown or sanitized HTML", required: true },
      { name: "tags", description: "Comma-separated search tags" },
    ],
    build(args) {
      return [
        `Title: ${args.title}`,
        `Specialty: ${args.specialty}`,
        `Path: ${args.path}`,
        `Tags: ${args.tags || ""}`,
        "",
        "Instructions:",
        "1. Write the article body using structured headings, mermaid diagrams for clinical pathways, and <details> for high-yield pearls.",
        "2. Upload the article draft or student file.",
        "3. Update the sidecar metadata via `update_article_metadata` with title, specialty, tags, and readTimeMin.",
      ].join("\n");
    },
  },
  {
    name: "flashcards_from_notes",
    title: "Flashcard deck from notes",
    description: "Turn lecture notes, a PDF, or any source text into an SM-2-ready flashcard deck mixing basic and cloze cards.",
    arguments: [
      { name: "sourceDescription", description: "Path/text/URL of the source material", required: true },
      { name: "deckTitle", description: "Display title for the new deck" },
      { name: "targetCategory", description: 'Subfolder path (e.g. "pharm/antibiotics")' },
      { name: "language", description: '"en" or "ar"' },
      { name: "clozeRatio", description: "Rough share of cloze cards, e.g. \"0.5\" (default: mix ~50/50)" },
    ],
    build(args) {
      return [
        `Source: ${args.sourceDescription}`,
        args.deckTitle ? `Deck title: ${args.deckTitle}` : "",
        args.targetCategory ? `Target category path: ${args.targetCategory}` : "",
        args.language ? `Language: ${args.language}` : "",
        args.clozeRatio ? `Cloze ratio: ${args.clozeRatio}` : "",
        "",
        "Instructions:",
        "1. Read the source material and extract atomic, testable facts — one concept per card.",
        "2. Write basic cards as crisp question → answer pairs, and cloze cards using Anki {{c1::answer::hint}} syntax (number multiple clozes per card when they belong to one fact).",
        "3. Assemble JSON matching { \"cards\": [...] } — basic cards need id/front/back; cloze cards need id/type:\"cloze\"/text.",
        "4. Validate with `validate_content`, then upload with `create_content_pack`.",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "osce_station_from_case",
    title: "OSCE station from a case",
    description: "Author a full OSCE station — patient profile, hidden state, exam task, and a scored rubric — from a clinical case description.",
    arguments: [
      { name: "caseDescription", description: "The clinical case, presentation, or source text", required: true },
      { name: "stationTitle", description: "Display title for the station" },
      { name: "targetCategory", description: 'Subfolder path (e.g. "emergency/chest-pain")' },
      { name: "difficulty", description: "\"easy\", \"medium\", or \"hard\"" },
      { name: "timeMinutes", description: "Station time limit in minutes (default 8)" },
    ],
    build(args) {
      return [
        `Case: ${args.caseDescription}`,
        args.stationTitle ? `Station title: ${args.stationTitle}` : "",
        args.targetCategory ? `Target category path: ${args.targetCategory}` : "",
        args.difficulty ? `Difficulty: ${args.difficulty}` : "",
        args.timeMinutes ? `Time limit: ${args.timeMinutes} min` : "",
        "",
        "Instructions:",
        "1. Design the station: patient name/age/gender, chief complaint, vital signs, a focused task, and a hidden profile (history + responses) the simulated patient keeps until asked.",
        "2. Write an objective rubric — 8-15 checkable items with points, covering history, examination, interpretation, and management.",
        "3. Assemble JSON matching { \"stations\": [...] } (see server instructions §3.4 for the exact shape).",
        "4. Validate with `validate_content`, then upload with `create_content_pack`.",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "written_set_from_topic",
    title: "Written set from a topic",
    description: "Create long-form written assignments: clinical prompts with model answers and point-allocated marking rubrics.",
    arguments: [
      { name: "topic", description: "Topic or source material for the prompts", required: true },
      { name: "setTitle", description: "Display title for the written set" },
      { name: "targetCategory", description: 'Subfolder path (e.g. "pathology/inflammation")' },
      { name: "count", description: "Number of prompts to author (default 3)" },
      { name: "language", description: '"en" or "ar"' },
    ],
    build(args) {
      return [
        `Topic: ${args.topic}`,
        args.setTitle ? `Set title: ${args.setTitle}` : "",
        args.targetCategory ? `Target category path: ${args.targetCategory}` : "",
        args.count ? `Prompts: ${args.count}` : "",
        args.language ? `Language: ${args.language}` : "",
        "",
        "Instructions:",
        "1. Author structured clinical prompts that test reasoning and management, not recall alone.",
        "2. For each prompt write a model answer and a rubric with 4-8 criteria, each carrying maxPoints.",
        "3. Assemble JSON matching { \"prompts\": [...] } (see server instructions §3.5).",
        "4. Validate with `validate_content`, then upload with `create_content_pack`.",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "content_quality_review",
    title: "Review a pack's quality",
    description: "Audit an existing pack (or draft) for medical accuracy, schema compliance, and house style — returns a prioritized fix list you can apply.",
    arguments: [
      { name: "objectTitleOrId", description: "Content object id or title to review", required: true },
      { name: "focus", description: "Optional focus area: \"accuracy\", \"style\", \"difficulty\", \"schema\"" },
    ],
    build(args) {
      return [
        `Target: ${args.objectTitleOrId}`,
        args.focus ? `Focus: ${args.focus}` : "",
        "",
        "Instructions:",
        "1. Locate the object with `list_content_objects`, then fetch its body with `get_content_object`.",
        "2. Read the matching engine schema from the server instructions and check the body against it (or run `validate_content` directly).",
        "3. Review medical correctness, explanation quality, difficulty spread, tag hygiene, and house style (British/US consistency, zero-based `correct` index, image paths under images/).",
        "4. Produce a prioritized fix list; apply safe fixes with `update_draft_body` (or `update_published_content` with the bodySha1 guard, admin scope) and re-validate.",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "translate_pack",
    title: "Translate a pack",
    description: "Translate an existing content pack into Arabic (or another target language) while preserving JSON schema, ids, and image references.",
    arguments: [
      { name: "objectTitleOrId", description: "Content object id or title to translate", required: true },
      { name: "targetLanguage", description: "Target language (default \"ar\")", required: true },
      { name: "newPackTitle", description: "Title for the translated copy" },
    ],
    build(args) {
      return [
        `Target object: ${args.objectTitleOrId}`,
        `Target language: ${args.targetLanguage}`,
        args.newPackTitle ? `New pack title: ${args.newPackTitle}` : "",
        "",
        "Instructions:",
        "1. Fetch the source with `list_content_objects` + `get_content_object` (or `read_content_file` for published packs).",
        "2. Translate all user-facing strings — keep ids, keys, image paths, and the JSON shape byte-compatible; adapt clinical terminology to the target locale's conventions rather than translating literally.",
        "3. Set the pack's lang field to the target language.",
        "4. Validate with `validate_content`, then upload the translated copy with `create_content_pack` (do not overwrite the original).",
      ].filter(Boolean).join("\n");
    },
  },
];
