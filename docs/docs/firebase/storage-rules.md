# Firebase Storage Rules

Osler V2 uses Firebase Cloud Storage for one optional purpose: hosting
exported content pack files that users want to share via URL (instead of
direct file transfer). This page documents the storage security rules and
when you need them.

## When you need Storage rules

You need to deploy these rules only if you want **cloud-based content pack
sharing** — users export a pack, it gets uploaded to your Firebase Storage
bucket, and they share the resulting URL with peers.

If your users share packs via direct file transfer (email, USB, chat), you
don't need Storage rules — leave Storage disabled.

The Storage bucket is **never** used for:

- Admin-managed content (that's in `/content/` in the repo, bundled into
  the site at generation time)
- User custom content (that's in Firestore at `userContent/{uid}/items/`)
- Site assets (images, fonts — those are bundled into the site)
- Service account files (those are on the admin's local disk)

## The full rules

Copy these into the Firebase console → Storage → Rules → Publish:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {

    // =========================================================================
    // User content packs (V2)
    // Path: userContent/{uid}/{filename}
    // Owner-only read/write
    // =========================================================================
    match /userContent/{uid}/{fileName} {
      allow read, write: if request.auth != null
        && request.auth.uid == uid
        && request.resource.size < 50 * 1024 * 1024  // 50 MB max
        && request.resource.contentType.matches('application/json');
    }

    // =========================================================================
    // Public read URLs (optional, opt-in per file)
    // When a user publishes a pack, they set a custom metadata flag
    // `sharePublic = 'true'`. This rule allows public read of such files.
    // =========================================================================
    match /userContent/{uid}/{fileName} {
      allow read: if resource.metadata.sharePublic == 'true';
    }

    // =========================================================================
    // Default: deny everything else
    // =========================================================================
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

## Section-by-section rationale

### User content packs

```
match /userContent/{uid}/{fileName} {
  allow read, write: if request.auth != null
    && request.auth.uid == uid
    && request.resource.size < 50 * 1024 * 1024
    && request.resource.contentType.matches('application/json');
}
```

This rule enforces:

1. **Owner-only access** — `request.auth.uid == uid`. A user can read and
   write only their own pack files.
2. **Size limit** — 50 MB max per file. Prevents abuse (a malicious user
   could otherwise upload gigabytes).
3. **Content type** — must be `application/json`. Prevents the bucket from
   being used to host arbitrary files (images, videos, executables).

The 50 MB limit is generous — typical packs are <5 MB. For packs larger than
50 MB, users should split them or use direct file transfer.

### Public read URLs (optional)

```
match /userContent/{uid}/{fileName} {
  allow read: if resource.metadata.sharePublic == 'true';
}
```

This rule allows public read access to files where the owner has set custom
metadata `sharePublic = 'true'`. The owner sets this when they click
"Share via URL" in the PWA — the upload flow sets the metadata via the
Firebase Storage SDK.

This rule is **additive** with the owner-only rule above. A file with
`sharePublic = 'true'` can be read by anyone (the public URL works for any
anonymous requester). A file without that metadata can only be read by the
owner.

To revoke public access, the owner deletes the `sharePublic` metadata (or
sets it to `'false'`).

### Default deny

```
match /{allPaths=**} {
  allow read, write: if false;
}
```

Any path not explicitly allowed above is denied.

## Deploying the rules

### Via the Firebase console

1. Go to [console.firebase.google.com](https://console.firebase.google.com/)
   → your project.
2. Build → Storage → Rules.
3. Paste the rules above.
4. Click **Publish**.

### Via the Firebase CLI

```bash
firebase deploy --only storage:rules
```

(Assuming you've initialized Firebase in your project with `firebase init
storage`.)

## How users upload packs

The PWA's "Export → Share via URL" flow:

1. User picks items to share.
2. PWA builds the pack JSON.
3. PWA uploads to `userContent/{uid}/{fileName}` with metadata
   `{ sharePublic: 'true' }`.
4. PWA gets a download URL (or constructs one):
   `https://firebasestorage.googleapis.com/v0/b/{bucket}/o/userContent%2F{uid}%2F{fileName}?alt=media`
5. PWA displays the URL for the user to copy.
6. The user shares the URL with peers (email, chat).

Recipients don't need to be signed in to download — the public read rule
allows anonymous access.

## How users delete shared packs

The PWA's "Manage shared packs" UI:

1. Lists all packs in `userContent/{uid}/`.
2. Each row has: filename, size, share status, delete button.
3. Clicking delete removes the file from Storage (via Firebase SDK).
4. Any previously-shared URLs immediately 404.

Deletion is permanent — there's no recycle bin. The rules enforce that only
the owner can delete their own packs.

## Limitations

- **50 MB per file** — enforced by the rules.
- **JSON only** — enforced by the rules.
- **No versioning** — uploading a new file with the same name overwrites the
  old one. Use unique filenames (`osler-pack-{uid}-{timestamp}.json`).
- **No bandwidth cap** — Firebase Storage free tier: 1 GB/day download. If
  a shared pack goes viral, you'll hit the cap and downloads will fail until
  the next day. Upgrade to Blaze plan for unlimited.
- **No automatic cleanup** — packs stay until the owner deletes them.
  Consider a periodic cleanup (Cloud Function, but V2 avoids Functions) or
  rely on the owner to delete.

## Anti-goals

Storage is NOT used for:

- **A public content registry** — there's no index of shared packs. Users
  must share the URL out-of-band. (V2 anti-goal §5.4)
- **DRM** — anyone with the URL can download the pack. There's no access
  control beyond the public/private flag. (V2 anti-goal §5.14)
- **Curation** — anyone can upload; no admin review. (V2 anti-goal §5.4)
- **Rate limiting** — there's no per-user upload rate limit. The 50 MB cap
  is the only protection.

## What's next

- [Bring Your Own](bring-your-own.md) — full Firebase setup walkthrough.
- [Firestore Rules](firestore-rules.md) — the companion rules for Firestore.
- [Site Generation → Content Packs](../site-generation/content-packs.md) —
  the pack format and direct file sharing.
