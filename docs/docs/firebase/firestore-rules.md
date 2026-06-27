# Firestore Security Rules

Osler V2's Firestore rules enforce owner-only access to user data. This
page documents the full rules, the rationale for each section, and how to
deploy them.

## The full rules

Copy these into the Firebase console → Firestore Database → Rules → Publish:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // =========================================================================
    // User trackers (V1, preserved)
    // Per-type study progress: quiz, bank, flashcard, written, osce
    // Path: users/{uid}/trackers/{type}/{itemId}
    // =========================================================================
    match /users/{uid}/trackers/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // =========================================================================
    // User streaks (V1, preserved)
    // Daily study streak counters
    // Path: users/{uid}/streaks/{type}
    // =========================================================================
    match /users/{uid}/streaks/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // =========================================================================
    // User custom content (V2 new — Phase 9)
    // User-authored quizzes, flashcards, etc.
    // Path: userContent/{uid}/items/{itemId}
    // =========================================================================
    match /userContent/{uid}/items/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      // Optional: validate that the document has a valid schemaVersion
      // before write. Uncomment after P9.2 security review.
      //
      // allow write: if request.auth != null
      //   && request.auth.uid == uid
      //   && request.resource.data.meta.schemaVersion in ['1.0'];
    }

    // =========================================================================
    // Analytics events (V1, preserved)
    // Append-only: authenticated users can create, no one can read
    // Path: events/{eventId}
    // =========================================================================
    match /events/{eventId} {
      allow create: if request.auth != null;
      allow read: if false;  // no client reads — use the admin dashboard
                              // (service account) for aggregation
    }

    // =========================================================================
    // Default: deny everything else
    // =========================================================================
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Section-by-section rationale

### User trackers

```
match /users/{uid}/trackers/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

This rule covers the V1 tracker stores. Each user has a subcollection at
`users/{uid}/trackers/` containing one document per content type (quiz,
bank, flashcard, written, osce). Each document holds an array of tracker
entries (one per item studied).

The rule enforces:

- `request.auth != null` — the user must be signed in. Guest-mode users
  cannot sync (their data is local-only until they upgrade to a real
  account).
- `request.auth.uid == uid` — the user can only read/write their own
  subcollection. No cross-user access.

### User streaks

```
match /users/{uid}/streaks/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Same pattern as trackers. Streaks are simple counters (current streak, max
streak, last-study-date) per content type. Owner-only.

### User custom content (V2 new)

```
match /userContent/{uid}/items/{itemId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

This is the V2 addition. Each user has a subcollection at
`userContent/{uid}/items/` containing one document per content item they've
authored (quizzes, flashcards, etc.).

The rule enforces owner-only access — a user can read and write their own
custom content but cannot see anyone else's.

#### Optional schema validation

The commented-out block shows how to add server-side schema validation:

```
allow write: if request.auth != null
  && request.auth.uid == uid
  && request.resource.data.meta.schemaVersion in ['1.0'];
```

This would reject writes where `meta.schemaVersion` isn't in the known
versions list. It's commented out because:

- It's a hard-coded list — every schema version bump requires a rules
  update.
- Client-side validation (`src/lib/validate.js`) already catches schema
  violations before write.
- It adds latency to every write.

After the Phase 9.2 security review, this block may be uncommented as
defense-in-depth.

### Analytics events

```
match /events/{eventId} {
  allow create: if request.auth != null;
  allow read: if false;
}
```

Analytics events are append-only:

- Any signed-in user can create events (their own study events).
- No client can read events — aggregation is done server-side via the admin
  dashboard (using a service account).

This prevents a malicious user from scraping other users' study data via
the events collection.

### Default deny

```
match /{document=**} {
  allow read, write: if false;
}
```

Any path not explicitly allowed above is denied. This is the catch-all that
prevents accidental data leaks from future collection additions.

## Deploying the rules

### Via the Firebase console (recommended)

1. Go to [console.firebase.google.com](https://console.firebase.google.com/)
   → your project.
2. Build → Firestore Database → Rules.
3. Paste the rules above.
4. Click **Publish**.

The rules take effect immediately for all new requests. Existing connections
are not interrupted.

### Via the Firebase CLI

```bash
# Install the Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize (if not already)
cd your-project-dir
firebase init firestore
# Pick your project, accept the default rules file location

# Save the rules to firestore.rules
# Deploy
firebase deploy --only firestore:rules
```

The CLI approach is recommended for teams — the rules file lives in version
control alongside the rest of the project.

## Testing the rules

The Firebase console has a built-in rules simulator:

1. Go to Firestore → Rules → **Rules playground** tab.
2. Pick a simulation type (get / set / delete).
3. Pick a path (e.g. `/users/abc123/trackers/quiz`).
4. Toggle "Authenticated" and enter a UID.
5. Click **Run**.

Verify:

- Authenticated user with UID `abc123` can read/write
  `/users/abc123/trackers/quiz` → ✓ allow
- Authenticated user with UID `xyz789` cannot read/write
  `/users/abc123/trackers/quiz` → ✓ deny
- Unauthenticated user cannot read/write anything → ✓ deny
- Any user can create `/events/{eventId}` → ✓ allow
- No user can read `/events/{eventId}` → ✓ deny

For automated testing, use the
[@firebase/rules-unit-testing](https://firebase.google.com/docs/rules/rules-unit-testing)
library. Add tests to `tests/integration/firestore-rules.test.js` (V2 will
ship these as part of Phase 9.2).

## Common rules mistakes

### Mistake 1: forgetting the default deny

Without the catch-all `match /{document=**}`, any collection not explicitly
mentioned defaults to whatever Firestore's project-level default is (often
"allow if authenticated"). Always include the default deny.

### Mistake 2: allowing reads by UID path param

```
// WRONG — this allows any signed-in user to read any user's trackers
match /users/{uid}/trackers/{document=**} {
  allow read, write: if request.auth != null;
}
```

The `{uid}` wildcard matches ANY string — including other users' UIDs. The
rule must explicitly compare `request.auth.uid == uid`.

### Mistake 3: trusting client-side validation alone

Client-side validation (`src/lib/validate.js`) can be bypassed by a
determined attacker (modified client). The rules are the security boundary.
Always validate sensitive fields in the rules too (see "Optional schema
validation" above).

### Mistake 4: allowing `list` on user collections

```
// WRONG — allows listing all user documents
match /users/{uid}/trackers/{document=**} {
  allow read: if request.auth != null && request.auth.uid == uid;
}
```

`read` is a shorthand for `get` + `list`. The `list` permission allows
querying the collection (e.g. `db.collection('users/abc/trackers').get()`),
which is fine for the owner. But if you ever add an admin role, be careful
not to grant `list` to admins — they could enumerate all users' trackers.

### Mistake 5: not testing rules in CI

Rules can drift from code. The Phase 9.2 security review will add CI tests
for the rules (using `@firebase/rules-unit-testing`). Until then, manually
test after every rules change.

## What's next

- [Bring Your Own](bring-your-own.md) — full Firebase setup walkthrough.
- [Storage Rules](storage-rules.md) — the companion rules for Cloud Storage.
- [Sync Strategies](sync-strategies.md) — how sync interacts with the rules.
- [Architecture → Security Model](../architecture/security-model.md) — the
  full threat model.
