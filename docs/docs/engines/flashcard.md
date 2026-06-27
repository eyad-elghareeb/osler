# Flashcard Engine

The flashcard engine implements SM-2 spaced repetition (the algorithm behind
Anki). It schedules cards based on the user's review history, showing due
cards first and pushing forgotten cards back into the rotation.

## Overview

- **Source:** `engines/flashcard-engine.js`
- **CSS:** `src/css/flashcard-engine.css`
- **Schema:** `src/schemas/flashcard-v1.json`
- **Content type:** `flashcard`
- **Tracker store:** `flashcardTracker` (SM-2 state per card)
- **Path constant:** `__FLASHCARD_ENGINE_BASE`
- **Algorithm:** SM-2, implemented in `src/lib/sm2.js`

## SM-2 in brief

SM-2 (SuperMemo 2) schedules each card based on:

- **Ease factor (EF)** — starts at 2.5, adjusted by review quality. Range:
  1.3 to 3.0. Higher EF = longer intervals.
- **Interval** — days until next review. Starts at 1 day, multiplied by EF
  on each successful review.
- **Repetitions** — consecutive correct reviews. Resets to 0 on a failure
  ("Again" rating).

The user rates each card on a 4-point scale:

| Rating | Meaning | Effect |
|--------|---------|--------|
| Again (1) | Forgot completely | Reset reps to 0, interval to 1 day, EF -= 0.2 |
| Hard (2) | Struggled but got it | Interval × 1.2, EF -= 0.15 |
| Good (3) | Normal recall | Interval × EF, EF unchanged |
| Easy (4) | Instant recall | Interval × EF × 1.3, EF += 0.15 |

EF is clamped to [1.3, 3.0] after adjustment. Intervals are rounded to whole
days.

For the full algorithm and edge cases, read `src/lib/sm2.js` and its tests
in `tests/unit/lib/sm2.test.js`.

## Flashcard JSON schema

A flashcard deck is a JSON file matching `src/schemas/flashcard-v1.json`:

```json
{
  "type": "flashcard",
  "meta": {
    "uid": "pharm-antibiotics-fc-001",
    "title": "Antibiotics Flashcards",
    "schemaVersion": "1.0",
    "createdAt": "2026-06-20T10:00:00Z",
    "updatedAt": "2026-06-25T14:30:00Z",
    "lang": "en",
    "tags": ["pharmacology", "antibiotics"]
  },
  "settings": {
    "showTags": true,
    "newCardsPerDay": 20,
    "maxReviewsPerDay": 200,
    "cardOrder": "due_first"
  },
  "cards": [
    {
      "id": "c1",
      "front": "Mechanism of action of penicillins?",
      "back": "Inhibit bacterial cell wall synthesis by binding to penicillin-binding proteins (PBPs), which inhibits transpeptidation (cross-linking of peptidoglycan). This leads to cell lysis.\n\n**Bactericidal** against actively growing cells.",
      "tags": ["mechanism", "cell-wall"],
      "references": [
        { "text": "Katzung Basic & Clinical Pharmacology, 15th ed., Chapter 43" }
      ]
    },
    {
      "id": "c2",
      "front": "Common adverse effects of penicillins?",
      "back": "- Hypersensitivity reactions (rash, anaphylaxis) — most common\n- GI upset (nausea, diarrhea)\n- **Jarisch-Herxheimer reaction** — in syphilis treatment\n- Interstitial nephritis (especially with methicillin)\n- Drug-induced hemolytic anemia",
      "tags": ["adverse-effects"]
    }
  ]
}
```

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Always `"flashcard"` |
| `meta.uid` | string | yes | Globally unique ID |
| `meta.title` | string | yes | Display title |
| `meta.schemaVersion` | string | yes | Must match a known version |
| `meta.lang` | string | no | `"en"` / `"ar"` / `"mixed"` / `"other"` |
| `meta.tags` | string[] | no | For filtering / search |
| `settings.showTags` | boolean | no | Default: true |
| `settings.newCardsPerDay` | number | no | Daily cap on new card introductions. Default: 20 |
| `settings.maxReviewsPerDay` | number | no | Daily cap on total reviews. Default: 200 |
| `settings.cardOrder` | string | no | `"due_first"` (default) / `"random"` / `"sequential"` |
| `cards[]` | array | yes | 1-2000 cards |
| `cards[].id` | string | yes | Unique within the deck |
| `cards[].front` | string | yes | Front text (markdown supported) |
| `cards[].back` | string | yes | Back text (markdown supported) |
| `cards[].tags` | string[] | no | Per-card tags |
| `cards[].references[]` | array | no | Citations |

## UI behavior

### Session start

When the user opens a flashcard deck:

1. The engine queries the `flashcardTracker` store for due cards (where
   `due <= now`).
2. The engine introduces new cards up to `newCardsPerDay`.
3. The engine caps the session at `maxReviewsPerDay`.
4. The engine shows the count: "Today: 47 due, 12 new, 59 total".
5. The user clicks "Start session".

### Card display

