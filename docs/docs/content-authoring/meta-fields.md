# Meta Fields

Every Osler content item has a `meta` object that holds metadata about the
item itself — separate from the item's content (questions, cards, etc.).
This page documents every meta field.

## The `meta` object

```json
{
  "meta": {
    "uid": "cardio-arrhythmias-001",
    "title": "Cardiac Arrhythmias Quiz",
    "schemaVersion": "1.0",
    "createdAt": "2026-06-20T10:00:00Z",
    "updatedAt": "2026-06-25T14:30:00Z",
    "lang": "en",
    "tags": ["cardiology", "arrhythmia", "ecg"],
    "estimatedTime": 600,
    "difficulty": "medium",
    "author": "Dr. Alex Lee"
  }
}
```

## Required fields

### `uid`

- **Type:** string
- **Required:** yes
- **Format:** `{topic}-{type}-{sequence}` (e.g. `cardio-arrhythmias-quiz-001`)
- **Rules:**
  - Globally unique across all content items.
  - Lowercase, hyphens only (no underscores, no spaces).
  - Max 80 characters.
  - Once set, immutable (changing the UID breaks tracker history).

The admin dashboard generates UIDs automatically from the title (slugified)
+ a sequence number. You can override at creation time. After creation,
the UID is locked.

### `title`

- **Type:** string
- **Required:** yes
- **Max length:** 200 characters
- **Markdown:** not supported (plain text only, displayed in lists and
  headers).

The title is the user-facing name of the content. It appears in the hub
grid, search results, and the engine's start screen.

### `schemaVersion`

- **Type:** string
- **Required:** yes
- **Format:** `"{major}.{minor}"` (e.g. `"1.0"`, `"1.1"`, `"2.0"`)
- **Rules:** must match a known version in `src/schemas/_meta.json`'s
  `schemas.{type}.version`.

The V19 policy enforced by `src/lib/validate.js` rejects content with an
unknown `schemaVersion`. See [Validation](validation.md) for details.

### `createdAt`

- **Type:** ISO 8601 string
- **Required:** yes
- **Format:** `YYYY-MM-DDTHH:MM:SSZ` (UTC, Z suffix required)
- **Example:** `"2026-06-20T10:00:00Z"`

Set automatically by the admin dashboard when the content item is created.
Immutable after creation.

### `updatedAt`

- **Type:** ISO 8601 string
- **Required:** yes
- **Format:** same as `createdAt`

Updated automatically by the admin dashboard on every save. Used by the
sync layer for `fieldMergeByUpdatedAt` (see
[Firebase → Sync Strategies](../firebase/sync-strategies.md)).

## Optional fields

### `lang`

- **Type:** string
- **Required:** no (but recommended)
- **Allowed values:** `"en"` / `"ar"` / `"mixed"` / `"other"`
- **Default:** `"en"`

Declares the primary language of the content. Used by:

- The hub's language filter (Phase 11).
- The PWA's font loading (Arabic content triggers Noto Naskh Arabic font
  load).
- The PWA's text direction (Arabic content renders RTL).

`"mixed"` means the content is bilingual (e.g. English questions with
Arabic explanations). `"other"` means a language other than EN or AR
(infrastructure supports it; bundles don't ship for other languages in V2).

V2 does NOT auto-translate. The author writes content in whatever language
they want; `meta.lang` is declarative. (V2 anti-goal §5.7)

### `tags`

- **Type:** array of strings
- **Required:** no
- **Max items:** 20
- **Per-tag max length:** 30 characters
- **Format:** lowercase, hyphens only (e.g. `"cardiology"`, `"anti-arrhythmics"`)

Tags are free-form but normalized: the admin dashboard lowercases and
slugifies on save. Tags are used for:

- Hub filtering (click a tag to see all items with that tag).
- Search (matched against tags in addition to title and content).
- Analytics (the `tags` array is sent with study events for cohort
  analysis).

### `estimatedTime`

- **Type:** number
- **Required:** no
- **Unit:** seconds
- **Example:** `600` (10 minutes)

Displayed in the hub as "≈10 min". Used by:

- The hub's sort-by-time filter.
- The OSCE engine's "you have X minutes" warning (if `settings.timeLimit`
  matches `estimatedTime`).

The admin dashboard auto-estimates based on item count (e.g. 30 seconds
per quiz question, 5 seconds per flashcard). Override if your content
differs.

### `difficulty`

- **Type:** string
- **Required:** no
- **Allowed values:** `"easy"` / `"medium"` / `"hard"`
- **Default:** not set (no badge shown)

Displayed as a colored badge in the hub (green / yellow / red). Used by:

- Hub filtering.
- The AI content generation pipeline (Stage 1 uses this as a prompt input).

### `author`

- **Type:** string
- **Required:** no
- **Max length:** 100 characters
- **Format:** display name (e.g. `"Dr. Alex Lee"`)

Displayed in the content item's metadata panel (small text below the title).
Used to attribute content to the original author — especially important
for shared content packs (see [Site Generation → Content Packs](../site-generation/content-packs.md)).

For admin-managed content, the admin dashboard fills this in from the
GitHub user's display name. For user custom content, the PWA fills it in
from the Firebase user's displayName (or "Anonymous" for guests).

## Hub manifest meta

The hub manifest has a special `meta` object:

```json
{
  "meta": {
    "uid": "manifest",
    "title": "Content Manifest",
    "schemaVersion": "1.0",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

- `uid` is always `"manifest"` — there's only one per instance.
- `title` is always `"Content Manifest"` (not user-facing — internal name).
- `lang`, `tags`, `estimatedTime`, `difficulty`, `author` are not applicable
  and not set.

## Validation

All `meta` fields are validated by the schema (see
[Content Authoring → Schemas](schemas.md)). Common validation errors:

| Error | Cause | Fix |
|-------|-------|-----|
| `must match pattern "^[a-z0-9-]+$"` | UID has uppercase, underscore, or space | Lowercase, hyphens only |
| `must NOT have more than 80 characters` | UID too long | Shorten the UID |
| `must be equal to one of the allowed values` | `lang` or `difficulty` is not in the enum | Use one of the allowed values |
| `must match format "date-time"` | `createdAt` / `updatedAt` is not ISO 8601 | Use `YYYY-MM-DDTHH:MM:SSZ` |
| `must NOT have more than 20 items` | `tags` array too long | Remove some tags |

The admin dashboard shows these errors inline in the content editor. The
CI's `npm run validate` step fails the build if any content file has meta
validation errors.

## What's next

- [Schemas](schemas.md) — the full JSON Schemas.
- [Content Types](content-types.md) — per-type field reference.
- [Validation](validation.md) — the validation contract.
