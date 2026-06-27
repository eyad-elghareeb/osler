# Bank Engine

The bank engine is the untimed, low-pressure study mode. It presents
questions from a bank one at a time, lets the user flip to see the answer,
and tracks which questions they've seen. No scoring, no time pressure —
pure review.

## Overview

- **Source:** `engines/bank-engine.js`
- **CSS:** `src/css/bank-engine.css`
- **Schema:** `src/schemas/bank-v1.json`
- **Content type:** `bank`
- **Tracker store:** `bankTracker`
- **Path constant:** `__BANK_ENGINE_BASE`

## When to use the bank engine

Use the bank engine when:

- The user wants to review content without scoring pressure.
- The content is reference-style (e.g. "What are the branches of the aorta?")
  rather than test-style.
- The user is in the early learning phase and shouldn't be penalized for
  wrong answers.
- The content has long explanations that benefit from unhurried reading.

Use the [quiz engine](quiz.md) instead when:

- You want to measure performance (score, time).
- The content is exam-style (USMLE, board prep).
- The user is in the practice / test phase.

## Bank JSON schema

A bank is a JSON file matching `src/schemas/bank-v1.json`:

```json
{
  "type": "bank",
  "meta": {
    "uid": "anatomy-thorax-bank-001",
    "title": "Thorax Anatomy Bank",
    "schemaVersion": "1.0",
    "createdAt": "2026-06-20T10:00:00Z",
    "updatedAt": "2026-06-25T14:30:00Z",
    "lang": "en",
    "tags": ["anatomy", "thorax"]
  },
  "settings": {
    "shuffleItems": true,
    "showTags": true,
    "allowSearch": true,
    "initialFilter": ""
  },
  "items": [
    {
      "id": "b1",
      "front": "What are the branches of the aortic arch?",
      "back": "From proximal to distal:\n1. Brachiocephalic trunk (innominate artery)\n2. Left common carotid artery\n3. Left subclavian artery\n\nThe brachiocephalic trunk further divides into the right subclavian artery and the right common carotid artery.",
      "tags": ["aorta", "vasculature"],
      "references": [
        { "text": "Gray's Anatomy, 42nd ed., Chapter 7",
          "url": "https://example.com/grays-7" }
      ]
    },
    {
      "id": "b2",
      "front": "Name the layers of the pericardium.",
      "back": "From superficial to deep:\n1. Fibrous pericardium\n2. Parietal layer of serous pericardium\n3. Visceral layer of serous pericardium (epicardium)\n\nThe pericardial cavity lies between the parietal and visceral layers.",
      "tags": ["pericardium", "heart"]
    }
  ]
}
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Always `"bank"` |
| `meta.uid` | string | yes | Globally unique ID |
| `meta.title` | string | yes | Display title |
| `meta.schemaVersion` | string | yes | Must match a known version |
| `meta.lang` | string | no | `"en"` / `"ar"` / `"mixed"` / `"other"` |
| `meta.tags` | string[] | no | For filtering / search |
| `settings.shuffleItems` | boolean | no | Default: false |
| `settings.showTags` | boolean | no | Show per-item tags. Default: true |
| `settings.allowSearch` | boolean | no | Show search box. Default: true |
| `settings.initialFilter` | string | no | Pre-filtered tag (e.g. `"aorta"`) |
| `items[]` | array | yes | 1-500 items |
| `items[].id` | string | yes | Unique within the bank |
| `items[].front` | string | yes | Question / prompt (markdown supported) |
| `items[].back` | string | yes | Answer / explanation (markdown supported) |
| `items[].tags` | string[] | no | Per-item tags |
| `items[].references[]` | array | no | Citations |

## UI behavior

### Item display

- One item at a time (no list view by default).
- The `front` is always visible.
- The `back` is hidden behind a "Show answer" button (or spacebar).
- After revealing the back, the user can mark the item as "Marked for
  review" (a star toggle).

### Navigation

- **Previous / Next** buttons (or arrow keys).
- **Jump to** dropdown (jumps to any item by index).
- **Search box** (if `allowSearch`) — full-text search across `front` and
  `back` of all items.
- **Tag filter** — click any tag to filter the bank to items with that tag.

### Tracker behavior

Each item view is recorded:

```json
{
  "bankUid": "anatomy-thorax-bank-001",
  "itemId": "b1",
  "viewedAt": "2026-06-27T10:00:00Z",
  "markedForReview": false
}
```

The tracker is used to:

- Show a "Viewed" badge on items the user has seen.
- Show a "Marked" badge on items the user starred.
- Power the "Review marked items only" filter.

No outcome is recorded — the bank engine has no concept of correct / wrong.

## Differences from the quiz engine

| Aspect | Quiz | Bank |
|--------|------|------|
| Scoring | Yes (correct / wrong) | No |
| Time limit | Optional | Never |
| Question order | Sequential or shuffled | Sequential, shuffled, or filtered |
| Feedback | Instant (correct + explanation) | User-paced (reveal on demand) |
| Tracker | Outcome per question | View + mark per item |
| Use case | Practice / assessment | Review / browsing |

## Differences from the flashcard engine

| Aspect | Bank | Flashcard |
|--------|------|-----------|
| Spaced repetition | No | Yes (SM-2) |
| Scheduling | User picks what to view | Engine picks what to show |
| Outcome | None | Again / Hard / Good / Easy (drives SM-2) |
| Use case | Reference / browsing | Active recall practice |

The bank engine is the most "browsing-like" of the three — closest to
reading a textbook with a search function.

## Accessibility

- Full keyboard navigation (arrows, spacebar to reveal, M to mark).
- ARIA labels on all interactive elements.
- Screen reader announces item number ("Item 5 of 47") on navigation.
- Focus moves to the answer reveal button when a new item loads.

## RTL behavior

The bank engine uses logical CSS properties for RTL. The `front` and `back`
text render right-to-left when `meta.lang === 'ar'`.

## What's next

- [Quiz Engine](quiz.md) — the timed, scored variant.
- [Flashcard Engine](flashcard.md) — the SM-2 spaced-repetition variant.
- [Content Authoring → Schemas](../content-authoring/schemas.md) — the full
  JSON Schema.
