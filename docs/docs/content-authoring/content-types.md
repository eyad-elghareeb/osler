# Content Types

Osler V2 supports 5 study content types plus the hub manifest. This page is
a quick-reference for the field structure of each type. For the full JSON
Schema, see `src/schemas/{type}-v1.json` or
[Content Authoring → Schemas](schemas.md).

## Quick reference

| Type | Engine | Schema file | Tracker store | Typical size |
|------|--------|-------------|---------------|--------------|
| quiz | quiz-engine.js | quiz-v1.json | quizTracker | 5-50 questions |
| bank | bank-engine.js | bank-v1.json | bankTracker | 20-200 items |
| flashcard | flashcard-engine.js | flashcard-v1.json | flashcardTracker | 20-2000 cards |
| written | written-engine.js | written-v1.json | writtenTracker | 1-20 prompts |
| osce | osce-engine.js | osce-v1.json | osceTracker | 1 case with 5 stages |
| hub | (index-engine.js) | hub-v1.json | (none) | 1 manifest per instance |

## Quiz

```json
{
  "type": "quiz",
  "meta": { /* see Meta Fields */ },
  "settings": {
    "shuffleQuestions": false,
    "shuffleOptions": false,
    "showExplanation": "after_answer",
    "timeLimit": 0,
    "passingScore": 70,
    "allowReview": true
  },
  "questions": [
    {
      "id": "q1",
      "stem": "Question text (markdown supported)",
      "options": [
        { "id": "a", "text": "Option A", "correct": true },
        { "id": "b", "text": "Option B", "correct": false }
      ],
      "explanation": "Optional. Shown after answer.",
      "references": [{ "text": "Citation", "url": "https://..." }],
      "tags": ["topic"]
    }
  ]
}
```

See [Quiz Engine](../engines/quiz.md) for engine behavior.

## Bank

```json
{
  "type": "bank",
  "meta": { /* ... */ },
  "settings": {
    "shuffleItems": false,
    "showTags": true,
    "allowSearch": true,
    "initialFilter": ""
  },
  "items": [
    {
      "id": "b1",
      "front": "Question / prompt (markdown)",
      "back": "Answer / explanation (markdown)",
      "tags": ["topic"],
      "references": [{ "text": "Citation", "url": "https://..." }]
    }
  ]
}
```

See [Bank Engine](../engines/bank.md) for engine behavior.

## Flashcard

```json
{
  "type": "flashcard",
  "meta": { /* ... */ },
  "settings": {
    "showTags": true,
    "newCardsPerDay": 20,
    "maxReviewsPerDay": 200,
    "cardOrder": "due_first"
  },
  "cards": [
    {
      "id": "c1",
      "front": "Front text (markdown)",
      "back": "Back text (markdown)",
      "tags": ["topic"],
      "references": [{ "text": "Citation", "url": "https://..." }]
    }
  ]
}
```

See [Flashcard Engine](../engines/flashcard.md) for SM-2 behavior.

## Written

```json
{
  "type": "written",
  "meta": { /* ... */ },
  "settings": {
    "shufflePrompts": false,
    "timeLimit": 0,
    "minWords": 50,
    "maxWords": 500,
    "showModelAfterSubmit": true,
    "rubricScale": "4_point"
  },
  "prompts": [
    {
      "id": "p1",
      "scenario": "Setup / context (markdown)",
      "task": "The actual prompt",
      "modelAnswer": "Reference answer (shown after submit)",
      "rubric": [
        { "criterion": "Onset included", "weight": 1 }
      ]
    }
  ]
}
```

See [Written Engine](../engines/written.md) for engine behavior.

## OSCE

```json
{
  "type": "osce",
  "meta": { /* ... */ },
  "settings": {
    "timeLimit": 600,
    "showChecklistDuring": false,
    "passingScore": 70,
    "allowHistoryReview": true
  },
  "case": {
    "chiefComplaint": "...",
    "patientInfo": { "name": "...", "age": 55, "sex": "male", "occupation": "..." },
    "vitals": { "HR": 102, "BP": "150/95", /* ... */ },
    "appearance": "..."
  },
  "stages": {
    "history": { /* availableQuestions, requiredQuestions, scoring */ },
    "examination": { /* availableManeuvers, requiredManeuvers, scoring */ },
    "investigations": { /* availableTests, requiredTests, scoring */ },
    "diagnosis": { /* correctDiagnoses, scoring */ },
    "management": { /* correctActions, requiredActions, scoring */ }
  }
}
```

See [OSCE Engine](../engines/osce.md) for the full stage breakdown and
scoring.

## Hub (manifest)

The hub is special — it's not a study engine, it's the index that lists
every other content item in the instance:

```json
{
  "type": "hub",
  "meta": {
    "uid": "manifest",
    "title": "Content Manifest",
    "schemaVersion": "1.0",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "items": [
    {
      "uid": "sample-quiz-001",
      "type": "quiz",
      "title": "Sample Quiz",
      "path": "sample-quiz.json"
    },
    {
      "uid": "sample-flashcard-001",
      "type": "flashcard",
      "title": "Sample Flashcards",
      "path": "sample-flashcard.json"
    }
  ]
}
```

The hub manifest:

- Has `uid: "manifest"` (always — there's only one per instance).
- Lists every content item by UID, type, title, and path.
- Is maintained automatically by the admin dashboard's CMS workflow.
- Lives at `content/manifest.json` in the content repo and the generated
  site bundle.

You should not edit the hub manifest by hand. Use the admin's CMS workflow
instead. See [Admin Dashboard → Content CMS](../admin-dashboard/content-cms.md).

## Markdown support

All free-text fields (`stem`, `front`, `back`, `explanation`, `scenario`,
`task`, `modelAnswer`, `appearance`) support a markdown subset:

- **Bold**, *italic*, ~~strikethrough~~
- Headings (##, ###)
- Ordered / unordered lists
- Code blocks (```...```) and inline code (`...`)
- Images (`![alt](url)`) — but see note below
- Links (`[text](url)`)
- Tables (basic syntax)

Not supported:

- HTML tags (rejected by validation)
- Script tags (rejected by validation — XSS prevention)
- Custom syntax extensions

### Images

Images are referenced by URL. For admin-managed content, store images in
the content repo at `content/assets/{filename}` and reference them with a
relative path:

```markdown
![ECG showing AFib](assets/afib-ecg.png)
```

The admin dashboard uploads images via the content editor's image button
and writes them to `content/assets/` in the content repo.

For user custom content (PWA-authored), images are stored as base64 data
URLs in the JSON (limited to 100 KB per image to keep IndexedDB / Firestore
sizes manageable). Larger images should be hosted externally and referenced
by URL.

## Anti-goals

Content types explicitly do NOT support:

- **HTML content** — all text is markdown or plain text. (V1 rule, kept in V2)
- **Embedded audio/video** — V2 explicitly removes TTS audio (anti-goal §5.8).
  External YouTube embeds are not part of content schemas; embed them in
  docs pages instead.
- **Interactive widgets** — no embedded JS, no iframes, no custom UI.
- **Conditional logic** — no branching scenarios (V3+ consideration).

## What's next

- [Schemas](schemas.md) — the full JSON Schemas.
- [Meta Fields](meta-fields.md) — the `meta` object in detail.
- [Validation](validation.md) — the validation contract.
- Per-engine docs in [Engines](../engines/quiz.md).
