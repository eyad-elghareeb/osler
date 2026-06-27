# OSCE Engine

The OSCE (Objective Structured Clinical Examination) engine simulates
clinical encounters. The user is presented with a patient case, takes a
history, performs a physical exam (selecting from available maneuvers),
orders investigations, and provides a diagnosis and management plan. The
engine scores the user against a checklist.

## Overview

- **Source:** `engines/osce-engine.js`
- **CSS:** `src/css/osce-engine.css`
- **Schema:** `src/schemas/osce-v1.json`
- **Content type:** `osce`
- **Tracker store:** `osceTracker`
- **Path constant:** `__OSCE_ENGINE_BASE`

## When to use the OSCE engine

Use the OSCE engine when:

- The skill being assessed is clinical reasoning across multiple steps
  (history → exam → investigations → diagnosis → management).
- The content has a "correct" sequence of actions that can be scored against
  a checklist.
- The user is preparing for OSCE / clinical skills exams.

Use the [written engine](written.md) for free-text composition practice.
Use the [quiz engine](quiz.md) for individual multiple-choice questions.

## OSCE JSON schema

An OSCE case is a JSON file matching `src/schemas/osce-v1.json`:

```json
{
  "type": "osce",
  "meta": {
    "uid": "osce-ami-001",
    "title": "Acute Myocardial Infarction — OSCE",
    "schemaVersion": "1.0",
    "createdAt": "2026-06-20T10:00:00Z",
    "updatedAt": "2026-06-25T14:30:00Z",
    "lang": "en",
    "tags": ["cardiology", "emergency", "osce"]
  },
  "settings": {
    "timeLimit": 600,
    "showChecklistDuring": false,
    "passingScore": 70,
    "allowHistoryReview": true
  },
  "case": {
    "chiefComplaint": "Chest pain for 2 hours",
    "patientInfo": {
      "name": "Mr. John Smith",
      "age": 55,
      "sex": "male",
      "occupation": "Truck driver"
    },
    "vitals": {
      "HR": 102,
      "BP": "150/95",
      "RR": 22,
      "Temp": "37.1°C",
      "SpO2": "96% on room air"
    },
    "appearance": "Middle-aged male, diaphoretic, clutching chest, in moderate distress."
  },
  "stages": {
    "history": {
      "availableQuestions": [
        { "id": "h1", "question": "Onset of pain?", "answer": "Sudden, 2 hours ago, while at rest." },
        { "id": "h2", "question": "Character of pain?", "answer": "Crushing, pressure-like." },
        { "id": "h3", "question": "Radiation?", "answer": "To the left arm and jaw." },
        { "id": "h4", "question": "Associated symptoms?", "answer": "Diaphoresis, nausea, one episode of vomiting." },
        { "id": "h5", "question": "Past medical history?", "answer": "Hypertension, hyperlipidemia. No prior cardiac events." },
        { "id": "h6", "question": "Social history?", "answer": "Smoker, 1 pack/day for 30 years. Occasional alcohol. No illicit drugs." },
        { "id": "h7", "question": "Family history?", "answer": "Father had MI at age 60. Mother has type 2 diabetes." }
      ],
      "requiredQuestions": ["h1", "h2", "h3", "h4"],
      "scoring": {
        "pointsPerRequired": 5,
        "pointsPerOptional": 2,
        "maxPoints": 35
      }
    },
    "examination": {
      "availableManeuvers": [
        { "id": "e1", "name": "Auscultate heart", "finding": "S1, S2 normal. No murmurs, rubs, or gallops." },
        { "id": "e2", "name": "Auscultate lungs", "finding": "Bibasilar crackles." },
        { "id": "e3", "name": "Inspect jugular venous pressure", "finding": "JVP not elevated." },
        { "id": "e4", "name": "Palpate peripheral pulses", "finding": "Radial and pedal pulses 2+, equal bilaterally." },
        { "id": "e5", "name": "Examine for peripheral edema", "finding": "No lower extremity edema." }
      ],
      "requiredManeuvers": ["e1", "e2"],
      "scoring": {
        "pointsPerRequired": 5,
        "pointsPerOptional": 2,
        "maxPoints": 25
      }
    },
    "investigations": {
      "availableTests": [
        { "id": "i1", "name": "ECG", "finding": "ST-elevation in leads II, III, aVF. Reciprocal ST-depression in I, aVL." },
        { "id": "i2", "name": "Troponin", "finding": "Elevated at 3.2 ng/mL (normal < 0.04)." },
        { "id": "i3", "name": "Chest X-ray", "finding": "Mild pulmonary edema. Normal cardiac silhouette." },
        { "id": "i4", "name": "CBC", "finding": "WBC 12.5, Hgb 14.2, Plt 250." },
        { "id": "i5", "name": "Basic metabolic panel", "finding": "Na 138, K 4.2, Cr 1.0, BUN 18." },
        { "id": "i6", "name": "Coagulation panel", "finding": "PT 12.1, INR 1.0, PTT 30." }
      ],
      "requiredTests": ["i1", "i2"],
      "scoring": {
        "pointsPerRequired": 5,
        "pointsPerOptional": 2,
        "maxPoints": 30
      }
    },
    "diagnosis": {
      "correctDiagnoses": [
        { "id": "d1", "text": "Acute ST-elevation myocardial infarction (STEMI)", "mustMatch": "exact" },
        { "id": "d2", "text": "Inferior wall MI", "mustMatch": "exact" }
      ],
      "scoring": {
        "pointsPerCorrect": 5,
        "penaltyPerIncorrect": -3,
        "maxPoints": 10
      }
    },
    "management": {
      "correctActions": [
        { "id": "m1", "text": "Administer aspirin 325 mg chewed" },
        { "id": "m2", "text": "Administer nitroglycerin (sublingual)" },
        { "id": "m3", "text": "Activate cath lab for primary PCI" },
        { "id": "m4", "text": "Administer oxygen if SpO2 < 90%" },
        { "id": "m5", "text": "Administer morphine for pain" },
        { "id": "m6", "text": "Administer unfractionated heparin" }
      ],
      "requiredActions": ["m1", "m3"],
      "scoring": {
        "pointsPerRequired": 5,
        "pointsPerOptional": 2,
        "penaltyPerIncorrect": -3,
        "maxPoints": 20
      }
    }
  }
}
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Always `"osce"` |
| `meta.uid` | string | yes | Globally unique ID |
| `meta.title` | string | yes | Display title |
| `meta.schemaVersion` | string | yes | Must match a known version |
| `meta.lang` | string | no | `"en"` / `"ar"` / `"mixed"` / `"other"` |
| `settings.timeLimit` | number | no | Seconds. 0 = no limit. |
| `settings.showChecklistDuring` | boolean | no | Show the rubric during the case. Default: false |
| `settings.passingScore` | number | no | 0-100. Used for results display. |
| `case.chiefComplaint` | string | yes | One-line summary |
| `case.patientInfo` | object | yes | Demographics |
| `case.vitals` | object | yes | Vital signs |
| `case.appearance` | string | yes | General appearance |
| `stages.history` | object | yes | History-taking stage |
| `stages.examination` | object | yes | Physical exam stage |
| `stages.investigations` | object | yes | Investigation stage |
| `stages.diagnosis` | object | yes | Diagnosis stage |
| `stages.management` | object | yes | Management stage |

Each stage has `available{Items}`, `required{Items}`, and `scoring`. See
the schema for per-stage details.

## UI behavior

### Case introduction

The case opens with:

- Chief complaint (prominent)
- Patient info (name, age, sex, occupation)
- Vitals (in a card layout)
- General appearance

A timer starts (if `timeLimit` is set). The user can pause the timer (the
case is paused, not the timer — there's no time banking).

### Stage navigation

The user moves through the stages in order:

1. **History** — a checklist of available questions. The user clicks each
   question to "ask" it. The patient's answer appears. The user can ask any
   subset (but `requiredQuestions` must be asked for full credit).
2. **Examination** — a checklist of available maneuvers. The user clicks
   each to perform it. The finding appears.
3. **Investigations** — a checklist of available tests. The user clicks to
   order each. The result appears.
4. **Diagnosis** — a free-text input. The user types their diagnosis.
5. **Management** — a multi-select of available actions. The user picks the
   actions they would take.

The user can navigate back to previous stages (review what they asked /
found) but cannot change answers after moving forward.

### Results screen

After submitting management:

- Total score (e.g. "85 / 100 — Pass")
- Per-stage breakdown:
  - History: 30 / 35 (asked all required + 2 optional, missed 1 optional)
  - Examination: 20 / 25 (asked all required + 1 optional)
  - Investigations: 25 / 30 (ordered all required + 2 optional)
  - Diagnosis: 10 / 10 (both correct)
  - Management: 0 / 20 (missed aspirin and PCI — critical errors)
- Critical errors highlighted in red (required items missed)
- Full case review: every question, finding, and the user's choices
- Buttons: "Review full case", "Restart", "Back to hub"

## Tracker behavior

Each OSCE session is recorded:

```json
{
  "osceUid": "osce-ami-001",
  "startedAt": "2026-06-27T10:00:00Z",
  "completedAt": "2026-06-27T10:08:23Z",
  "durationMs": 503000,
  "historyAsked": ["h1", "h2", "h3", "h4", "h5"],
  "examinationPerformed": ["e1", "e2", "e4"],
  "investigationsOrdered": ["i1", "i2", "i3"],
  "diagnosisSubmitted": "Inferior STEMI",
  "managementActions": ["m1", "m2", "m3", "m6"],
  "score": 85,
  "passed": true,
  "criticalErrors": []
}
```

The tracker supports analytics events:

```javascript
analytics.track('osce_complete', {
  contentType: 'osce',
  contentUid: 'osce-ami-001',
  outcome: 'correct',  // 'correct' if passed, 'wrong' if failed
  score: 85,
  durationMs: 503000,
});
```

## Scoring

Scoring is per-stage:

- Each required item is worth `pointsPerRequired` (typically 5).
- Each optional item is worth `pointsPerOptional` (typically 2).
- Critical errors (missing required items) are highlighted in results but
  don't deduct points beyond not earning the points.
- For diagnosis and management, `penaltyPerIncorrect` deducts points for
  wrong answers (prevents guessing).

Total score is normalized to 0-100 for display. `passingScore` (default 70)
determines pass/fail.

## Anti-goals

The OSCE engine does NOT:

- **Simulate the patient** with an LLM. The available questions and answers
  are pre-authored. (V2 anti-goal — adding LLM patient sim would be V3+.)
- **Score free-text diagnosis** with an LLM judge. The user's diagnosis is
  matched against `correctDiagnoses` via string comparison (with
  case-insensitive, whitespace-insensitive matching).
- **Track physical exam technique** (e.g. hand position, stethoscope
  placement). The engine assumes the user can perform the maneuver; it
  only scores whether they chose to.

## Accessibility

- All stage transitions are keyboard-accessible.
- Stage navigation buttons have ARIA labels.
- Timer is announced to screen readers every minute.
- Results screen uses semantic table markup for the per-stage breakdown.

## RTL behavior

The OSCE engine uses logical CSS properties. The case info, stages, and
results render right-to-left when `meta.lang === 'ar'`.

## What's next

- [Written Engine](written.md) — for free-text composition practice.
- [Quiz Engine](quiz.md) — for individual multiple-choice questions.
- [Content Authoring → Schemas](../content-authoring/schemas.md) — the full
  JSON Schema.
