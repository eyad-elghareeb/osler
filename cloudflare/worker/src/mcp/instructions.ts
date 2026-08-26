/**
 * MCP server instructions + prompt templates.
 *
 * Pure data — returned in the MCP `initialize` response so AI agents understand
 * Osler content schemas, workflows, privilege tiers, tricky metadata rules,
 * HTML article rules, and manifest mechanics.
 */

export const SERVER_NAME = "osler-admin";
export const SERVER_VERSION = "2.0.0";
export const PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INSTRUCTIONS = `# Osler Medical Study Platform — Content Authoring & Admin MCP Server

You are connected to the Osler medical-education platform MCP server.

## 1. Privilege Tiers & Token Scopes
Your token has one of two privilege levels:
- **admin**: Full Editing & Publishing abilities. Can directly publish (\`publish_content\`), approve/reject review candidates (\`approve_content\`, \`reject_content\`), unpublish (\`unpublish_content\`), hotfix student-facing files (\`update_published_content\`), delete objects, edit article sidecars, and trigger smart manifest diffs.
- **content_admin**: Authoring & Review Queue only. Can create drafts, upload assets, validate content schemas, edit own drafts, and submit drafts for review (\`submit_for_review\`).

---

## 2. Content Engine Types & Exact JSON Schemas

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
- \`correct\` is zero-based index (e.g. 1 means the 2nd option).
- Must have at least 2 options (standard: exactly 5).
- Image references: use \`images/filename.png\` or \`filename.png\` (automatically resolves to the pack's \`images/\` folder).

### 2. Question Bank (Case Passages with Multiple Sub-questions)
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

### 4. OSCE Clinical Stations (Patient Simulations & Objective Rubrics)
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

### 5. Written Prompts (Clinical Scenarios & Structured Rubrics)
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

### 6. Video Lessons
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

### 7. Library Articles (Markdown & HTML with Sidecar Metadata)
Library articles are formatted as Markdown (\`.md\`) or sanitized HTML (\`.html\`).

#### Sidecar Metadata Pattern (\`<filename>.meta.json\`):
Always maintain sidecar metadata next to the article file:
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

#### HTML & Markdown Sanitization & Interactive Elements:
The article renderer supports GFM Markdown plus sanitized HTML elements:
- Mermaid diagrams: \`\`\`mermaid fenced blocks or \`<div class="osler-mermaid" data-diagram="..."></div>\`
- Expandable disclosures: \`<details><summary>Clinical Pearl</summary>Content...</details>\`
- Media tags: \`<video src="..." controls></video>\`, \`<audio src="..." controls></audio>\`, \`<figure><figcaption>...</figcaption></figure>\`
- Images: Bare filename \`<img src="ecg.png">\` or \`![ECG](ecg.png)\` automatically resolves to the article's \`images/\` folder.

---

## 3. Smart Incremental Manifest Sync
- Osler maintains category manifests under \`content-manifests/<category>/manifest.json\`.
- Whenever content is published, unpublished, deleted, or edited, the smart diff engine automatically recalculates node summaries (\`questionCount\`, \`itemCount\`, \`stationSummary\`, \`tags\`) in-place without requiring manual manifest regeneration.

---

## 4. Recommended Authoring Workflows

### Creating a New Pack in One Batch (\`create_content_pack\`):
1. Prepare the JSON body according to the schema above.
2. Read binary images as base64 data URIs: \`data:image/png;base64,...\`.
3. Call \`create_content_pack\`:
   - Set \`contentType\`, \`title\`, \`body\`, \`assets\`, and \`targetPath\` (e.g. \`"cardiology/acute-mi"\`).
   - If \`admin\` token: pass \`publishImmediately: true\` to go live instantly.
   - If \`content_admin\` token: pass \`submit: true\` to place it into the review queue.
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
];
