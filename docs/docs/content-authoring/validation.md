# Validation

Validation is the gatekeeper for Osler content. Every content file — admin-managed
or user custom — must pass validation before it's saved, committed, synced,
or bundled. This page documents the validation contract.

## What gets validated

| Source | When | Validator |
|--------|------|-----------|
| Admin dashboard content editor | On every keystroke + on save | `src/lib/validate.js` (in PWA bundle) + `tauri-admin/src/validation.rs` (Rust mirror) |
| `npm run validate` (CI) | On every push to `main` + on PR | `scripts/validate-content.js` |
| `npm run validate-schemas` (CI) | Same as above | `scripts/validate-schemas.js` |
| PWA content pack import | On file selection | `src/lib/validate.js` |
| Admin dashboard content pack import | On file selection | `tauri-admin/src/validation.rs` |
| PWA user custom content authoring | On save (before IndexedDB write) | `src/lib/validate.js` |
| Firestore sync (write) | Not validated server-side (rules allow owner-only) | Client-side only — defense-in-depth via schema-version checking (planned in P9.2) |

## The validation contract

`src/lib/validate.js` exports:

```javascript
export function validate(content) {
  // Returns { valid: boolean, errors: ValidationError[] }
}

export function validatePack(pack) {
  // Returns { valid: boolean, errors: ValidationError[], items: ParsedItem[] }
}

export function validateSchema(schema) {
  // Returns { valid: boolean, errors: ValidationError[] }
}
```

### `validate(content)`

Validates a single content item. The function:

1. Reads `content.type` and `content.meta.schemaVersion`.
2. Looks up the schema in the registry (`_meta.json`).
3. If the schema version is unknown, returns:
   ```json
   {
     "valid": false,
     "errors": [{ "message": "Unknown schema version: quiz-9.9" }]
   }
   ```
4. Otherwise, runs the schema validator (Ajv) and returns the result.

### `validatePack(pack)`

Validates a content pack file. The function:

1. Verifies `pack.packFormat === "osler-content-pack"`.
2. Verifies `pack.packVersion === "1.0"`.
3. Verifies every item in `pack.items`:
   - Validates against its schema (calls `validate(item)` per item).
   - Checks UID uniqueness within the pack.
4. Returns the list of valid items (for partial-import use cases) plus any
   errors.

### `validateSchema(schema)`

Validates that a JSON Schema is itself well-formed (against the JSON Schema
meta-schema). Used by `scripts/validate-schemas.js` in CI to catch schema
typos before they break content validation.

## The V19 policy

V19 is the policy that `meta.schemaVersion` must be a known version in
`_meta.json`. This prevents:

- **Silent schema drift** — if you bump a schema version but forget to
  update `_meta.json`, validation fails loudly instead of silently allowing
  unknown versions.
- **Future-version content in old instances** — if a V3 content file is
  loaded by a V2 instance, validation fails (instead of trying to render
  unknown fields and breaking).
- **Malicious packs** — a pack claiming `schemaVersion: "9.9"` is rejected
  rather than written to IndexedDB.

V19 is enforced in `src/lib/validate.js`:

