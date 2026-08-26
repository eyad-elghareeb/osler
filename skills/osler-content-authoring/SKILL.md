---
name: osler-content-authoring
description: Comprehensive authoring manual for Osler medical content packs (Quiz, QBank, Flashcards, OSCE stations, Written prompts, Videos, Library articles with HTML & sidecar metadata) and manifest synchronization.
---

# Osler Content Authoring & Management Guide

This skill provides full schemas, authoring patterns, and edge-case handling for creating and editing Osler medical education content.

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

---

### B. Flashcard Engine (`flashcard`)
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

### C. OSCE Stations (`osce`)
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

### D. Library Articles with HTML & Sidecar Metadata (`library`)
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

## 2. Directory Hierarchy & Manifest Sync Conventions

- **Structure**:
  ```
  content-files/
  ├── qbank/
  │   └── cardiology/
  │       └── ecg-mastery/
  │           ├── questions.json
  │           └── images/
  │               └── ecg-01.png
  └── library/
      └── cardiology/
          └── heart-failure/
              ├── hfref.md
              ├── hfref.meta.json
              └── images/
                  └── algorithm.png
  ```

- **Manifests**:
  - Live at `content-manifests/<category>/manifest.json`.
  - Automatically maintained by the smart diff engine when content is published or updated via MCP or the Web Admin Studio.