- Front is shown.
- User clicks "Show answer" (or spacebar).
- Back is revealed.
- Four rating buttons appear: Again / Hard / Good / Easy (with keyboard
  shortcuts 1-4).
- User picks a rating. The engine:
  1. Computes the new SM-2 state via `sm2.schedule(card, rating)`.
  2. Updates the `flashcardTracker` store.
  3. Pushes an `analytics.track('flashcard_review', { outcome: 'rating_N' })`
     event.
  4. Advances to the next card.

### Session end

When all due cards are reviewed (or the user clicks "Stop"):

- Summary: "Reviewed 47 due + 12 new = 59 cards in 8m 23s"
- Breakdown: "Again: 5, Hard: 8, Good: 38, Easy: 8"
- Next due date: "Tomorrow, 23 cards due"
- Buttons: "Review again" (re-reviews failed cards), "Done"

## Tracker behavior

The `flashcardTracker` store holds one entry per card:

```json
{
  "deckUid": "pharm-antibiotics-fc-001",
  "cardId": "c1",
  "ease": 2.5,
  "interval": 6,
  "reps": 3,
  "lapses": 0,
  "due": "2026-07-03T10:00:00Z",
  "lastReviewed": "2026-06-27T10:00:00Z",
  "newCard": false,
  "buriedUntil": null
}
```

This is the SM-2 state. Sync to Firestore uses the `sm2Merge` strategy
(see [Firebase → Sync Strategies](../firebase/sync-strategies.md#strategy-smm2merge)).

## Daily limits

- `newCardsPerDay` — caps the number of new cards introduced per UTC day.
  Prevents overwhelm on large decks.
- `maxReviewsPerDay` — caps total reviews per UTC day. Prevents marathon
  sessions that lead to burnout.

Both limits are tracked in the tracker store (a separate "metadata" entry
per deck). When the limit is hit, the engine shows a message and refuses
to show more cards until the next UTC day.

## Card burying

If the user rates a card "Again" and the same card is due again in the same
session (e.g. after 10 minutes), the engine "buries" it until the next day.
This prevents a single difficult card from dominating the session.

Buried cards have `buriedUntil` set to the next UTC midnight. The session
end summary shows buried count separately.

## Anki CSV import / export

The flashcard engine supports Anki CSV import/export via `src/lib/anki.js`:

- **Import:** Anki → File → Export → "Cards in Plain Text" → import to
  Osler via the admin dashboard. CSV columns map to `front` / `back` /
  `tags`.
- **Export:** Osler → right-click a flashcard item → Export → Anki CSV.
  The CSV is Anki-import-ready.

See `src/lib/anki.js` for the field mapping logic.

## SM-2 algorithm details

The full SM-2 implementation in `src/lib/sm2.js`:

```javascript
export const sm2 = {
  schedule(card, rating) {
    // rating: 1 (Again) / 2 (Hard) / 3 (Good) / 4 (Easy)
    const q = rating;

    let { ease, interval, reps, lapses } = card;

    if (q < 3) {
      // Failed — reset
      reps = 0;
      interval = 1;
      if (q === 1) lapses += 1;
    } else {
      // Passed — advance
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.round(interval * ease);
    }

    // Adjust ease
    ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (q === 2) ease -= 0.15;
    if (q === 4) ease += 0.15;
    ease = Math.max(1.3, Math.min(3.0, ease));

    // Hard rating: shorten interval
    if (q === 2) interval = Math.max(1, Math.round(interval * 1.2));

    // Easy rating: lengthen interval
    if (q === 4) interval = Math.round(interval * 1.3);

    const due = new Date();
    due.setDate(due.getDate() + interval);

    return { ease, interval, reps, lapses, due, lastReviewed: new Date() };
  },
};
```

This is a faithful implementation of the SM-2 algorithm as published by
Piotr Wozniak. Variants:

- Hard interval multiplier: 1.2 (Anki default).
- Easy interval multiplier: 1.3 (Anki default).
- EF clamping: [1.3, 3.0] (SM-2 spec).
- Initial interval after first success: 1 day (Anki default).
- Second interval: 6 days (Anki default).

## Anti-goal: no ML optimizer

V2 explicitly does NOT add an ML-based SR optimizer (v2 plan K9). SM-2 works
well enough; an ML model would add 4 sessions of complexity for marginal
gain. Deferred to V3+.

## Accessibility

- Full keyboard navigation (spacebar to reveal, 1-4 to rate).
- ARIA labels on rating buttons.
- Screen reader announces the rating effect ("Card due in 6 days").
- Focus management: focus moves to rating buttons after reveal.

## RTL behavior

The flashcard engine uses logical CSS properties for RTL. The `front` and
`back` text render right-to-left when `meta.lang === 'ar'`.

## What's next

- [SM-2 reference in API](../api-reference/lib-modules.md#sm2js)
- [Content Authoring → Schemas](../content-authoring/schemas.md) — the full
  JSON Schema.
- [Firebase → Sync Strategies → sm2Merge](../firebase/sync-strategies.md#strategy-smm2merge)
  — how SM-2 state syncs across devices.
