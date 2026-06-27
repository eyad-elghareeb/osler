# Quiz Engine

The quiz engine is the most-used study engine in Osler. It presents timed
multiple-choice questions with instant feedback, tracks performance per
question, and supports SM-2 spaced repetition for missed questions.

## Overview

- **Source:** `engines/quiz-engine.js`
- **CSS:** `src/css/quiz-engine.css`
- **Schema:** `src/schemas/quiz-v1.json`
- **Content type:** `quiz`
- **Tracker store:** `quizTracker` (in IndexedDB via `src/lib/storage.js`)
- **Path constant:** `__QUIZ_ENGINE_BASE` (do not hardcode paths)

## What it does

The quiz engine:

1. Loads a quiz JSON file (one item from `content/`).
2. Renders a question with 2-5 options.
3. Records the user's answer (click or keyboard 1-5).
4. Shows instant feedback (correct / wrong / explanation).
5. Advances to the next question.
6. On quiz completion, shows a results summary (score, time, per-question
   breakdown).
7. Records each answer to the `quizTracker` IndexedDB store and pushes an
   `analytics.track('quiz_answer', ...)` event.
8. Optionally schedules missed questions for SM-2 review (Phase 12 will
   surface these in the flashcard engine).

## Quiz JSON schema

A quiz is a JSON file matching `src/schemas/quiz-v1.json`:

