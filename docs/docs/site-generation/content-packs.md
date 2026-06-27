# Content Packs

Content packs are Osler V2's file-based sharing mechanism (Phase 10). A pack
is a single JSON file containing one or more content items, exportable from
the PWA and importable into another PWA instance. This is the Anki-deck model
— no public registry, no curation, no rate limiting.

## When to use content packs

Use packs when:

- You authored user custom content on one device and want it on another
  (e.g. study on phone during the day, on laptop at night).
- You want to share your content with a classmate (email, USB, chat).
- You want to back up your custom content before clearing browser data.
- You want to migrate custom content from a V1 instance to V2.
- An educator wants to distribute a "starter pack" to students outside the
  CMS workflow (the admin can also export packs from the content repo).

Do NOT use packs for:

- Sharing with the general public (no registry — use a deployed site
  instead).
- Syncing content across your own devices in real-time (use Firebase sync
  instead — see [Firebase → Sync Strategies](../firebase/sync-strategies.md)).
- Distributing admin-managed content (use the GitHub CMS workflow instead).

## The pack format

A content pack is a single JSON file with this structure:

```json
{
  "packFormat": "osler-content-pack",
  "packVersion": "1.0",
  "exportedAt": "2026-06-27T12:00:00Z",
  "exportedBy": {
    "uid": "user-abc123",
    "displayName": "Dr. Alex Lee"
  },
  "sourceInstance": "https://example.osler.app",
  "items": [
    {
      "type": "quiz",
      "meta": {
        "uid": "cardio-arrhythmias-001",
        "title": "Cardiac Arrhythmias Quiz",
        "schemaVersion": "1.0",
        "createdAt": "2026-06-20T10:00:00Z",
        "updatedAt": "2026-06-25T14:30:00Z",
        "lang": "en",
        "tags": ["cardiology", "arrhythmia", "ecg"]
      },
      "questions": [
        {
          "id": "q1",
          "stem": "A 65-year-old male presents with...",
          "options": [
            { "id": "a", "text": "Atrial fibrillation", "correct": true },
            { "id": "b", "text": "Sinus tachycardia", "correct": false }
          ],
          "explanation": "The ECG shows an irregularly irregular rhythm..."
        }
      ]
    },
    {
      "type": "flashcard",
      "meta": { "uid": "cardio-arrhythmias-fc-001", "title": "...", "schemaVersion": "1.0" },
      "cards": [ /* ... */ ]
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `packFormat` | string | yes | Always `"osler-content-pack"` |
| `packVersion` | string | yes | Pack format version. Currently `"1.0"`. |
| `exportedAt` | ISO 8601 string | yes | When the pack was created |
| `exportedBy.uid` | string | yes | UID of the exporting user (Firebase UID or device ID) |
| `exportedBy.displayName` | string | no | Display name (if signed in) |
| `sourceInstance` | string | no | URL of the PWA instance the pack came from |
| `items` | array | yes | One or more content items |
| `items[].type` | string | yes | `quiz` / `bank` / `flashcard` / `written` / `osce` |
| `items[].meta` | object | yes | Per-item metadata (uid, title, schemaVersion, etc.) |
| `items[].meta.uid` | string | yes | Globally unique ID. Must be unique within the pack. |
| `items[].meta.schemaVersion` | string | yes | Must match a known version in `_meta.json` |

Items follow the same schema as admin-managed content. See
[Content Authoring → Schemas](../content-authoring/schemas.md) for the
per-type field reference.

## Exporting a content pack

### From the PWA (user custom content)

1. Open the PWA.
2. Sign in (optional — guests can export too).
3. Click the **Export** button in the hub.
4. The PWA shows a multi-select of your custom content items.
5. Pick the items to include.
6. Click **Export**.
7. The browser downloads `osler-content-pack-{date}.json`.

The pack includes only items you've authored (your `userContent` store). It
never includes admin-managed content (that's available via the GitHub CMS)
and never includes other users' content (you don't have access).

### From the admin dashboard (admin-managed content)

1. Open the admin dashboard.
2. Go to **Content**.
3. Multi-select items (Shift-click).
4. Right-click → **Export → JSON pack**.
5. The admin writes a single `.json` pack and downloads it.

Admin-exported packs are useful for distributing a "starter set" to students
who can't access the GitHub content repo directly.

## Importing a content pack

### From the PWA

1. Open the PWA.
2. Click **Import** in the hub.
3. Pick the `.json` file.
4. The PWA validates the pack:
   - `packFormat` is `"osler-content-pack"`
   - `packVersion` is `"1.0"`
   - Every item validates against its schema
   - Every item's `meta.uid` is unique within the pack
5. If validation passes, the PWA shows a preview:
   - List of items to be imported
   - For each item: title, type, and whether a UID collision exists
6. For UID collisions, the PWA offers three options per item:
   - **Overwrite** — replace the local item with the imported one
   - **Skip** — keep the local item, don't import
   - **Rename** — import with a new UID (the PWA generates a suffix)
7. Click **Import**. The PWA writes the items to the `userContent` IndexedDB
   store.
8. If Firebase sync is configured, the items sync to Firestore on the next
   sync cycle.

### From the admin dashboard

1. Open the admin dashboard.
2. Go to **Content** → **Import** → **JSON pack**.
3. Pick the `.json` file.
4. The admin validates the pack (same checks as the PWA).
5. If valid, the admin commits each item to the content repo and updates
   `manifest.json`.
6. The items are now admin-managed — they'll be bundled into the next site
   generation.

### Validation on import

Import always validates against the schema. The PWA / admin refuses to
import packs that:

- Have an unknown `packFormat`
- Have an unknown `packVersion`
- Contain items that fail schema validation
- Contain items with duplicate UIDs within the pack
- Contain items with `meta.schemaVersion` not in `_meta.json`

This prevents:

- **XSS via `question` field** — schema validation rejects strings containing
  `<script>` tags or other disallowed HTML.
- **Schema version mismatches** — old packs from V1 won't silently corrupt
  V2 storage.
- **Malformed JSON** — parse errors are caught before any write.

See [Content Authoring → Validation](../content-authoring/validation.md) for
the validation contract.

## Size limits

Content packs are JSON files. Practical limits:

- **Browser download limit:** none (modern browsers handle multi-GB files)
- **IndexedDB write limit:** ~50 MB per transaction (Chrome), ~10 MB per
  item (Firefox). Packs larger than 50 MB should be split.
- **Firestore document limit:** 1 MB per document. Individual content items
  that exceed 1 MB must be split into multiple Firestore documents
  (V2 sync handles this transparently via the `userContent/{uid}/items/{itemId}`
  collection — each item is one document).
- **Email attachment limit:** ~25 MB (Gmail). For larger packs, use a file
  sharing service.

For typical use (quizzes with 20-50 questions), packs are 50-200 KB. Large
packs (hundreds of items) are 1-5 MB.

## Sharing patterns

### Educator → student (direct)

The educator authors content in the admin dashboard, exports a pack, and
shares it via the class's existing channel (LMS, email, Discord). Students
import the pack into their PWA. Each student's progress is private (stored
in their IndexedDB).

### Student → student (peer)

A student authors their own flashcards, exports a pack, and shares with a
study partner. The partner imports it. Both students now have the same
content, but their study progress is independent.

### Cross-device (self)

A student authors content on their phone, exports the pack, and imports it
on their laptop. If both devices are signed into the same Firebase account,
sync handles this automatically — packs are a manual fallback when sync
isn't available.

### Backup

Export all your custom content as a pack, store it somewhere safe (cloud
drive, USB). If you clear browser data or change devices, import the pack to
restore.

## Anti-goals

Content packs do NOT:

- **Include a public registry** — there is no central index of packs. Sharing
  is out-of-band (file transfer). (V2 anti-goal §5.4)
- **Have DRM** — packs are plain JSON. Anyone can read, copy, modify them.
  (V2 anti-goal §5.14)
- **Have curation / review** — anyone can create + share; no admin review.
  (V2 anti-goal §5.4)
- **Have rate limiting** — no API to abuse; packs are file transfers.
- **Sync automatically** — packs are point-in-time exports. For live sync,
  use Firebase.

## What's next

- [Wizard](wizard.md) — the site generator wizard (which bundles
  admin-managed content, not packs).
- [Content Authoring → Schemas](../content-authoring/schemas.md) — the
  per-type JSON Schemas.
- [Content Authoring → Validation](../content-authoring/validation.md) —
  the validation contract.
