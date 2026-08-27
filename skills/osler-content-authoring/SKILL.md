---
name: osler-content-authoring
description: Comprehensive authoring and management manual for Osler medical content packs (Quiz, QBank, Flashcards, OSCE stations, Written prompts, Videos, Library articles with HTML & sidecar metadata), MCP tool suite, safeguards, and manifest synchronization.
---

# Osler Content Authoring & Management Guide

This skill provides complete schemas, authoring patterns, MCP tool workflows, safety safeguards, and edge-case handling for creating and managing Osler medical education content.

---

## 1. Engine Content Schemas

### A. Quiz Engine (`quiz`)
- **Canonical File**: `questions.json`
- **Location**: `content-files/qbank/<category>/<deck-name>/questions.json`
- **Schema**:
```json
{
  "title": "ECG Interpretation — Ischemic Changes",
  "meta": {
    "description": "High-yield ECG cases focusing on STEMI equivalents and ischemia",
    "lang": "en",
    "tags": ["Cardiology", "ECG", "STEMI"]
  },
  "questions": [
    {
      "id": "q-ecg-01",
      "question": "A 54-year-old man presents with 1 hour of chest pressure. ECG shows 2mm ST depression in V1-V3 with tall R waves and upright T waves. What is the most likely diagnosis?",
      "options": [
        "Anterior STEMI",
        "True Posterior STEMI",
        "Inferior STEMI",
        "Acute Pericarditis",
        "Left Bundle Branch Block"
      ],
      "correct": 1,
      "explanation": "ST depressions in V1-V3 with tall R waves and upright T waves represent reciprocal changes of an acute posterior STEMI (LCx or RCA occlusion). Posterior leads V7-V9 should be obtained.",
      "difficulty": "medium",
      "tags": ["ECG", "STEMI"]
    }
  ]
}
```
- `correct` is zero-based index (0 to 4).
- Standard question format has 5 options.

---

### B. Question Bank (`bank`)
- **Canonical File**: `questions.json`
- **Location**: `content-files/qbank/<category>/<deck-name>/questions.json`
- **Schema**:
```json
{
  "title": "Aortic Syndromes & Acute Chest Pain",
  "passages": [
    {
      "id": "p1",
      "content": "A 62-year-old female with long-standing hypertension presents with sudden-onset tearing chest pain radiating to her back. Blood pressure is 180/100 mmHg in the right arm and 140/85 mmHg in the left arm.",
      "questions": [
        {
          "id": "q1_1",
          "question": "What is the initial diagnostic test of choice in a hemodynamically stable patient?",
          "options": [
            "Transthoracic Echocardiogram",
            "Contrast-Enhanced Chest CT Angiography",
            "Cardiac MRI",
            "Coronary Angiography"
          ],
          "correct": 1,
          "explanation": "CT angiography of the chest is the most rapid and accurate diagnostic modality for acute aortic dissection in stable patients."
        }
      ]
    }
  ]
}
```

---

### C. Flashcard Engine (`flashcard`)
- **Canonical File**: `cards.json`
- **Location**: `content-files/flashcard/<category>/<deck-name>/cards.json`
- **Schema**:
```json
{
  "title": "Cardiology High-Yield Pearls",
  "meta": { "lang": "en", "tags": ["Cardiology"] },
  "cards": [
    {
      "id": "c-01",
      "front": "What is the classic diagnostic murmur of Aortic Regurgitation?",
      "back": "Early diastolic decrescendo high-pitched murmur heard best at the left 3rd/4th intercostal space with the patient sitting up and leaning forward in full expiration."
    },
    {
      "id": "c-02",
      "type": "cloze",
      "text": "The classic ECG finding in acute pericarditis is {{c1::diffuse concave-upward ST elevation::ST change}} with {{c2::PR depression::PR change}} in lead II, and {{c3::PR elevation::reciprocal}} in lead aVR."
    }
  ]
}
```

---

