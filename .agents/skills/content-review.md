# content-review

Review and approve AI-generated content that was flagged as "Needs Review" (quality score < 0.7).

## When to Use

- User wants to check pending AI-generated content
- A `needsReview` flag was returned from `generateContent()`
- User asks to "review pending content" or "check AI quality"

## Inputs

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | yes | `"list"`, `"review"`, `"approve"`, or `"reject"` |
| `path` | string | only for review/approve/reject | Path to the file being reviewed |
| `feedback` | string | no | Human feedback for rejected content |

## Outputs

```json
{
  "queueLength": 3,
  "current": {
    "path": "cardiology/generated-quiz.html",
    "qualityScore": 0.55,
    "issues": ["explanations too short", "options < 4 on 2 questions"]
  }
}
```

## Workflow

1. List all files with `aiQualityAlert === "Needs Review"` via RepoBrowser filter or MCP search
2. Open each file in ContentEditor
3. Inspect quality issues: short explanations, missing options, incorrect answers
4. For each item: either edit (→ edit-content workflow) or reject (flag for regeneration)
5. Mark approved content by setting `meta.aiQualityAlert = null`
6. Commit approved files

## Quality Heuristics

| Signal | Threshold | Action |
|--------|-----------|--------|
| Question text < 30 chars | Low quality | Rewrite prompt |
| Options < 4 per question | Low quality | Add distractors |
| Explanation < 30 chars | Low quality | Expand explanation |
| No tags | Low quality | Add relevant tags |
| Incorrect answer pattern | Logical error | Fix manually |

## Notes

- Content with `qualityScore ≥ 0.7` is auto-approved; only low-scoring content enters the queue
- The review queue is stored as an array in localStorage (`osler_ai_review_queue`)
- Approved content should be committed with `git_commit`; rejected content with feedback should be deleted
