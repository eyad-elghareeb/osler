# Content CMS

The Osler admin dashboard's GitHub CMS workflow is the only way to author
**admin-managed content** — JSON files for quiz, bank, flashcard, written,
and OSCE engines. This page describes the workflow end-to-end.

## The CMS model

Osler does not store admin-managed content in a database. Content lives as
JSON files in a GitHub repository (the "content repo"). The admin dashboard
reads and writes these files via the GitHub API. This gives you:

- **Version history** — every change is a commit, with diff and author.
- **Collaboration** — multiple admins can edit (GitHub handles merge
  conflicts).
- **Backup** — the content repo is your backup. Clone it, fork it, mirror it.
- **CI** — push to `main` triggers `npm run validate` in CI; invalid content
  fails the build.
- **Transparency** — content is public-by-default JSON. Users can audit it.

## Setting up the content repo

See [Installation → Configuring the content repo](installation.md#configuring-the-content-repo).
The admin creates a repo named `osler-content` (configurable) with:

```
osler-content/
├── manifest.json          # Lists all content items by UID + path
├── .gitignore             # Ignores editor backups, *.tmp, etc.
├── README.md              # Auto-generated overview
└── content/
    ├── sample-quiz.json
    ├── sample-flashcard.json
    ├── sample-bank.json
    ├── sample-written.json
    └── sample-osce.json
```

The `manifest.json` is the index — it lists every content item by UID, type,
title, and path. The PWA reads `manifest.json` first, then loads individual
content files on demand.

## The manifest format

```json
{
  "type": "hub",
  "meta": {
    "uid": "manifest",
    "title": "Content Manifest",
    "schemaVersion": "1.0",
    "createdAt": "2026-06-23T00:00:00Z",
    "updatedAt": "2026-06-23T00:00:00Z"
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

The admin maintains `manifest.json` automatically — every create/update/delete
operation rewrites it. You should not edit `manifest.json` by hand.

## The content editor

The admin's **Content** tab lists every content item in the repo. Click any
item to open the content editor, which has three panels:

1. **Left panel** — the JSON tree (collapsible, with syntax highlighting via
   CodeMirror).
2. **Center panel** — a form view, generated from the JSON Schema. Fields are
   typed (text, number, select, multiselect, array). Editing the form updates
   the JSON in real time.
3. **Right panel** — a live preview of how the content will render in the
   PWA (quiz questions, flashcard fronts/backs, etc.).

You can edit either the form or the JSON directly — they stay in sync. The
form is friendlier for non-technical authors; the JSON view is faster for
power users.

### Validation in the editor

The editor validates against the JSON Schema on every keystroke. Errors
appear inline (red underline + tooltip) and in a bottom panel. You cannot
save content with validation errors.

### Schema version

Every content file has a `meta.schemaVersion` field. The current version is
`1.0` for all content types. If you bump a schema version (major or minor),
update `src/schemas/_meta.json` and migrate existing content. See
[Content Authoring → Validation](../content-authoring/validation.md) for the
versioning policy.

## Creating a new content item

1. Go to **Content** → **New**.
2. Pick a content type (quiz, bank, flashcard, written, osce).
3. Enter a UID (e.g. `cardio-arrhythmias-quiz-001`). UIDs are immutable.
4. Enter a title.
5. The admin creates a minimal skeleton JSON file with the correct schema
   version and opens it in the editor.
6. Author the content (add questions, options, explanations, etc.).
7. Click **Save**. The admin commits to the content repo with a message like
   `feat(content): add cardio-arrhythmias-quiz-001`.
8. The admin updates `manifest.json` automatically.

## Editing an existing content item

1. Go to **Content**.
2. Click the item to edit.
3. Make changes in the editor.
4. Click **Save**. The admin commits with `feat(content): update {uid}` or
   `fix(content): ...` depending on the change scope.

## Deleting a content item

1. Go to **Content**.
2. Right-click the item → **Delete**.
3. Confirm. The admin deletes the file from the repo and updates
   `manifest.json`. The commit message is `chore(content): remove {uid}`.

Deletion is reversible via GitHub's commit history (revert the delete commit).

## Importing content

The admin supports two import formats:

### Anki CSV import

1. Go to **Content** → **Import** → **Anki CSV**.
2. Pick the CSV file (exported from Anki via File → Export → "Cards in Plain
   Text").
3. Map CSV columns to flashcard fields (front, back, tags).
4. Click **Import**. The admin creates a new flashcard content item per row,
   commits to the repo, and updates `manifest.json`.

See `src/lib/anki.js` for the field mapping logic.

### JSON pack import

1. Go to **Content** → **Import** → **JSON pack**.
2. Pick a `.json` file (either an Osler content pack exported from the PWA,
   or a hand-authored file matching a content schema).
3. The admin validates the pack against the schema.
4. If valid, the admin commits each item to the repo and updates
   `manifest.json`.

This is the workflow for sharing content between Osler instances — see
[Site Generation → Content Packs](../site-generation/content-packs.md).

## Exporting content

### Export as PDF

1. Go to **Content**.
2. Right-click an item → **Export → PDF**.
3. The admin invokes `scripts/pdf_generator.py` (via `pdf.rs`) which uses
   ReportLab to produce a typeset PDF.
4. The PDF downloads to your Downloads folder.

The PDF is print-ready (A4 or Letter, configurable in Settings).

### Export as Anki CSV

1. Go to **Content**.
2. Right-click a flashcard item → **Export → Anki CSV**.
3. The admin generates a CSV compatible with Anki's import.
4. The CSV downloads.

### Export as JSON pack

1. Go to **Content**.
2. Multi-select items (Shift-click).
3. Right-click → **Export → JSON pack**.
4. The admin writes a single `.json` file containing all selected items.
5. The file downloads as `osler-content-pack-{date}.json`.

This pack can be imported into another Osler instance (admin or PWA).

## Commit message conventions

The admin uses conventional commits for content operations:

| Operation | Commit message |
|-----------|---------------|
| Create | `feat(content): add {uid}` |
| Update | `feat(content): update {uid}` or `fix(content): {uid} - {description}` |
| Delete | `chore(content): remove {uid}` |
| Import | `feat(content): import {pack-name}` |
| Bulk update | `chore(content): bulk {operation}` |

You can override the message in the Save dialog (click the message field
before saving).

## Conflict resolution

If two admins edit the same content item simultaneously, the second save
will hit a merge conflict. The admin:

1. Detects the conflict (GitHub API returns 409).
2. Fetches the remote version.
3. Shows a diff dialog (your version vs. remote).
4. Asks you to choose: keep yours, keep theirs, or merge manually.
5. If merge manually, opens a 3-way merge editor.
6. On save, retries the commit.

If you cancel, your changes are kept locally as a draft (in
`tauri-plugin-store` under `drafts/{uid}`) and you can resume later.

## Content branching strategy

For solo admins, the default workflow is commit-directly-to-`main`. For
teams, the admin supports a branch-based workflow:

1. Go to **Settings** → **Content Workflow**.
2. Toggle **Use branches for content edits** on.
3. Each edit creates a branch `content/{uid}-{timestamp}` instead of
   committing directly to `main`.
4. The admin opens a PR for the branch.
5. After review, the PR is merged via the GitHub UI (or the admin's PR list).

This is opt-in. The default is direct-to-`main` for simplicity.

## What's next

- [AI Content Generation](content-generation.md) — the 3-stage Gemini pipeline.
- [Content Authoring → Schemas](../content-authoring/schemas.md) — the JSON
  Schemas in detail.
- [Content Authoring → Content Types](../content-authoring/content-types.md)
  — per-type field reference.