### D. OSCE Stations (`osce`)
- **Canonical File**: `stations.json`
- **Location**: `content-files/osce/<category>/<deck-name>/stations.json`
- **Schema**:
```json
{
  "title": "Emergency Medicine Clinical Encounters",
  "meta": { "lang": "en" },
  "stations": [
    {
      "id": "osce-dka-01",
      "title": "Management of Severe DKA",
      "specialty": "Endocrinology / Emergency",
      "difficulty": "hard",
      "type": "management",
      "time": 10,
      "task": "Evaluate the patient's labs, formulate a diagnosis, and outline the first 4 hours of fluid and insulin management.",
      "patient": {
        "name": "Sarah Ahmed",
        "age": 24,
        "gender": "Female",
        "chiefComplaint": "Nausea, vomiting, deep rapid breathing, abdominal pain",
        "vitalSigns": { "bp": "94/60", "hr": 118, "rr": 28, "temp": "37.1C", "spo2": "99%" }
      },
      "hiddenProfile": {
        "labs": "Glucose 480 mg/dL, pH 7.15, HCO3 9 mEq/L, Anion gap 24, K+ 4.8 mEq/L, Ketones positive",
        "medicalHistory": "Type 1 Diabetes, ran out of insulin 2 days ago"
      },
      "rubric": [
        { "id": "r1", "label": "Identified Diabetic Ketoacidosis with severe acidemia", "points": 2 },
        { "id": "r2", "label": "Ordered 0.9% Normal Saline 1-1.5 L/hr for initial resuscitation", "points": 3 },
        { "id": "r3", "label": "Initiated regular insulin IV infusion at 0.1 U/kg/hr after confirming K+ >= 3.3", "points": 3 },
        { "id": "r4", "label": "Monitored potassium and added IV KCl once K+ falls below 5.2 mEq/L", "points": 2 }
      ]
    }
  ]
}
```

---

### E. Written Clinical Prompts (`written`)
- **Canonical File**: `prompts.json`
- **Location**: `content-files/written/<category>/<deck-name>/prompts.json`
- **Schema**:
```json
{
  "title": "Critical Care Written Cases",
  "prompts": [
    {
      "id": "wp1",
      "prompt": "Outline the diagnostic criteria and initial fluid resuscitation protocol for severe diabetic ketoacidosis (DKA).",
      "sampleAnswer": "DKA criteria: Hyperglycemia >200 mg/dL, arterial pH <7.3, serum bicarbonate <15 mEq/L, ketonemia. Resuscitation: Initial 0.9% isotonic saline at 1000 mL/hr...",
      "rubric": [
        { "id": "r1", "criterion": "Identified biochemical criteria (pH, HCO3, glucose, ketones)", "maxPoints": 5 },
        { "id": "r2", "criterion": "Specified 0.9% normal saline initial fluid rate and potassium replacement rules", "maxPoints": 5 }
      ]
    }
  ]
}
```

---

### F. Video Lessons (`video`)
- **Canonical File**: `videos.json`
- **Location**: `content-files/videos/<category>/<deck-name>/videos.json`
- **Schema**:
```json
{
  "title": "Cardiology Clinical Video Series",
  "videos": [
    {
      "id": "v1",
      "title": "Approach to Wide Complex Tachycardia",
      "duration": 420,
      "source": { "type": "youtube", "id": "dQw4w9WgXcQ" }
    }
  ]
}
```

---

### G. Library Articles with HTML & Sidecar Metadata (`library`)
- **Canonical File**: `<slug>.md` or `<slug>.html`
- **Sidecar File**: `<slug>.meta.json` (always placed right next to the article file)
- **Location**: `content-files/library/<specialty>/<subtopic>/<slug>.md`

#### Sidecar Meta Format (`<slug>.meta.json`):
```json
{
  "title": "Heart Failure with Reduced Ejection Fraction (HFrEF)",
  "specialty": "Cardiology",
  "system": "Cardiovascular",
  "readTimeMin": 12,
  "tags": ["Heart Failure", "HFrEF", "GDMT", "Cardiology"],
  "lang": "en"
}
```

#### Markdown / HTML Article Body Features:
1. **Interactive Mermaid Diagrams**:
   ```markdown
   ```mermaid
   graph TD
     A[Suspicion of HFrEF] --> B[Transthoracic Echocardiogram]
     B -->|LVEF <= 40%| C[Initiate 4-Pillar GDMT]
     C --> D[ARNI/ACEi + Beta-blocker + MRA + SGLT2i]
   ```
   ```
