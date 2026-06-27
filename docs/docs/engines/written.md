# Written Assessment Engine

The written engine presents free-text prompts and lets the user write a
response. After submitting, the user self-rates their answer against a
model answer (rubric-style). There's no automated grading — the user is the
judge.

## Overview

- **Source:** `engines/written-engine.js`
- **CSS:** `src/css/written-engine.css`
- **Schema:** `src/schemas/written-v1.json`
- **Content type:** `written`
- **Tracker store:** `writtenTracker`
- **Path constant:** `__WRITTEN_ENGINE_BASE`

## When to use the written engine

Use the written engine when:

- The skill being assessed is free-text composition (e.g. "Write a one-page
  history of present illness for this patient").
- The correct answer is open-ended (e.g. "List the differential diagnosis
  for chest pain").
- Self-assessment is more valuable than binary right/wrong (e.g. essay
  practice).

Use the [quiz engine](quiz.md) for multiple-choice questions. Use the
[OSCE engine](osce.md) for clinical simulations with checklists.

## Written JSON schema

A written assessment is a JSON file matching `src/schemas/written-v1.json`:

```json
{
  "type": "written",
  "meta": {
    "uid": "hpi-practice-001",
    "title": "History of Present Illness Practice",
    "schemaVersion": "1.0",
    "createdAt": "2026-06-20T10:00:00Z",
    "updatedAt": "2026-06-25T14:30:00Z",
    "lang": "en",
    "tags": ["clinical-skills", "history-taking"]
  },
  "settings": {
    "shufflePrompts": false,
    "timeLimit": 600,
    "minWords": 50,
    "maxWords": 500,
    "showModelAfterSubmit": true,
    "rubricScale": "4_point"
  },
  "prompts": [
    {
      "id": "p1",
      "scenario": "A 55-year-old male presents to the emergency department with crushing chest pain for the past 2 hours, radiating to the left arm, associated with diaphoresis and nausea. PMH: hypertension, hyperlipidemia, smoking (1 pack/day for 30 years).",
      "task": "Write a focused history of present illness (HPI) for this patient. Include the onset, character, location, duration, aggravating/alleviating factors, and associated symptoms.",
      "modelAnswer": "**O:** Onset — 2 hours ago, sudden, while at rest.\n**C:** Crushing / pressure-like, severity 8/10.\n**L:** Substernal, radiating to the left arm.\n**D:** Continuous, no relief since onset.\n**A:** Worse with deep inspiration. No relief with antacids.\n**A:** Associated with diaphoresis, nausea, one episode of vomiting.\n\n**Pertinent positives:** Syncope, dyspnea, palpitations.\n**Pertinent negatives:** No fever, no cough, no recent trauma.\n\n**PMH:** HTN, hyperlipidemia. **SH:** Smoker (30 pack-years).",
      "rubric": [
        { "criterion": "Onset included", "weight": 1 },
        { "criterion": "Character described", "weight": 1 },
        { "criterion": "Location + radiation", "weight": 1 },
        { "criterion": "Duration stated", "weight": 1 },
        { "criterion": "Aggravating/alleviating factors", "weight": 1 },
        { "criterion": "Associated symptoms", "weight": 1 },
        { "criterion": "Pertinent negatives", "weight": 1 },
        { "criterion": "Uses OPQRST or similar framework", "weight": 1 }
      ]
    }
  ]
}
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Always `"written"` |
| `meta.uid` | string | yes | Globally unique ID |
| `meta.title` | string | yes | Display title |
| `meta.schemaVersion` | string | yes | Must match a known version |
| `meta.lang` | string | no | `"en"` / `"ar"` / `"mixed"` / `"other"` |
| `meta.tags` | string[] | no | For filtering / search |
| `settings.shufflePrompts` | boolean | no | Default: false |
| `settings.timeLimit` | number | no | Seconds. 0 = no limit. |
| `settings.minWords` | number | no | Minimum word count for submit |
| `settings.maxWords` | number | no | Maximum word count |
| `settings.showModelAfterSubmit` | boolean | no | Default: true |
| `settings.rubricScale` | string | no | `"4_point"` (default) / `"5_point"` / `"binary"` |
| `prompts[]` | array | yes | 1-50 prompts |
| `prompts[].id` | string | yes | Unique within the assessment |
| `prompts[].scenario` | string | yes | Setup / context (markdown supported) |
| `prompts[].task` | string | yes | The actual prompt |
| `prompts[].modelAnswer` | string | yes | Reference answer (shown after submit) |
| `prompts[].rubric[]` | array | no | Self-assessment rubric |

## UI behavior

### Prompt display

- The scenario renders at the top (markdown supported, including images).
- The task is shown prominently below.
- A textarea appears for the user's response.
- Word count is shown live (and the submit button is disabled until
  `minWords` is reached).

### Submitting

When the user clicks "Submit":

1. The response is saved to the `writtenTracker` store.
2. If `showModelAfterSubmit` is true, the model answer is revealed in a
   side-by-side comparison.
3. The rubric appears with checkboxes (one per criterion).
4. The user rates their response:
   - For `4_point` scale: Again / Hard / Good / Easy (mirrors flashcards)
   - For `5_point` scale: 1-5 stars
   - For `binary` scale: ✓ / ✗
5. The rating is recorded to the tracker and pushed as an analytics event.

### Results screen

After the last prompt:

- Summary: "Completed 5 prompts in 12m 30s"
- Per-prompt: scenario, your response, model answer, your rating
- Buttons: "Review all", "Restart", "Back to hub"

## Tracker behavior

Each submission is recorded:

```json
{
  "writtenUid": "hpi-practice-001",
  "promptId": "p1",
  "response": "The patient is a 55-year-old male presenting with...",
  "wordCount": 87,
  "rating": "good",
  "rubricChecks": [true, true, true, false, true, true, false, true],
  "submittedAt": "2026-06-27T10:00:00Z",
  "timeSpentMs": 185000
}
```

## Self-rating honesty

The written engine relies on honest self-rating. There's no automated
grading (that would require either a rubric so detailed it becomes a
checklist, or an LLM judge — both out of scope for V2).

The user is encouraged to be honest by:

- The model answer being visible only after submit (prevents copying).
- The rubric being shown alongside the rating (encourages self-critique).
- The analytics tracking `outcome: 'rating_N'` (visible to the user in
  their progress dashboard — they see if they're rating themselves too
  generously).

## Use with the AI tutor (Phase 12)

The AI tutor (Phase 12) can be invoked from the written engine after the
model answer is revealed. The tutor pre-fills the prompt context and the
user's response, and the user can ask:

- "What did I miss in my HPI?"
- "Is my differential complete?"
- "How could I improve the structure of my response?"

The tutor uses Gemini with the current item as context — no RAG, no
embeddings. See [AI Tutor → Overview](../ai-tutor/overview.md).

## Accessibility

- Textarea has `aria-label` and `aria-describedby` (for word count).
- Submit button is disabled until `minWords` — announced via `aria-disabled`.
- Rubric checkboxes have descriptive labels.
- Screen reader announces rating effect ("You rated this 'Good'").

## RTL behavior

The written engine uses logical CSS properties. The scenario and response
render right-to-left when `meta.lang === 'ar'`. The textarea input also
flips to RTL via `dir="auto"` on the element.

## What's next

- [Quiz Engine](quiz.md) — for multiple-choice questions.
- [OSCE Engine](osce.md) — for clinical simulations.
- [AI Tutor → Overview](../ai-tutor/overview.md) — how the tutor integrates.
