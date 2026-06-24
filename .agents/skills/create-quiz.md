# create-quiz

Generate high-quality, schema-valid quiz or bank content using the Osler AI content pipeline.

## When to Use

- User asks to create new quiz questions, MCQs, or practice tests
- Need to generate USMLE/board-style clinical vignettes
- User wants a question bank for a specific topic

## Inputs

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | yes | Natural language description of the content to create |
| `type` | string | yes | `"quiz"` (standalone questions) or `"bank"` (passage-based) |
| `count` | number | no | Number of items to generate (default: 5, max: 20) |
| `apiKey` | string | no | Gemini API key (falls back to stored key) |

## Outputs

```json
{
  "content": { /* full schema-valid content object */ },
  "qualityScore": 0.85,
  "needsReview": false,
  "cost": 0.042,
  "stages": [
    { "name": "outline", "model": "gemini-3.1-flash-lite", "cost": 0.0015 },
    { "name": "extract", "model": "gemini-3.1-flash-lite", "cost": 0.003 },
    { "name": "convert", "model": "gemini-3.1-pro-preview", "cost": 0.0375 }
  ]
}
```

## Workflow

1. Call `import { generateContent } from '../src/lib/content-gen.js'`
2. Pass the user's prompt with `type: 'quiz'` (or `'bank'`)
3. Check `needsReview` — if true, route to human review queue
4. Present `content` to user for editing in ContentEditor
5. User can validate, edit, and commit via the standard editor workflow

## Examples

- "Create 10 cardiology board-style questions covering ACS management" → generates quiz with 10 MCQs
- "Make a bank of 3 passages about renal physiology with 4 questions each" → generates bank content with passages

## Notes

- Cost caps: $20/day, $200/month (checked automatically)
- Quality score < 0.7 → `needsReview: true` — items need human review
- Schemas are validated after generation; invalid output is retried once