2. **Expandable Clinical Pearls**:
   ```html
   <details>
     <summary><strong>Clinical Pearl: ARNI Initiation Rule</strong></summary>
     <p>Always allow a 36-hour washout period when switching from an ACE inhibitor to an ARNI (Sacubitril/Valsartan) to prevent severe angioedema.</p>
   </details>
   ```
3. **Local Pack Images**:
   - Place images in `images/` within the pack directory.
   - Reference simply as `![Cardiac Remodeling](images/remodeling.png)` or `<img src="images/remodeling.png" alt="Remodeling">`.

---

## 2. MCP Server Tool Suite & Privilege Model

### Privilege Tiers:
- **`content_admin`**: Draft creation, asset management, schema validation, submission to review queue. Cannot publish directly.
- **`admin`**: Full production write access. Direct publishing, live student file hotfixes, unpublishing, deletion, sidecar updates, and platform site configuration.

### Tool Catalog:
| Tool Name | Scope | Purpose |
|---|---|---|
| `get_instance_overview` | All | Session orientation: token scope, counts by status, content version |
| `list_review_queue` | All | Inspect pending submissions or rejected items needing revisions |
| `get_audit_trail` | Admin | Review action logs for traceability |
| `get_content_version` | All | Read the current content freshness version stamp |
| `create_content_pack` | All | Batch create draft/pack, upload assets, validate, and optionally submit/publish |
| `create_content_draft` | All | Create individual draft content object |
| `update_draft_body` | All | Update draft JSON or markdown body |
| `upload_asset` | All | Upload image/diagram/audio asset into pack storage |
| `delete_asset` | All | Delete asset from pack storage |
| `validate_content` | All | Validate body against engine schema (all 7 types) |
| `submit_for_review` | All | Snapshot draft to pending review candidate queue |
| `read_content_file` | All | Read published student file from R2 (returns `bodySha1`) |
| `list_content_files` | All | List published student-facing keys in R2 |
| `get_content_manifest` | All | Fetch full category manifest tree |
| `publish_content` | Admin | Publish draft/pending object to live student files |
| `approve_content` | Admin | Approve pending review candidate and publish |
| `reject_content` | Admin | Reject pending object back to draft with feedback |
| `unpublish_content` | Admin | Retract published content back to draft |
| `delete_content_object` | Admin | Permanently delete object and storage (requires two-step confirm) |
| `update_published_content` | Admin | Hotfix live student file with optimistic concurrency guard (`expectedCurrentBody`) |
| `smart_update_manifest` | Admin | Trigger smart incremental diff for category manifest |
| `get_article_details` | All | Fetch article markdown/HTML along with sidecar metadata |
| `update_article_metadata` | Admin | Update `<basename>.meta.json` sidecar without touching body |
| `read_config` / `update_config` | Admin | Read or update platform site configuration (`_osler.config.json`) |

---

## 3. Safety Safeguards & Best Practices

1. **Two-Step Confirmation for Permanent Deletion (`delete_content_object`)**:
   - Calling `delete_content_object` without `confirm: true` returns a complete damage report and a deterministic `continueToken`.
   - Re-call with `"confirm": true` and `"continueToken": "<token>"` to execute the deletion.
   - If the object ID changes, the token is invalidated, preventing race conditions or accidental deletions.

2. **Optimistic Concurrency on Live Hotfixes (`update_published_content`)**:
   - Always read the current file first using `read_content_file`.
   - Pass the returned `bodySha1` string as `expectedCurrentBody` in `update_published_content`.
   - If another admin or process modified the file concurrently, the update is safely rejected rather than overwriting changes.

3. **Instant Manifest Freshness & Cache-Busting**:
   - Whenever content is published, unpublished, deleted, or edited, the smart diff engine updates category manifests and advances `/v1/content-version`.
   - Student web clients poll `/v1/content-version` and automatically cache-bust manifest URLs with `?v=<stamp>`, so students see new content immediately without requiring a hard refresh.