```json
{
  "type": "quiz",
  "meta": {
    "uid": "cardio-arrhythmias-001",
    "title": "Cardiac Arrhythmias Quiz",
    "schemaVersion": "1.0",
    "createdAt": "2026-06-20T10:00:00Z",
    "updatedAt": "2026-06-25T14:30:00Z",
    "lang": "en",
    "tags": ["cardiology", "arrhythmia", "ecg"],
    "estimatedTime": 600,
    "difficulty": "medium"
  },
  "settings": {
    "shuffleQuestions": true,
    "shuffleOptions": true,
    "showExplanation": "after_answer",
    "timeLimit": 600,
    "passingScore": 70,
    "allowReview": true
  },
  "questions": [
    {
      "id": "q1",
      "stem": "A 65-year-old male presents with palpitations. ECG shows an irregularly irregular rhythm with no discernible P waves. What is the most likely diagnosis?",
      "options": [
        { "id": "a", "text": "Atrial fibrillation", "correct": true },
        { "id": "b", "text": "Atrial flutter", "correct": false },
        { "id": "c", "text": "Sinus tachycardia", "correct": false },
        { "id": "d", "text": "Ventricular fibrillation", "correct": false }
      ],
      "explanation": "The absence of P waves and the irregularly irregular rhythm are hallmark features of atrial fibrillation. Atrial flutter typically has a sawtooth pattern, sinus tachycardia has regular P waves, and ventricular fibrillation is a pulseless rhythm requiring immediate defibrillation.",
      "references": [
        { "text": "Harrison's Principles of Internal Medicine, 21st ed., Chapter 273",
          "url": "https://example.com/harrisons-273" }
      ],
      "tags": ["ecg", "arrhythmia"]
    }
  ]
}
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Always `"quiz"` |
| `meta.uid` | string | yes | Globally unique ID |
| `meta.title` | string | yes | Display title |
| `meta.schemaVersion` | string | yes | Must match a known version in `_meta.json` |
| `meta.lang` | string | no | `"en"` / `"ar"` / `"mixed"` / `"other"` |
| `meta.tags` | string[] | no | For filtering / search |
| `meta.estimatedTime` | number | no | Seconds, for the hub display |
| `meta.difficulty` | string | no | `"easy"` / `"medium"` / `"hard"` |
| `settings.shuffleQuestions` | boolean | no | Default: false |
| `settings.shuffleOptions` | boolean | no | Default: false |
| `settings.showExplanation` | string | no | `"after_answer"` / `"after_quiz"` / `"never"`. Default: `"after_answer"` |
| `settings.timeLimit` | number | no | Seconds. 0 = no limit. |
| `settings.passingScore` | number | no | 0-100. Used for results display. |
| `settings.allowReview` | boolean | no | Show review screen after results |
| `questions[]` | array | yes | 1-100 questions |
| `questions[].id` | string | yes | Unique within the quiz |
| `questions[].stem` | string | yes | Question text (markdown supported) |
| `questions[].options[]` | array | yes | 2-5 options |
| `questions[].options[].id` | string | yes | Unique within the question |
| `questions[].options[].text` | string | yes | Option text |
| `questions[].options[].correct` | boolean | yes | Mark the correct option(s) |
| `questions[].explanation` | string | no | Shown after answer (if `showExplanation` allows) |
| `questions[].references[]` | array | no | Citations |
| `questions[].tags` | string[] | no | Per-question tags |

For multiple-correct questions (select all that apply), mark more than one
option with `correct: true`. The UI shows checkboxes instead of radio
buttons.

## UI behavior

### Question display

- The question stem renders as markdown (basic syntax: bold, italic, lists,
  code blocks, images).
- Options render as buttons (radio for single-correct, checkbox for
  multi-correct).
- The keyboard shortcuts `1`-`5` select options, `Enter` submits, `Esc`
  clears the selection.

### Feedback

After submitting:

- Correct options turn green.
- Wrong selected options turn red.
- Unselected correct options (if multi-correct) turn green with a "missed"
  badge.
- The explanation appears below (if `showExplanation` allows).
- The "Next" button activates.

### Results screen

After the last question:

- Total score (e.g. "8 / 10 correct")
- Percentage vs passing score
- Time taken (vs time limit, if set)
- Per-question breakdown: stem, your answer, correct answer, explanation
- Buttons: "Review missed", "Restart quiz", "Back to hub"

### Review screen

If `settings.allowReview` is true, the review screen shows every question
with the user's answer highlighted. Users can re-read explanations without
re-taking the quiz.

## Tracker behavior

Each answer is recorded to the `quizTracker` IndexedDB store:

```json
{
  "quizUid": "cardio-arrhythmias-001",
  "questionId": "q1",
  "outcome": "correct",  // "correct" | "wrong" | "skipped"
  "selectedOptionIds": ["a"],
  "answeredAt": "2026-06-27T10:00:00Z",
  "timeSpentMs": 12500
}
```

The tracker is the source of truth for the analytics events (V20 taxonomy):

```javascript
analytics.track('quiz_answer', {
  contentType: 'quiz',
  contentUid: 'cardio-arrhythmias-001',
  questionId: 'q1',
  outcome: 'correct',
  timeSpentMs: 12500,
});
```

## SM-2 integration (V2)

Phase 12 will add an option: "Add missed questions to flashcard review".
When enabled, missed questions are converted to flashcard cards (front:
question stem; back: correct answer + explanation) and added to the user's
flashcard tracker for SM-2 review.

This is opt-in per quiz (a setting in `settings.addToReview`). The default
is off — users opt in by editing the quiz in the admin or toggling the
setting in the PWA's quiz start screen.

## Accessibility

- All interactive elements are keyboard-accessible (Tab, Enter, Esc, 1-5).
- ARIA labels on option buttons (`aria-pressed` for toggle state).
- Screen reader announcements on answer submission (`aria-live="polite"`).
- Color is never the only signal — correct/wrong states also use icons
  (checkmark / X) and text labels.
- Focus management: focus moves to the "Next" button after answering.

## RTL behavior

The quiz engine uses logical CSS properties (`margin-inline-start`,
`padding-inline-end`) so layout flips correctly in Arabic. The question stem
and options render right-to-left when `meta.lang === 'ar'` or the UI language
is Arabic.

See [i18n → RTL Guide](../i18n/rtl-guide.md) for the full RTL guide.

## What's next

- [Bank Engine](bank.md) — the untimed question bank variant.
- [Content Authoring → Schemas](../content-authoring/schemas.md) — the full
  JSON Schema.
- [API Reference → Lib Modules](../api-reference/lib-modules.md) — `tracker.js`
  API.
