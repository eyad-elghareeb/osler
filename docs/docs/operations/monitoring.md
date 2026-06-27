# Monitoring

Osler V2 has two monitoring surfaces: the admin dashboard's Analytics tab
(aggregated study behavior) and Firebase Analytics (raw event stream).
This page documents what to watch and how to set up alerts.

## What to monitor

| Metric | Source | Alert threshold |
|--------|--------|-----------------|
| Daily active users | Firebase Analytics | Drop > 50% vs 7-day average |
| AI spend (daily) | `ai_spend` events | > 80% of daily cap |
| AI spend (monthly) | `ai_spend` events | > 80% of monthly cap |
| Failed content validations | `content_validation_failed` events | > 10/day |
| Failed syncs | `sync_failed` events | > 5% of sync attempts |
| Service worker update failures | `sw_update_failed` events | > 1/day |
| Bundle deploy failures | Admin dashboard's Deploy history | Any failure |
| Lighthouse score | CI (Phase 16) | < 90 perf / 85 a11y |
| Firestore document reads | Firebase console | > 80% of free tier |
| Firestore document writes | Firebase console | > 80% of free tier |

## The admin dashboard's Analytics tab

The Analytics tab aggregates Firebase Analytics events via the service
account (configured in [Settings → Firebase](../admin-dashboard/settings.md#firebase)).
It shows:

### Dashboard cards

- **Today's active users** — unique UIDs with at least one event today
- **Today's study sessions** — count of `session_start` events
- **Today's AI spend** — sum of `ai_spend` events (today)
- **This month's AI spend** — sum of `ai_spend` events (month-to-date)

### Charts

- **7-day active users** — line chart of daily active users
- **30-day study sessions** — bar chart of daily session count
- **Content type breakdown** — pie chart of `analytics.track()` events by
  `contentType` (quiz / bank / flashcard / written / osce)
- **Outcome breakdown** — pie chart of `outcome` (correct / wrong / skipped
  / rating_1-4)

### Tables

- **Top content** — top 20 content items by study count
- **Top tags** — top 20 tags by study count
- **Recent errors** — last 100 `error` events (failed validations, failed
  syncs, SW update failures)

## Firebase Analytics (raw)

For ad-hoc analysis, use the Firebase console's Analytics dashboard:

1. Go to [console.firebase.google.com](https://console.firebase.google.com/)
   → your project → Analytics.
2. **Dashboard** — overview cards (similar to the admin's Analytics tab).
3. **Events** — list of all event types with counts. Click any event to
   see parameter breakdowns.
4. **Conversions** — events marked as conversions (V2 doesn't use this).
5. **Audiences** — pre-defined user segments (e.g. "Active in last 7 days",
   "Used AI tutor").
6. **Debugview** — real-time event stream from a single device (use the
   `?debug=true` URL parameter on the PWA to enable debug mode for that
   session).
7. **Realtime** — active users in the last 30 minutes.

### Custom events

Osler V2 sends these custom events (V20 taxonomy):

| Event | Parameters | When |
|-------|------------|------|
| `session_start` | `contentType`, `contentUid` | User opens a content item |
| `quiz_answer` | `contentUid`, `questionId`, `outcome`, `timeSpentMs` | User answers a quiz question |
| `bank_view` | `contentUid`, `itemId`, `markedForReview` | User views a bank item |
| `flashcard_review` | `contentUid`, `cardId`, `outcome` | User rates a flashcard |
| `written_submit` | `contentUid`, `promptId`, `wordCount`, `rating` | User submits a written response |
| `osce_complete` | `contentUid`, `score`, `passed`, `durationMs` | User completes an OSCE case |
| `content_pack_import` | `itemCount`, `valid` | User imports a content pack |
| `content_pack_export` | `itemCount` | User exports a content pack |
| `ai_spend` | `amount`, `model`, `feature` | Every Gemini call |
| `tutor_response_reported` | `contentUid`, `itemId`, `reason` | User reports a tutor response |
| `content_validation_failed` | `contentUid`, `errors` | A content file failed validation |
| `sync_failed` | `store`, `error` | A sync attempt failed |
| `sw_update_failed` | `expectedHash`, `actualHash` | Service worker update verification failed |
| `error` | `module`, `message`, `stack` | Catch-all for uncaught errors |

All events use the V20 taxonomy: `contentType` must be one of `quiz`,
`bank`, `flashcard`, `written`, `osce`. `outcome` must be one of `correct`,
`wrong`, `skipped`, `rating_1`, `rating_2`, `rating_3`, `rating_4`, `null`.

## Setting up alerts

### Firebase Analytics alerts

In the Firebase console → Analytics → Dashboard → "Set up alert" button:

- **Daily active users drop** — alert if DAU drops > 50% vs 7-day average
- **Custom event threshold** — alert if any event count exceeds a threshold
  (e.g. `content_validation_failed` > 10/day)
- **Crashlytics alerts** — V2 doesn't use Crashlytics (no native mobile),
  but Firebase alerts on `error` events work similarly

Alerts are sent via email (to the Firebase project owners) and can be
forwarded to a Slack webhook via Firebase Extensions.

### AI spend alerts

In the admin dashboard → Analytics tab → "Set up spend alert":

- **Daily threshold** — alert at $X daily spend (default: $15, 75% of cap)
- **Monthly threshold** — alert at $X monthly spend (default: $150, 75% of
  cap)

Alerts send to the admin's email and (if configured) a Slack webhook URL.

### Uptime monitoring

For deployed instances, use a free uptime monitor (e.g.
[UptimeRobot](https://uptimerobot.com/)):

1. Sign up (free tier covers 50 monitors).
2. Add an HTTP(s) monitor for your site URL.
3. Set the interval to 5 minutes.
4. Set alert contacts (email, Slack, etc.).

The monitor pings your site every 5 minutes and alerts if it returns
non-200 or times out. This catches provider outages (GitHub Pages, Netlify,
etc.) before users report them.

## Lighthouse monitoring

Phase 16 will add Lighthouse CI to the pipeline. Until then, run Lighthouse
manually:

1. Open the deployed site in Chrome.
2. Open DevTools → Lighthouse tab.
3. Run audit (Performance, Accessibility, Best Practices, SEO, PWA).
4. Verify scores meet V2 targets:
   - Performance: 95+
   - Accessibility: 90+
   - Best Practices: 95+
   - SEO: 90+
   - PWA: pass

Run Lighthouse in both English and Arabic (RTL layout may have different
performance characteristics due to font loading).

## Firestore quota monitoring

In the Firebase console → Firestore → Usage:

- **Reads** — count today / this month
- **Writes** — count today / this month
- **Storage** — total bytes used
- **Bandwidth** — bytes downloaded today / this month

Free tier limits (Spark plan):

- 50K reads / day
- 20K writes / day
- 1 GB storage
- 10 GB bandwidth / month

For ~1,000 active users, expect ~100K reads/day (above free tier). At
that point, upgrade to Blaze plan (pay-as-you-go, ~$0.03 per 100K reads).

## Log monitoring

Osler V2 doesn't ship a centralized log aggregator (V2 anti-goal — no
Cloud Functions, no server-side logging). Logs live in:

- **Browser console** — per-user, ephemeral. Users can share via DevTools
  → Console → "Export" (some browsers).
- **Admin dashboard console** — same as above, on the admin's machine.
- **Service worker logs** — `chrome://serviceworker-internals/` (Chrome)
  or `about:serviceworkers` (Firefox).

For debugging a specific user's issue, ask them to:

1. Open DevTools (F12).
2. Go to Console.
3. Right-click any log → "Save as..." → save the file.
4. Send you the file.

The logs will have `[module] ...` prefixes that indicate which module
emitted each log.

## What's next

- [CI/CD](ci-cd.md) — the pipeline.
- [Backups](backups.md) — backing up Firebase data.
- [Incident Response](incident-response.md) — when things break.