```javascript
const schemaKey = `${typeName}-v${version}.json`;
const validator = ajv.getSchema(`https://osler.app/schemas/${schemaKey}`);
if (!validator) {
  return {
    valid: false,
    errors: [{ message: `Unknown schema version: ${schemaKey}` }]
  };
}
```

## Error format

Errors are returned as an array of `ValidationError`:

```typescript
interface ValidationError {
  message: string;       // Human-readable error message
  path?: string;         // JSON path (e.g. "/questions/0/options/1")
  schemaPath?: string;   // Path in the schema (e.g. "#/properties/questions/items/properties/options/items")
  keyword?: string;      // Ajv keyword (e.g. "type", "required", "minLength")
  params?: object;       // Keyword-specific params
}
```

The admin dashboard's content editor formats these as inline annotations:

- The path is parsed to find the offending field.
- The message is shown in a tooltip and a bottom panel.
- The field is highlighted with a red underline.

Example error for a quiz with a missing `correct` field:

```json
{
  "valid": false,
  "errors": [
    {
      "message": "must have required property 'correct'",
      "path": "/questions/0/options/1",
      "schemaPath": "#/properties/questions/items/properties/options/items/required",
      "keyword": "required",
      "params": { "missingProperty": "correct" }
    }
  ]
}
```

## Common validation errors

### "Unknown schema version: quiz-9.9"

Cause: the content's `meta.schemaVersion` doesn't match any version in
`_meta.json`.

Fix: either update the content's `schemaVersion` to a known version
(`"1.0"`), or add the new version to `_meta.json` (after creating the
schema file).

### "must have required property 'X'"

Cause: a required field is missing from the content.

Fix: add the missing field. The error path tells you where (e.g.
`/questions/0/options/1` means question 0, option 1).

### "must NOT have additional properties"

Cause: the content has a field not in the schema. This is enforced by
`additionalProperties: false` in every schema.

Fix: remove the extra field, OR add it to the schema (with an additive
version bump — see [Schemas → Versioning policy](schemas.md#versioning-policy)).

### "must match pattern"

Cause: a string field doesn't match its regex pattern. Common cases:

- UID with uppercase, underscore, or space (pattern: `^[a-z0-9-]+$`).
- ISO 8601 date without the `Z` suffix.

Fix: edit the field to match the pattern.

### "must be equal to one of the allowed values"

Cause: an enum field has an invalid value. Common cases:

- `lang` not in `["en", "ar", "mixed", "other"]`.
- `difficulty` not in `["easy", "medium", "hard"]`.
- `outcome` (analytics) not in the V20 taxonomy.

Fix: use one of the allowed values.

### "must NOT have more than X characters" / "X items"

Cause: a length constraint is exceeded.

Fix: shorten the field or remove items.

## Validation in the admin dashboard

The admin dashboard's content editor (`tauri-admin/frontend/`) calls the
Rust-side validator (`tauri-admin/src/validation.rs`) on every keystroke.
The Rust validator mirrors `src/lib/validate.js` exactly — same schemas,
same Ajv options, same error format.

To keep the two in sync:

- Both read schemas from `src/schemas/` (the Rust side reads them at build
  time, embedded via `include_str!`).
- Both use the same `_meta.json` registry.
- The `npm run validate-schemas` CI step also runs `cargo test` for the
  Rust validator's unit tests.

If you add a schema or change a version, both validators pick it up
automatically on next build.

## Validation in the PWA

The PWA calls `src/lib/validate.js`:

- On content pack import (before writing to IndexedDB).
- On user custom content authoring (before writing to IndexedDB).
- On content load (defensive — catches corrupted IndexedDB state).

If validation fails on load, the PWA:

1. Logs the error to the console with the full error object.
2. Shows a toast: "Content '{title}' failed validation. See console."
3. Skips the item (the hub shows it greyed out).
4. Reports an analytics event (`content_validation_failed`).

This prevents a single corrupted item from breaking the entire PWA.

## Validation in CI

`scripts/validate-content.js`:

```javascript
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
// ... import schemas + _meta.json

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
// ... addSchema for each

const contentDir = 'content';
const files = readdirSync(contentDir).filter(f => f.endsWith('.json'));

let failures = 0;
for (const file of files) {
  const content = JSON.parse(readFileSync(join(contentDir, file), 'utf8'));
  const result = validate(content);
  if (!result.valid) {
    console.error(`✗ ${file}`);
    for (const err of result.errors) {
      console.error(`  ${err.path || '(root)'}: ${err.message}`);
    }
    failures++;
  } else {
    console.log(`✓ ${file}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) failed validation.`);
  process.exit(1);
}
```

This script runs in CI on every PR and every push to `main`. A failure
blocks the PR.

`scripts/validate-schemas.js` runs the same logic against the schema files
themselves (using the JSON Schema meta-schema). This catches typos in
schema definitions.

## Bypassing validation

You cannot bypass validation:

- The admin editor refuses to save invalid content.
- The PWA refuses to import invalid packs.
- CI refuses to merge PRs with invalid content.
- The generator wizard refuses to bundle invalid content.

If you have a legitimate need to commit content that doesn't validate
(e.g. migrating legacy content with known issues), do it in a separate
branch and fix the content before merging to `main`. Never disable
validation.

## What's next

- [Schemas](schemas.md) — the JSON Schemas.
- [Content Types](content-types.md) — per-type field reference.
- [Development → Testing](../development/testing.md) — the test layers.
