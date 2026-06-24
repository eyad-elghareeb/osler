# create-flashcard

Generate schema-valid flashcard decks using the Osler AI content pipeline.

## When to Use

- User asks to create flashcards, Anki decks, or study cards
- Need spaced-repetition ready content for medical topics
- User wants cloze-deletion or Q&A format cards

## Inputs

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | yes | Topic description for the flashcard deck |
| `count` | number | no | Number of cards to create (default: 10, max: 50) |
| `apiKey` | string | no | Gemini API key (falls back to stored key) |

## Outputs

```json
{
  "content": {
    "meta": { "uid": "...", "title": "...", "schemaVersion": "1.0", ... },
    "type": "flashcard",
    "cards": [
      { "id": "c_001", "front": "What is ...?", "back": "...", "tags": ["cardio"] }
    ]
  },
  "qualityScore": 0.9,
  "needsReview": false,
  "cost": 0.031
}
```

## Workflow

1. Call `generateContent(prompt, 'flashcard', { count, apiKey })`
2. Stage 1: NL→outline of card topics
3. Stage 2: Extract front/back pairs for each card
4. Stage 3: Convert to schema with unique IDs and timestamps
5. Quality check: front text ≥ 10 chars, back ≥ 20 chars, tags present
6. Return result; route low-quality decks to review

## Examples

- "50 pharmacology flashcards covering beta-blockers" → generates 50 cards with front/back
- "Make flashcards for the brachial plexus with cloze deletions" → includes cloze markers in back

## Notes

- Supports cloze deletion: include `{cloze}` markers in front text
- Tags are auto-generated from the topic outline
- Cost-capped at $20/day, $200/month
