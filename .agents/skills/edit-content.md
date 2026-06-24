# edit-content

Load, modify, validate, and commit existing Osler content files via the MCP tool surface.

## When to Use

- User asks to edit an existing quiz, bank, flashcard, written, or OSCE file
- Need to fix errors found during validation or review
- User wants to add/remove questions from an existing file

## Inputs

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Relative path to the HTML content file in the project |
| `content` | string | no | New file content (if replacing entirely) |
| `patch` | object | no | JSON patch operations (if using surgical edits) |

## Outputs

```json
{
  "message": "File updated.",
  "validation": { "errors": [], "warnings": [] },
  "path": "cardiology/quiz-1.html"
}
```

## Workflow

1. Call `read_file` MCP tool to load the current file content
2. Parse with `validate` MCP tool to identify current issues
3. Apply edits: modify questions, fix options, update explanations, etc.
4. Validate with `validate` MCP tool — ensure zero errors
5. Write with `write_file` MCP tool
6. Commit with `git_commit` MCP tool (only if user confirms)

## Examples

- "Fix the correct answer for question 3 in cardiology quiz" → read, edit question 3's `correct` field, write, validate
- "Add 2 more questions to the renal bank" → load bank, add questions to array, write, validate

## Notes

- Always validate before committing; schema violations block deployment
- UID changes require explicit user confirmation (or orphans learner progress)
- Keep backup of original content via `git_status` / `git_commit` before making changes
