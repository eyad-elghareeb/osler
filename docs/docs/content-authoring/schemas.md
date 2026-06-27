# Content Schemas

Every Osler content type has a JSON Schema in `src/schemas/`. The schemas
are the source of truth for content structure — the admin dashboard's
editor generates forms from them, `src/lib/validate.js` validates content
against them, and `npm run validate` enforces them in CI.

## Schema files

| File | Content type | Version | Description |
|------|--------------|---------|-------------|
| `_meta.json` | (registry) | 1.0.0 | Schema registry + versioning policy |
| `quiz-v1.json` | quiz | 1.0 | Multiple-choice quiz |
| `bank-v1.json` | bank | 1.0 | Untimed question bank |
| `flashcard-v1.json` | flashcard | 1.0 | SM-2 flashcard deck |
| `written-v1.json` | written | 1.0 | Free-text written assessment |
| `osce-v1.json` | osce | 1.0 | OSCE clinical simulation |
| `hub-v1.json` | hub | 1.0 | Hub / content manifest |

All schemas are JSON Schema draft 2020-12.

## The schema registry (`_meta.json`)

`_meta.json` is the registry that maps content types to schema files and
versions:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://osler.app/schemas/_meta.json",
  "title": "Osler Schema Registry",
  "version": "1.0.0",
  "schemas": {
    "quiz": { "file": "quiz-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
    "bank": { "file": "bank-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
    "flashcard": { "file": "flashcard-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
    "written": { "file": "written-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
    "osce": { "file": "osce-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" },
    "hub": { "file": "hub-v1.json", "version": "1.0", "breakingChangePolicy": "bump-major" }
  },
  "versioningRules": {
    "additive": "bump minor (1.0 → 1.1), old content still validates",
    "breaking": "bump major (v1 → v2), both schemas ship side-by-side",
    "patch": "no version bump, document in CHANGELOG"
  }
}
```

The registry is consumed by:

- `src/lib/validate.js` — to look up the correct schema for a content file
  based on its `meta.schemaVersion`.
- `scripts/validate-content.js` — to validate every file in `content/`
  against the right schema in CI.
- `scripts/validate-schemas.js` — to validate that the schema files
  themselves are well-formed.
- The admin dashboard's content editor — to generate the form for each
  content type.

## Versioning policy

Osler uses a strict versioning policy (V19, enforced by `src/lib/validate.js`):

### Additive changes (minor bump, e.g. 1.0 → 1.1)

- Adding a new optional field.
- Adding a new value to an enum.
- Loosening a constraint (e.g. increasing `maxLength`).

Old content still validates against the new schema. No migration needed.

To make an additive change:

1. Edit the schema file (e.g. add the new optional field).
2. Bump the `version` in `_meta.json` from `"1.0"` to `"1.1"`.
3. Bump the `version` in the schema file's `$id` URL.
4. Run `npm run validate-schemas` to verify the schema is well-formed.
5. Run `npm run validate` to verify existing content still validates.
6. Commit with `feat(schema): add {field} to {type} (v1.1)`.

### Breaking changes (major bump, e.g. v1 → v2)

- Removing a field.
- Renaming a field.
- Adding a new required field.
- Tightening a constraint (e.g. decreasing `maxLength`).
- Changing a field's type.

Old content does NOT validate against the new schema. Both schemas must ship
side-by-side:

1. Create a new schema file `quiz-v2.json` (don't modify `quiz-v1.json`).
2. Update `_meta.json`:
   - Add `"quiz": { "file": "quiz-v2.json", "version": "2.0", "breakingChangePolicy": "bump-major" }`
   - Keep the old entry: `"quiz_v1": { "file": "quiz-v1.json", "version": "1.0", "legacy": true }`
3. Write a migration script `scripts/migrate-quiz-v1-to-v2.js`.
4. Migrate existing content (run the script, commit the migrated content).
5. Run `npm run validate` to verify.
6. Commit with `feat(schema): breaking change to quiz (v2.0)` + a
   `docs/migration/quiz-v1-to-v2.md` documenting the change.

### Patch (no version bump)

- Fixing a typo in a description.
- Adding examples.
- Reordering fields (no semantic change).

No version bump. Document in `PATCH_NOTES.md`.

## Schema structure

Every content schema has the same top-level shape:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://osler.app/schemas/quiz-v1.json",
  "title": "Quiz",
  "description": "A multiple-choice quiz.",
  "type": "object",
  "required": ["type", "meta", "settings", "questions"],
  "additionalProperties": false,
  "properties": {
    "type": { "const": "quiz" },
    "meta": { "$ref": "https://osler.app/schemas/_meta.json#/definitions/meta" },
    "settings": { /* ... */ },
    "questions": { /* ... */ }
  }
}
```

Key conventions:

- `$id` is `https://osler.app/schemas/{type}-v{major}.json`.
- `type` is a `const` (must be the exact string).
- `additionalProperties: false` — no extra fields allowed.
- `meta` is `$ref`'d from `_meta.json`'s `meta` definition.
- `required` lists the mandatory top-level fields.

## The `meta` object

Every content item has a `meta` object with:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uid` | string | yes | Globally unique ID. Format: `{topic}-{type}-{sequence}`. |
| `title` | string | yes | Display title |
| `schemaVersion` | string | yes | Must match a known version in `_meta.json` |
| `createdAt` | ISO 8601 string | yes | When the item was created |
| `updatedAt` | ISO 8601 string | yes | When the item was last modified |
| `lang` | string | no | `"en"` / `"ar"` / `"mixed"` / `"other"` |
| `tags` | string[] | no | For filtering / search |
| `estimatedTime` | number | no | Seconds, for the hub display |
| `difficulty` | string | no | `"easy"` / `"medium"` / `"hard"` |
| `author` | string | no | Display name of the author |

See [Content Authoring → Meta Fields](meta-fields.md) for the full
reference.

## Validation

Validation is done by `src/lib/validate.js`:

```javascript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import metaSchema from '../schemas/_meta.json';
import quizSchema from '../schemas/quiz-v1.json';
// ... import all schemas

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

ajv.addSchema(metaSchema);
ajv.addSchema(quizSchema);
// ... add all schemas

export function validate(content) {
  const typeName = content.type;
  const version = content.meta?.schemaVersion;
  if (!typeName || !version) {
    return { valid: false, errors: [{ message: 'Missing type or schemaVersion' }] };
  }

  const schemaKey = `${typeName}-v${version}.json`;
  const validator = ajv.getSchema(`https://osler.app/schemas/${schemaKey}`);
  if (!validator) {
    return { valid: false, errors: [{ message: `Unknown schema version: ${schemaKey}` }] };
  }

  const valid = validator(content);
  return { valid, errors: validator.errors };
}
```

Key points:

- `allErrors: true` — report all errors, not just the first.
- `strict: false` — allow unknown keywords (some schemas use them for
  documentation).
- The validator is looked up by `type` + `schemaVersion`. If the version
  isn't in the registry, validation fails (V19 policy).
- The function returns `{ valid, errors }` — the caller decides how to
  surface errors.

See [Content Authoring → Validation](validation.md) for the full validation
contract.

## Adding a new content type

V2 explicitly limits content types to 5 (quiz, bank, flashcard, written,
osce) plus the hub manifest. Adding a new type is an anti-goal violation
unless discussed in advance.

If a new type is approved (V3+):

1. Create `src/schemas/{type}-v1.json` with the schema.
2. Add an entry to `_meta.json`'s `schemas` object.
3. Implement the engine in `engines/{type}-engine.js`.
4. Add the type to the V20 analytics taxonomy in `src/lib/analytics.js`.
5. Add a `STORE_NAMES.{type}Tracker` entry in `src/lib/storage.js`.
6. Update the generator wizard's engine picker.
7. Add tests in `tests/unit/lib/validate.test.js`.
8. Add an E2E spec in `tests/e2e/{type}-session.spec.js`.
9. Document the engine in `docs/engines/{type}.md`.

This is a significant change — discuss in a GitHub Discussion before
starting.

## What's next

- [Content Types](content-types.md) — per-type field reference.
- [Meta Fields](meta-fields.md) — the `meta` object in detail.
- [Validation](validation.md) — the validation contract.
