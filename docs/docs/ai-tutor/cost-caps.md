# AI Tutor — Cost Caps

The AI tutor (Phase 12) and the AI content generation pipeline both call
Gemini. They share the same cost caps to prevent runaway spend. This page
documents how the caps work.

## The caps

`src/lib/content-gen.js` exports:

```javascript
export const DAILY_CAP = 20;    // USD per UTC day
export const MONTHLY_CAP = 200; // USD per UTC month
```

These are the V1 values, preserved in V2. They can be adjusted in the admin
dashboard's Settings → AI Generation.

## What counts toward the caps

Both tutor calls and content generation calls count:

| Call type | Model | Typical cost |
|-----------|-------|--------------|
| Tutor — single Q&A | Gemini Flash-Lite | ~$0.0005 |
| Tutor — multi-turn (5 messages) | Gemini Flash-Lite | ~$0.002 |
| Content generation — Stage 1 | Gemini Flash-Lite | ~$0.001 |
| Content generation — Stage 2 | Gemini Flash-Lite | ~$0.002 |
| Content generation — Stage 3 | Gemini Pro | ~$0.01 |

A typical user might make 20-50 tutor calls per day ($0.01-0.025) and
generate content occasionally ($0.015 per batch). The daily cap of $20
covers ~1,000-4,000 tutor calls or ~1,300 generated items per day.

## How spend is tracked

Spend is tracked in `tauri-plugin-store` (for the admin's generation
calls) and in IndexedDB (for the PWA's tutor calls). Both layers report
to Firebase Analytics as `ai_spend` events, which the admin dashboard's
Analytics tab aggregates.

### Admin (content generation) tracking

`tauri-plugin-store` keys:

- `gemini-spend/{YYYY-MM-DD}` — total USD spent on that UTC day
- `gemini-spend/{YYYY-MM}` — total USD spent in that UTC month

After every Gemini call:

1. The admin fetches the response (including the `usage` field with token
   counts).
2. Computes the cost: `prompt_tokens * input_rate + completion_tokens * output_rate`.
   Rates are hardcoded per model (Flash-Lite, Pro) and updated quarterly.
3. Adds to today's daily total and this month's monthly total.
4. Saves to `tauri-plugin-store`.
5. Pushes an `analytics.track('ai_spend', { amount, model, feature: 'content-gen' })`
   event.

### PWA (tutor) tracking

IndexedDB store `aiSpend`:

- One entry per UTC day: `{ date: 'YYYY-MM-DD', amount: 12.34 }`
- One entry per UTC month: `{ month: 'YYYY-MM', amount: 145.67 }`

After every tutor call:

1. The PWA fetches the response (with usage).
2. Computes cost (same formula).
3. Updates the daily and monthly entries.
4. Pushes an `analytics.track('ai_spend', { amount, model, feature: 'tutor' })`
   event.

### Cross-layer aggregation

The admin dashboard's Analytics tab aggregates `ai_spend` events from both
layers (admin + PWA) via Firebase Analytics. The total per day / month is
the sum of:

- All admin generation calls (from all admins using this Firebase project)
- All PWA tutor calls (from all users on this Firebase project)

If the aggregated total approaches the cap, the admin dashboard shows a
warning. (The cap is enforced per-layer, not aggregated — a single user
can't push the project over the cap, only their own device.)

## Enforcement

### Pre-call check

Before every Gemini call (tutor or generation):

1. Read today's daily total.
2. Read this month's monthly total.
3. Estimate the call's cost (based on input length and expected output).
4. If `daily_total + estimated > DAILY_CAP`:
   - Refuse the call.
   - Show: "Daily AI limit reached ($18.50 / $20.00 used). Try again
     tomorrow."
5. If `monthly_total + estimated > MONTHLY_CAP`:
   - Refuse the call.
   - Show: "Monthly AI limit reached ($198.50 / $200.00 used). Try again
     next month."

### Post-call adjustment

After the call:

1. Read the actual cost from the response's `usage` field.
2. If the actual cost is higher than the estimate (the call used more
   tokens than expected), the cap may be exceeded. This is acceptable —
   the next call will be blocked.
3. Update the daily and monthly totals.

The cap is "soft" — a single call can push it over by a few cents. The
hard enforcement is on the NEXT call, which will be blocked.

## Why these cap values?

The V1 caps ($20/day, $200/month) were chosen based on:

- **Free tier coverage** — Google AI Studio's free tier covers ~50
  generations/day on Pro, unlimited on Flash-Lite. The cap is well above
  the free tier for typical use.
- **Cost of a runaway loop** — if a bug causes the tutor to call Gemini in
  an infinite loop, $20/day limits the damage. At ~$0.001 per call, that's
  ~20,000 calls before the cap stops it.
- **Monthly budget for a small school** — $200/month covers a class of 50
  students using the tutor heavily (50 students × 50 calls/day × 30 days ×
  $0.001 ≈ $75/month, leaving headroom).

For larger deployments (universities, commercial use), raise the caps in
Settings. The Osler team recommends keeping the daily cap at 10% of the
monthly cap to limit runaway damage.

## Adjusting the caps

In the admin dashboard:

1. Go to Settings → AI Generation.
2. Edit "Daily cost cap" and "Monthly cost cap".
3. Click Save.

The new caps take effect immediately for the next call. Existing spend
totals are not affected.

The caps are stored per-admin (in `tauri-plugin-store`) for content
generation, and per-PWA-instance (in IndexedDB) for tutor calls. If you
have multiple admins or multiple PWA instances sharing a Firebase project,
each has its own caps.

## Monitoring spend

The admin dashboard's Analytics tab shows:

- **Today** — daily total so far (with breakdown by feature: generation
  vs tutor)
- **This month** — monthly total so far
- **7-day trend** — bar chart of daily spend
- **30-day trend** — line chart of cumulative monthly spend
- **Top users** — top 10 users by tutor spend (only visible if you have
  the service account configured)

For real-time monitoring, set up a Firebase Analytics alert on the
`ai_spend` event (via Google Analytics → Conversions → Events →
`ai_spend` → Set up alert).

## What's next

- [AI Tutor Overview](overview.md) — the tutor's design.
- [Admin Dashboard → AI Content Generation](../admin-dashboard/content-generation.md)
  — the generation pipeline.
- [Admin Dashboard → Settings → AI Generation](../admin-dashboard/settings.md#ai-generation)
  — where to adjust the caps.
