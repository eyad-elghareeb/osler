# anki-csv

Import Anki-exported CSV or TSV files into Osler flashcard content.

## When to Use

- User has an Anki deck export (.csv or .tsv) they want to use in Osler
- User asks "import my Anki cards" or "convert Anki CSV to flashcards"
- User provides a spreadsheet with Q&A pairs

## Inputs

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Path to the CSV/TSV file in the project |
| `delimiter` | string | no | Column delimiter: `","` (default) or `"\t"` for TSV |
| `columns` | string | no | Column mapping: `"front,back,tags"` (default) or custom order |
| `hasHeader` | boolean | no | Whether the first row is a header (default: true) |

## Outputs

```json
{
  "content": {
    "meta": { "uid": "anki_import_001", "title": "Imported Deck", ... },
    "type": "flashcard",
    "cards": [
      { "id": "c_001", "front": "...", "back": "...", "tags": ["imported"] }
    ]
  },
  "cardCount": 50,
  "errors": ["Row 12: missing back field, skipped"],
  "path": "flashcard/imported-anki-deck.html"
}
```

## Workflow

1. Read the CSV file via `read_file` MCP tool
2. Parse rows using the specified delimiter and column mapping
3. Validate each row: front and back must be non-empty
4. Generate unique card IDs (`c_001`, `c_002`, ...)
5. Generate a flashcard HTML file using `templates::create_flashcard_html`
6. Write via `write_file` MCP tool
7. Report skipped rows as warnings

## Examples

- CSV: `front,back,tags` → each row becomes a basic card
- TSV: `question\tanswer` → column mapping `"front,back"`
- CSV with header `"Term,Definition,Deck"` → mapping `"front,back,tags"`

## Notes

- Uses `parse_json_questions` Rust command for server-side CSV parsing
- Supports Anki's HTML formatting in front/back (preserved as-is)
- Tags column can be semicolon-separated for multiple tags
- Maximum file size: 50 MB (enforced by read_external_file)
