# Backups

Osler V2 stores data in three places: the GitHub content repo, Firebase
(Firestore + Storage), and each user's IndexedDB (local). This page
documents the backup strategy for each.

## GitHub content repo

The content repo is the source of truth for admin-managed content. It's
already backed up by GitHub's infrastructure (every commit is replicated
across multiple data centers, and GitHub keeps commit history forever).

For additional safety:

### Mirror to a second remote

```bash
# Add a mirror remote (e.g. GitLab, Bitbucket)
cd your-content-repo
git remote add mirror git@gitlab.com:your-username/osler-content.git
git push mirror --all
git push mirror --tags

# Schedule a daily sync via cron
echo "0 2 * * * cd /path/to/osler-content && git fetch origin && git push mirror --all && git push mirror --tags" | crontab -
```

### Periodic archive

```bash
# Weekly archive to cloud storage
0 3 * * 0 cd /path/to && tar -czf osler-content-$(date +\%Y\%m\%d).tar.gz osler-content && aws s3 cp osler-content-$(date +\%Y\%m\%d).tar.gz s3://your-bucket/backups/ && rm osler-content-*.tar.gz
```

Keep at least 4 weeks of archives. Rotate older ones.

## Firebase Firestore

Firestore data includes:

- `users/{uid}/trackers/*` — per-user study progress
- `users/{uid}/streaks/*` — per-user streak counters
- `userContent/{uid}/items/*` — per-user custom content
- `events/{eventId}` — analytics event log

### Automatic backups (Blaze plan)

If you're on the Firebase Blaze plan (pay-as-you-go), enable scheduled
backups:

1. Firebase console → Firestore → Backups.
2. Click "Create backup schedule".
3. Pick a region (same as your Firestore region for performance).
4. Pick a frequency (daily is sufficient).
5. Pick a retention (30 days is reasonable).

Backups land in a Cloud Storage bucket you specify. Cost: ~$0.026 per GB
per month for storage.

### Manual backups (free tier)

If you're on the Spark plan (free tier), automatic backups aren't
available. Use the `gcloud` CLI to export manually:

```bash
# Install the gcloud CLI
# https://cloud.google.com/sdk/docs/install

# Authenticate
gcloud auth login
gcloud config set project your-firebase-project-id

# Export Firestore to a Cloud Storage bucket
# (You need a bucket — create one first in the Firebase console → Storage)
gsutil mb gs://your-firebase-project-id-backups/
gcloud firestore export gs://your-firebase-project-id-backups/$(date +%Y-%m-%d)
```

Schedule as a daily cron on a server (or your local machine if it's always
on):

```cron
0 3 * * * gcloud firestore export gs://your-firebase-project-id-backups/$(date +\%Y-\%m-\%d) >> /var/log/firestore-backup.log 2>&1
```

The export creates a directory in the bucket with all documents. To
restore:

```bash
gcloud firestore import gs://your-firebase-project-id-backups/2026-06-27/
```

Restoring overwrites existing data — use with caution.

### Selective export

To back up only a specific user's data (e.g. for a GDPR data export
request):

```bash
# Export a single user's data
gcloud firestore export gs://bucket/path --collection-ids=users/{uid}/trackers --collection-ids=users/{uid}/streaks --collection-ids=userContent/{uid}/items
```

## Firebase Storage

If you've enabled cloud-based content pack sharing (see
[Firebase → Storage Rules](../firebase/storage-rules.md)), users may have
files in Cloud Storage. Back these up:

### Mirror to a second bucket

```bash
# One-time mirror
gsutil -m rsync -r gs://your-firebase-project-id.appspot.com gs://your-backup-bucket/

# Schedule as a daily cron
0 4 * * * gsutil -m rsync -r gs://your-firebase-project-id.appspot.com gs://your-backup-bucket/ >> /var/log/storage-backup.log 2>&1
```

### Versioning

Enable bucket versioning to keep historical versions of files:

```bash
gsutil versioning set on gs://your-firebase-project-id.appspot.com
```

Versioning keeps every version of a file (with a generation number). To
restore a previous version:

```bash
# List versions
gsutil ls -a gs://bucket/userContent/uid/file.json

# Restore a specific version
gsutil cp gs://bucket/userContent/uid/file.json#12345 ./restored.json
gsutil cp ./restored.json gs://bucket/userContent/uid/file.json
```

## Firebase Authentication

User accounts (email, OAuth tokens, etc.) are stored in Firebase Auth.
To back up:

```bash
# Export all users to a JSON file
firebase auth:export users.json --format=json
```

Schedule as a weekly cron:

```cron
0 5 * * 0 cd /path/to && firebase auth:export users-$(date +\%Y\%m\%d).json --format=json
```

To restore:

```bash
firebase auth:import users.json --hash-algo=BCRYPT
```

(Auth import requires specifying the password hashing algorithm. BCRYPT
is Firebase's default.)

## IndexedDB (per-user)

IndexedDB data lives in each user's browser. You (the site admin) cannot
back this up directly — it's the user's responsibility.

The PWA encourages users to back up by:

- Showing a "Back up your content" reminder every 30 days (toast on hub
  load).
- The export flow is one click (Settings → Export → Save).
- The export includes all user custom content + tracker data.

For users on Firebase mode, the data is also in Firestore (synced), so
the Firebase backups cover it. For users on None mode, the local export
is the only backup.

## What to back up — summary

| Data | Where | Backup method | Frequency |
|------|-------|---------------|-----------|
| Admin-managed content | GitHub repo | Mirror to second remote + periodic archive | Daily |
| Firestore (all collections) | Firebase | Automatic (Blaze) or manual `gcloud firestore export` (Spark) | Daily |
| Firebase Storage (shared packs) | Firebase | `gsutil rsync` to backup bucket | Daily |
| Firebase Auth (user accounts) | Firebase | `firebase auth:export` | Weekly |
| User IndexedDB (None mode) | User's browser | User-initiated export | User's discretion |
| User IndexedDB (Firebase mode) | User's browser + Firestore | Covered by Firestore backup | Daily |

## Restoration procedure

If you need to restore from backup:

### Restore the content repo

```bash
# Clone the backup
git clone git@github.com:your-username/osler-content.git
cd osler-content

# Reset to the backup commit
git reset --hard {backup-commit-sha}

# Push back to the primary remote
git push origin main --force
```

### Restore Firestore

```bash
gcloud firestore import gs://your-firebase-project-id-backups/{date}/
```

This overwrites all current data with the backup. Users will see their
study progress revert to the backup date.

### Restore Firebase Storage

```bash
gsutil -m rsync -r gs://your-backup-bucket/ gs://your-firebase-project-id.appspot.com/
```

### Restore Firebase Auth

```bash
firebase auth:import users.json --hash-algo=BCRYPT
```

## Testing restores

A backup you haven't tested restoring is not a backup. Test quarterly:

1. Create a test Firebase project (separate from production).
2. Restore your latest backup to the test project.
3. Verify data integrity:
   - Spot-check a few users' tracker data.
   - Verify content pack files are accessible.
   - Verify auth works for a test user.
4. Document any issues and update the restoration procedure.

## What's next

- [CI/CD](ci-cd.md) — the pipeline.
- [Monitoring](monitoring.md) — what to watch.
- [Incident Response](incident-response.md) — when to restore.
