# Incident Response

This page describes how to respond when Osler V2 breaks in production.
It covers severity levels, communication, and per-issue playbooks.

## Severity levels

| Severity | Definition | Examples | Response time |
|----------|------------|----------|---------------|
| **SEV-1** | Site is down or data is being lost | Deploy broke the site for all users; Firestore rules leak user data | < 15 min |
| **SEV-2** | Major feature broken for many users | AI tutor down; sync broken for > 25% of users | < 1 hour |
| **SEV-3** | Minor feature broken or affects few users | RTL layout glitch on one engine; content pack import fails for one specific pack | < 1 business day |
| **SEV-4** | Cosmetic / UX issue | Typo in UI; spacing off by 4px | Next release |

## Communication channels

| Audience | Channel |
|----------|---------|
| Internal team | Slack `#osler-incidents` |
| Users (SEV-1/2) | Status banner on the site (Phase 16 will add this) |
| Users (SEV-3/4) | GitHub Issue + release notes |
| Stakeholders | Email summary post-incident |

## SEV-1 playbooks

### Playbook: deployed site is broken (blank page, JS errors)

1. **Roll back immediately.** Don't debug live — use the admin's Deploy →
   History → Roll back button (or the provider's UI). See
   [Deployment → Rollback](../deployment/rollback.md).
2. **Verify rollback worked.** Open the site in an incognito window.
   Hard-reload. Verify the previous version loads.
3. **Communicate.** Post in `#osler-incidents`: "Site broken after deploy
   of v1.2.3. Rolled back to v1.2.2. Investigating."
4. **Reproduce locally.** Pull the broken commit, run locally, find the
   bug.
5. **Fix + test.** Write a regression test. Verify locally.
6. **Redeploy.** Push the fix as v1.2.4.
7. **Post-incident review.** Within 24 hours, write a postmortem:
   - What broke?
   - Why didn't CI catch it?
   - What's the fix to prevent recurrence?

### Playbook: Firestore rules leak user data

1. **Update rules immediately.** Paste the correct rules (see
   [Firebase → Firestore Rules](../firebase/firestore-rules.md)) into the
   Firebase console → Firestore → Rules → Publish. Takes effect in < 1
   minute.
2. **Audit access logs.** Firebase console → Firestore → Usage. Look for
   anomalous reads (e.g. a single IP reading many users' data).
3. **Notify affected users.** If you can identify which users' data was
   accessed, email them. Be honest about what happened.
4. **Notify Firebase / Google.** For data leaks involving Google's
   infrastructure, file a support ticket.
5. **Post-incident review.** How did the bad rules get deployed? Was there
   a code review gap? Add a CI test for rules (using
   `@firebase/rules-unit-testing`).

### Playbook: Firebase project deleted / disabled

1. **Don't panic.** Firebase projects can be recovered within 30 days of
   deletion. Contact Firebase support immediately.
2. **Communicate.** Users will see "Firebase auth failed" errors. Post a
   status update.
3. **Restore.** Work with Firebase support to restore the project.
4. **Post-incident review.** Enable 2FA on the Google account that owns
   the Firebase project. Restrict who can delete projects (Firebase IAM).

## SEV-2 playbooks

### Playbook: AI tutor down (Gemini API errors)

1. **Verify it's a Gemini issue.** Check the Gemini status page
   ([ai.google.dev/status](https://ai.google.dev/status)). If Gemini is
   down, wait — there's nothing to do.
2. **If Gemini is up but the tutor fails**, check:
   - Is the API key still valid? (Admin Settings → AI Generation → Test)
   - Has the daily cap been hit? (Admin Analytics tab → AI spend)
   - Is there a network issue? (Test from the admin's machine)
3. **If the API key is invalid**, regenerate and update.
4. **If the cap is hit**, raise the cap in Settings (temporary measure)
   and investigate why usage spiked.
5. **Communicate.** Post in `#osler-incidents`. The tutor is non-essential
   (users can study without it), so no user-facing banner needed.
6. **Post-incident review.** If usage spiked, was it organic or a runaway
   loop? If a loop, find and fix the bug.

### Playbook: sync broken for many users

1. **Verify.** Check Firebase Analytics for `sync_failed` events. If
   > 5% of sync attempts fail in the last hour, this is a SEV-2.
2. **Check Firestore rules.** Did a recent rules update break writes?
3. **Check Firestore quota.** Did you hit the daily write limit? (Firebase
   console → Firestore → Usage.)
4. **Check the PWA's sync.js.** Did a recent deploy introduce a bug?
   Check the diff.
5. **Roll back the deploy** if a recent change caused it. See the
   SEV-1 playbook above.
6. **Communicate.** Users will see "Sync failed" toasts. Post a status
   update.
7. **Post-incident review.** Why didn't CI catch the bug? Add a regression
   test.

## SEV-3 playbooks

### Playbook: RTL layout glitch

1. **Verify.** Switch to Arabic, reproduce the issue.
2. **Find the offending CSS.** Use DevTools → Inspect Element. Look for
   hardcoded `margin-left` / `padding-right` / `left` / `right`.
3. **Fix with logical properties.** See [i18n → RTL Guide](../i18n/rtl-guide.md).
4. **Test both LTR and RTL.**
5. **Add a Playwright RTL test** if the layout is complex.
6. **PR + merge.** No urgency — next release is fine.

### Playbook: content pack import fails for one specific pack

1. **Get the pack file.** Ask the user to send it (or share the URL).
2. **Reproduce locally.** Open the PWA, try to import.
3. **Check the error.** Most likely:
   - Schema version mismatch (pack uses an unknown `schemaVersion`).
   - Schema validation failure (a field is missing or wrong type).
   - UID collision (pack has a UID that exists locally).
4. **If the pack is malformed**, tell the user. Don't try to fix the pack
   — fix the source.
5. **If the pack is valid but our validator is too strict**, fix the
   validator (with a test) and merge.
6. **If UID collision**, instruct the user to use the "Rename" option on
   import.

## SEV-4 playbooks

### Playbook: typo in UI

1. Fix in the next PR. Add to the i18n bundle if it's a string.
2. No urgency.

## Post-incident review template

For SEV-1 and SEV-2 incidents, write a postmortem within 24 hours. Use
this template:

```markdown
# Postmortem: {Incident title}

**Date:** YYYY-MM-DD
**Severity:** SEV-X
**Duration:** X hours Y minutes
**Impact:** {Who was affected, how}

## Summary

{1-2 sentence summary}

## Timeline

- HH:MM — Issue detected (how?)
- HH:MM — Investigation began
- HH:MM — Root cause identified
- HH:MM — Fix deployed
- HH:MM — Verified resolved

## Root cause

{Technical explanation}

## What went well

- {Thing 1}
- {Thing 2}

## What went wrong

- {Thing 1}
- {Thing 2}

## Action items

- [ ] {Action 1} — owner: {name} — due: {date}
- [ ] {Action 2} — owner: {name} — due: {date}

## Lessons learned

{1-2 paragraphs on what to do differently next time}
```

Share the postmortem in `#osler-incidents` and the project wiki.

## On-call rotation

For teams, set up an on-call rotation (e.g. via PagerDuty or Opsgenie):

- **Primary on-call** — first responder for SEV-1/2 incidents, 24/7.
- **Secondary on-call** — backup if primary doesn't respond in 5 minutes.
- **Rotation** — weekly (Monday to Monday).
- **Handoff** — Monday morning, primary briefs the next primary on any
  open issues.

For solo admins, you're implicitly on-call 24/7. Set up alerts (see
[Monitoring](monitoring.md)) so you know about incidents ASAP.

## Status page

Phase 16 will add a status page (e.g. `status.osler.app`) showing:

- Current status (operational / degraded / down)
- Recent incidents (last 30 days)
- Scheduled maintenance

Until then, use GitHub Discussions for status updates, or a third-party
status page service (StatusPage.io, Atlassian Statuspage, etc.).

## What's next

- [Monitoring](monitoring.md) — what to watch.
- [Backups](backups.md) — restoring from backup.
- [Deployment → Rollback](../deployment/rollback.md) — the rollback flow.
