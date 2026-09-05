/**
 * Press-kit screenshot generator for Osler.
 *
 * Drives the hosted demo (or any instance via OSLER_BASE_URL) with headless
 * Chrome, seeds a guest session + theme, mocks the cloud Worker `/v1/*` API so
 * admin surfaces render without real credentials, and captures every surface
 * at phone (390x844 @3x) and desktop (1920x1080) sizes in dark + light.
 *
 * Usage:
 *   node scripts/screenshot-press-kit.mjs [--forms=desktop,phone] [--themes=dark,light] [--only=dashboard,admin-*]
 *
 * Output: screenshots/<form>/<theme>/<surface>.png
 */

import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.OSLER_BASE_URL || "https://osler-demo.pages.dev").replace(/\/$/, "");
const OUT_ROOT = path.resolve("screenshots");

const args = process.argv.slice(2);
const arg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const FORMS = arg("forms", "desktop,phone").split(",");
const THEMES = arg("themes", "dark,light").split(",");
const ONLY = arg("only", "").split(",").filter(Boolean).map((s) => s.replace(/\.png$/, ""));

const FORMS_CFG = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const USER_AGENT_PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// ── Seed storage (runs before page scripts on every navigation) ──────────────

const SESSION_KEY = "osler-cloud-session-v1";
const mockSession = {
  token: "press-kit-mock-token",
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  user: {
    id: "u-press-sarah",
    username: "sarah",
    displayName: "Sarah Chen",
    role: "admin",
    email: "sarah.chen@osler.app",
    hasPassword: true,
  },
};

function initScript(theme, { session = true } = {}) {
  return `(function () {
    try {
      localStorage.setItem("osler-theme", ${JSON.stringify(theme)});
      localStorage.setItem("osler-onboarding-complete", "1");
      localStorage.setItem("osler_cookie_consent", "1");
      for (const tour of ["qbank-hub", "qbank-session", "library"]) {
        localStorage.setItem("osler-walkthrough-v2-" + tour, "1");
      }
      ${session ? `
      const s = ${JSON.stringify(mockSession)};
      sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify(s));
      localStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify(s));
      sessionStorage.setItem("osler-local-session", "Sarah Chen");
      localStorage.setItem("osler-local-session", "Sarah Chen");` : ""}
    } catch {}
  })();`;
}

const HIDE_SCROLLBARS = `::-webkit-scrollbar{width:0!important;height:0!important}html{scrollbar-width:none!important}`;

// ── Mock cloud Worker responses (all /v1/* traffic is intercepted) ───────────

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const iso = (d) => now - d * day;

const adminIdentity = {
  user: { ...mockSession.user, createdAt: iso(400), updatedAt: iso(2) },
  capabilities: {
    manageUsers: true, manageContent: true, approveContent: true, publishDirect: true,
    viewStats: true, viewAudit: true, manageSessions: true,
  },
};

const adminStats = { userCount: 128, sessionCount: 342, contentCount: 96, pendingCount: 3, publishedCount: 84, draftCount: 12 };

const contentObjects = [
  { id: "co-101", content_type: "quiz", title: "Acute Coronary Syndromes — Advanced Set", status: "published", language: "en", creator_display_name: "Sarah Chen", created_by: "u-press-sarah", created_at: iso(40), updated_at: iso(1), submitted_at: null, reviewed_by: "u-press-sarah", reviewed_at: iso(38), rejection_reason: null },
  { id: "co-102", content_type: "flashcard", title: "Neuro Pharmacology Deck", status: "published", language: "en", creator_display_name: "Omar Haddad", created_by: "u-omar", created_at: iso(70), updated_at: iso(4), submitted_at: null, reviewed_by: "u-press-sarah", reviewed_at: iso(66), rejection_reason: null },
  { id: "co-103", content_type: "library", title: "Approach to Syncope", status: "pending", language: "en", creator_display_name: "Lina Farouk", created_by: "u-lina", created_at: iso(6), updated_at: iso(0.2), submitted_at: iso(0.2), reviewed_by: null, reviewed_at: null, rejection_reason: null },
  { id: "co-104", content_type: "osce", title: "Breaking Bad News Station", status: "pending", language: "en", creator_display_name: "Lina Farouk", created_by: "u-lina", created_at: iso(5), updated_at: iso(0.3), submitted_at: iso(0.3), reviewed_by: null, reviewed_at: null, rejection_reason: null },
  { id: "co-105", content_type: "written", title: "Renal Physiology Short Answers", status: "draft", language: "en", creator_display_name: "Sarah Chen", created_by: "u-press-sarah", created_at: iso(12), updated_at: iso(2), submitted_at: null, reviewed_by: null, reviewed_at: null, rejection_reason: null },
  { id: "co-106", content_type: "quiz", title: "أسئلة الأمراض الباطنة", status: "published", language: "ar", creator_display_name: "Omar Haddad", created_by: "u-omar", created_at: iso(90), updated_at: iso(9), submitted_at: null, reviewed_by: "u-press-sarah", reviewed_at: iso(85), rejection_reason: null },
  { id: "co-107", content_type: "library", title: "Pediatric Asthma Update", status: "draft", language: "en", creator_display_name: "Lina Farouk", created_by: "u-lina", created_at: iso(3), updated_at: iso(1.5), submitted_at: null, reviewed_by: null, reviewed_at: null, rejection_reason: null },
  { id: "co-108", content_type: "bank", title: "Multisystem Vignettes — Volume 2", status: "rejected", language: "en", creator_display_name: "Omar Haddad", created_by: "u-omar", created_at: iso(30), updated_at: iso(20), submitted_at: iso(22), reviewed_by: "u-press-sarah", reviewed_at: iso(20), rejection_reason: "Needs updated guidelines reference in item 4." },
];

const adminUsers = [
  ["u-press-sarah", "sarah", "Sarah Chen", "admin", "sarah.chen@osler.app", 400],
  ["u-omar", "omar.haddad", "Omar Haddad", "content_admin", "omar.h@medschool.edu", 380],
  ["u-lina", "lina.farouk", "Lina Farouk", "student", "lina.farouk@medschool.edu", 210],
  ["u-james", "james.okafor", "James Okafor", "student", "j.okafor@medschool.edu", 190],
  ["u-mariam", "mariam.ali", "Mariam Ali", "student", "m.ali@medschool.edu", 120],
  ["u-daniel", "daniel.reyes", "Daniel Reyes", "student", "d.reyes@medschool.edu", 60],
  ["u-priya", "priya.nair", "Priya Nair", "student", "p.nair@medschool.edu", 30],
  ["u-tom", "tom.becker", "Tom Becker", "student", "t.becker@medschool.edu", 9],
].map(([id, username, displayName, role, email, days]) => ({ id, username, displayName, role, email, createdAt: iso(days), updatedAt: iso(days / 10) }));

const adminTickets = [
  { id: "tk-301", userId: "u-james", username: "james.okafor", source: "qbank", category: "content", subject: "Explanation missing for Q12 in Cardiology", message: "Question 12 in the Acute Coronary set jumps straight to the answer — there is no explanation text.", context: null, status: "open", reply: null, createdAt: iso(0.4), updatedAt: iso(0.4), resolvedAt: null, userInfo: { displayName: "James Okafor", username: "james.okafor", email: "j.okafor@medschool.edu", role: "student", createdAt: iso(190) } },
  { id: "tk-302", userId: "u-mariam", username: "mariam.ali", source: "library", category: "bug", subject: "Images not loading offline", message: "Downloaded the Cardiology pack for offline reading but the figures never load without a connection.", context: null, status: "open", reply: null, createdAt: iso(1.2), updatedAt: iso(1.2), resolvedAt: null, userInfo: { displayName: "Mariam Ali", username: "mariam.ali", email: "m.ali@medschool.edu", role: "student", createdAt: iso(120) } },
  { id: "tk-303", userId: "u-priya", username: "priya.nair", source: "settings", category: "feature", subject: "Please add Anki export for cloze cards", message: "Cloze export would make my workflow much faster. Love the app otherwise!", context: null, status: "in_progress", reply: "Thanks Priya — this is on the roadmap for the next release.", createdAt: iso(3), updatedAt: iso(2), resolvedAt: null, userInfo: { displayName: "Priya Nair", username: "priya.nair", email: "p.nair@medschool.edu", role: "student", createdAt: iso(30) } },
  { id: "tk-304", userId: "u-daniel", username: "daniel.reyes", source: "qbank", category: "other", subject: "Wrong flag count in session summary", message: "The flagged counter showed 3 but I only flagged 2 questions.", context: null, status: "resolved", reply: "Fixed in v0.3.1 — thanks for the report.", createdAt: iso(8), updatedAt: iso(6), resolvedAt: iso(6), userInfo: { displayName: "Daniel Reyes", username: "daniel.reyes", email: "d.reyes@medschool.edu", role: "student", createdAt: iso(60) } },
];

const auditActions = ["auth.login", "content.publish", "content.draft.save", "user.role.update", "auth.login", "content.approve", "config.update", "content.submit", "auth.login", "ticket.reply", "content.reject", "session.revoke"];
const auditEntries = auditActions.map((action, i) => ({
  id: `audit-${500 - i}`,
  actorId: i % 3 === 0 ? "u-press-sarah" : i % 3 === 1 ? "u-omar" : "u-lina",
  actorUsername: i % 3 === 0 ? "sarah" : i % 3 === 1 ? "omar.haddad" : "lina.farouk",
  actorDisplayName: i % 3 === 0 ? "Sarah Chen" : i % 3 === 1 ? "Omar Haddad" : "Lina Farouk",
  action,
  targetId: action.startsWith("content") ? `co-10${(i % 8) + 1}` : null,
  detail: action === "config.update" ? { section: "themes" } : null,
  createdAt: now - i * 5 * 60 * 60 * 1000,
}));

const analyticsOverview = {
  "24h": { totalEvents: 1902, totalSessions: 96, pageViews: 940, jsErrors: 1, webVitals: 640, apiCalls: 780, routeChanges: 812, events24h: 1902, sessions24h: 96, jsErrors24h: 1 },
  "7d": { totalEvents: 12480, totalSessions: 402, pageViews: 5240, jsErrors: 11, webVitals: 2840, apiCalls: 3210, routeChanges: 4180, events24h: 1902, sessions24h: 96, jsErrors24h: 1 },
  "30d": { totalEvents: 48210, totalSessions: 1284, pageViews: 19870, jsErrors: 42, webVitals: 8321, apiCalls: 12043, routeChanges: 15664, events24h: 1902, sessions24h: 96, jsErrors24h: 1 },
};

function buildOverview(range) {
  const base = analyticsOverview[range] ?? analyticsOverview["30d"];
  return { range, lastEventAt: now - 4 * 60 * 1000, ...base };
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function buildTimeseries(range) {
  const cfg = { "24h": { n: 24, stepMs: HOUR }, "7d": { n: 28, stepMs: 6 * HOUR }, "30d": { n: 30, stepMs: DAY } }[range]
    ?? { n: 30, stepMs: DAY };
  const scale = range === "24h" ? 1 / 16 : range === "7d" ? 1 / 4 : 1;
  return {
    range,
    bucketMs: cfg.stepMs,
    series: Array.from({ length: cfg.n }, (_, i) => ({
      ts: now - (cfg.n - 1 - i) * cfg.stepMs,
      page_view: Math.round((520 + 220 * Math.sin(i / 3.5) + (i % 7 === 5 || i % 7 === 6 ? -180 : 60)) * scale),
      web_vital: Math.round((240 + 90 * Math.sin(i / 4)) * scale),
      js_error: i === cfg.n - 13 ? 2 : 0,
      api_call: Math.round((330 + 140 * Math.sin(i / 3.1)) * scale),
      route_change: Math.round((430 + 170 * Math.sin(i / 3.4)) * scale),
    })),
  };
}

const analyticsWebVitals = {
  range: "30d",
  metrics: [
    { name: "LCP", count: 1902, min: 420, p50: 1420, p75: 2260, p95: 3480, max: 5210 },
    { name: "INP", count: 1874, min: 24, p50: 96, p75: 184, p95: 302, max: 512 },
    { name: "CLS", count: 1902, min: 0, p50: 0.02, p75: 0.05, p95: 0.09, max: 0.21 },
    { name: "FCP", count: 1902, min: 310, p50: 890, p75: 1420, p95: 2180, max: 3400 },
    { name: "TTFB", count: 1902, min: 60, p50: 180, p75: 320, p95: 560, max: 940 },
  ],
};

const analyticsTopPages = {
  range: "30d",
  items: [
    { path: "/qbank", views: 3120, uniqueSessions: 412, lastSeen: now - 9 * 60 * 1000 },
    { path: "/flashcards", views: 2864, uniqueSessions: 388, lastSeen: now - 24 * 60 * 1000 },
    { path: "/library", views: 2410, uniqueSessions: 351, lastSeen: now - 42 * 60 * 1000 },
    { path: "/", views: 2211, uniqueSessions: 465, lastSeen: now - 12 * 60 * 1000 },
    { path: "/osce", views: 1893, uniqueSessions: 240, lastSeen: now - 75 * 60 * 1000 },
    { path: "/videos", views: 1544, uniqueSessions: 214, lastSeen: now - 130 * 60 * 1000 },
    { path: "/settings", views: 986, uniqueSessions: 302, lastSeen: now - 200 * 60 * 1000 },
    { path: "/profile", views: 842, uniqueSessions: 190, lastSeen: now - 260 * 60 * 1000 },
  ],
};

const analyticsErrors = {
  range: "30d",
  items: [
    { message: "TypeError: Failed to fetch (gemini proxy)", count: 14, firstSeen: iso(21), lastSeen: iso(0.1), affectedPaths: 3, affectedSessions: 9 },
    { message: "QuotaExceededError: IndexedDB write", count: 9, firstSeen: iso(26), lastSeen: iso(3), affectedPaths: 2, affectedSessions: 6 },
    { message: "ChunkLoadError: Loading chunk videos-studio", count: 6, firstSeen: iso(18), lastSeen: iso(8), affectedPaths: 1, affectedSessions: 5 },
    { message: "NotAllowedError: Wake Lock request denied", count: 4, firstSeen: iso(12), lastSeen: iso(2), affectedPaths: 1, affectedSessions: 4 },
  ],
};

const analyticsApiPerformance = {
  range: "30d",
  items: [
    { endpoint: "GET /v1/content/manifests", count: 8420, p50: 96, p95: 240, max: 810 },
    { endpoint: "POST /v1/sync/push", count: 4120, p50: 140, p95: 420, max: 1520 },
    { endpoint: "GET /v1/sync/pull", count: 3980, p50: 150, p95: 460, max: 1610 },
    { endpoint: "POST /v1/account/gemini/proxy", count: 2210, p50: 1240, p95: 3200, max: 8900 },
    { endpoint: "POST /v1/auth/refresh", count: 980, p50: 110, p95: 260, max: 700 },
    { endpoint: "GET /v1/health", count: 640, p50: 42, p95: 120, max: 380 },
  ],
};

const analyticsContent = {
  totalPacks: 24, totalUsers: 96, totalAttempts: 8420, totalCorrect: 5810, avgAccuracy: 69.0,
  totalQuestions: 312, flaggedQuestions: 87, firstTryRate: 61.4, avgTimeMs: 74000,
  byEngine: [
    { engine: "quiz", packs: 8, users: 74, attempts: 4120, correct: 2810, accuracy: 68.2 },
    { engine: "flashcard", packs: 9, users: 68, attempts: 2860, correct: 2140, accuracy: 74.8 },
    { engine: "osce", packs: 4, users: 31, attempts: 890, correct: 512, accuracy: 57.5 },
    { engine: "written", packs: 3, users: 22, attempts: 550, correct: 348, accuracy: 63.3 },
  ],
  recencyBuckets: [ { bucket: "24h", packs: 12 }, { bucket: "7d", packs: 19 }, { bucket: "30d", packs: 24 } ],
  userTiers: [ { tier: "power", users: 18 }, { tier: "regular", users: 41 }, { tier: "casual", users: 37 } ],
  accuracyBands: [ { bucket: "0-50%", packs: 3 }, { bucket: "50-70%", packs: 9 }, { bucket: "70-85%", packs: 8 }, { bucket: "85-100%", packs: 4 } ],
  packs: [
    { uid: "quiz-cardiology-acute-coronary", engine: "quiz", users: 42, attempts: 1210, correct: 824, accuracy: 68.1, questions: 6, firstTryRate: 59.2, avgTimeMs: 68000, flagged: 14, lastSolvedAt: now - 2 * 60 * 60 * 1000, topUsers: [ { username: "james.okafor", attempts: 96, correct: 78, accuracy: 81.3 }, { username: "mariam.ali", attempts: 88, correct: 66, accuracy: 75.0 }, { username: "daniel.reyes", attempts: 74, correct: 51, accuracy: 68.9 } ] },
    { uid: "flashcard-medical-board-review-cardiology", engine: "flashcard", users: 38, attempts: 980, correct: 760, accuracy: 77.6, questions: 6, firstTryRate: 66.0, avgTimeMs: 21000, flagged: 6, lastSolvedAt: now - 5 * 60 * 60 * 1000, topUsers: [ { username: "priya.nair", attempts: 120, correct: 104, accuracy: 86.7 }, { username: "mariam.ali", attempts: 102, correct: 81, accuracy: 79.4 } ] },
    { uid: "osce-clinical-skills", engine: "osce", users: 21, attempts: 340, correct: 198, accuracy: 58.2, questions: 6, firstTryRate: 44.1, avgTimeMs: 240000, flagged: 11, lastSolvedAt: now - 1 * day, topUsers: [ { username: "james.okafor", attempts: 40, correct: 29, accuracy: 72.5 } ] },
  ],
  topUsers: [
    { username: "james.okafor", packs: 14, attempts: 640, correct: 486, accuracy: 75.9 },
    { username: "mariam.ali", packs: 12, attempts: 590, correct: 431, accuracy: 73.1 },
    { username: "priya.nair", packs: 9, attempts: 480, correct: 372, accuracy: 77.5 },
    { username: "daniel.reyes", packs: 7, attempts: 350, correct: 224, accuracy: 64.0 },
  ],
};

const cloudflareLimits = {
  status: "healthy", resetAt: now + 12 * 60 * 60 * 1000, timeToResetMs: 12 * 60 * 60 * 1000, connected: true, liveAt: now - 5 * 60 * 1000,
  sources: { workerRequests: "live", d1Writes: "live", d1Reads: "live", d1Storage: "live", r2Storage: "live", r2ClassAOps: "estimated", r2ClassBOps: "estimated", workerCpuTime: "estimated" },
  metrics: {
    workerRequests: { current: 184210, limit: 100000, unit: "requests/day", percentage: 18.4, status: "healthy", period: "daily" },
    d1Writes: { current: 12400, limit: 100000, unit: "rows/day", percentage: 12.4, status: "healthy", period: "daily" },
    d1Reads: { current: 86300, limit: 500000, unit: "rows/day", percentage: 17.3, status: "healthy", period: "daily" },
    d1Storage: { current: 0.21, limit: 5, unit: "GB", percentage: 4.2, status: "healthy", period: "storage" },
    r2Storage: { current: 1.8, limit: 10, unit: "GB", percentage: 18.0, status: "healthy", period: "storage" },
    r2ClassAOps: { current: 820, limit: 1000, unit: "ops/day", percentage: 82.0, status: "warning", period: "daily" },
    r2ClassBOps: { current: 6400, limit: 10000000, unit: "ops/day", percentage: 0.1, status: "healthy", period: "daily" },
    workerCpuTime: { current: 12, limit: 30, unit: "s/req avg", percentage: 40.0, status: "healthy", period: "per_request" },
    workerSubrequests: { current: 50, limit: 50, unit: "per request", percentage: 62.0, status: "healthy", period: "per_request" },
  },
  caps: { analyticsWriteCap: { current: 8210, cap: 20000, percentage: 41.1 }, qstatsWriteCap: { current: 1240, cap: 10000, percentage: 12.4 } },
  executionLatency: { p50: 18, p95: 96, max: 340 },
  d1Tables: [
    { table: "users", rowCount: 128, estimatedBytes: 184320, retention: "permanent" },
    { table: "sessions", rowCount: 342, estimatedBytes: 98304, retention: "permanent" },
    { table: "user_data", rowCount: 1284, estimatedBytes: 47185920, retention: "permanent" },
    { table: "analytics_events", rowCount: 48210, estimatedBytes: 125829120, retention: "90 days" },
    { table: "support_tickets", rowCount: 31, estimatedBytes: 65536, retention: "permanent" },
  ],
  totalD1Rows: 50000, totalD1EstimatedBytes: 173900000,
  safetyThrottles: [
    { name: "analytics ingest", threshold: "20k writes/day", status: "healthy", protectedQuota: "D1 writes" },
    { name: "sync push", threshold: "4s debounce + 20s min interval", status: "healthy", protectedQuota: "D1 reads/writes" },
  ],
};

function json(body, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

// ── Student progress seeding ─────────────────────────────────────────────────
// The press kit looks best when the dashboard/profile show real activity.
// We boot the app once per context (it creates its own IndexedDB schema),
// then write QuestionRecords into the "progress" store; every subsequent
// page hydrates them through the app's own storage layer. Uids/qids are the
// demo instance's real cloud-hosted packs, so dashboard cards resolve titles.

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PROGRESS_RECORDS = (() => {
  const records = [];
  // ECG Question Bank (547 q): answered today — drives streak + daily goal.
  const ecgCorrect = [true, true, false, true, true, true, false, true];
  ecgCorrect.forEach((correct, i) =>
    records.push({
      key: `quiz-internal-medicine-ecg-ecg-question-bank:ecg-question-bank-q${i + 1}`,
      uid: "quiz-internal-medicine-ecg-ecg-question-bank",
      qid: `ecg-question-bank-q${i + 1}`,
      engine: "quiz",
      selected: correct ? 1 : 2,
      correct,
      flagged: i === 2,
      timestamp: now - (3 + i) * HOUR_MS,
      attempts: 1,
      correctCount: correct ? 1 : 0,
    })
  );
  // Ophthalmology demo pack: spread across the last 13 days (fills the chart).
  const ophCorrect = [true, false, true, true, true];
  ophCorrect.forEach((correct, i) =>
    records.push({
      key: `quiz-demo-ophthalmology-quiz:oph${i + 1}`,
      uid: "quiz-demo-ophthalmology-quiz",
      qid: `oph${i + 1}`,
      engine: "quiz",
      selected: correct ? 0 : 2,
      correct,
      flagged: false,
      timestamp: now - (1 + (i % 12)) * DAY_MS - ((i * 41) % 9) * HOUR_MS,
      attempts: 1,
      correctCount: correct ? 1 : 0,
    })
  );
  return records;
})();

// ── Seeded study history ─────────────────────────────────────────────────────

const ECG_UID = "quiz-internal-medicine-ecg-ecg-question-bank";
const REVIEW_SESSION_ID = "sess-press-review";

// Completed ECG session for the results/review deep link + Q-Bank history.
// Answers use the pack's real answer key (q3/q7 intentionally wrong → 6/8).
// Six more sessions across both seeded packs make the history/tracker pages
// look lived-in (>5 sessions also reveals the tracker's "View all" link,
// which is the reliable client-side route into the hydrated history page).
function seedSession(id, { packUid, packTitle, mode, total, correct, flagged, startedHoursAgo, durationMin }) {
  const answers = {}, revealed = {}, flaggedMap = {};
  for (let i = 0; i < total; i++) {
    answers[i] = i % 3;
    revealed[i] = true;
    if (i < flagged) flaggedMap[i] = true;
  }
  return {
    key: `session:${id}`,
    value: {
      id,
      packUid,
      packTitle,
      engine: "quiz",
      mode,
      totalQuestions: total,
      answeredCount: total,
      correctCount: correct,
      incorrectCount: total - correct,
      flaggedCount: flagged,
      startedAt: now - (startedHoursAgo + 1) * HOUR_MS,
      completedAt: now - startedHoursAgo * HOUR_MS,
      answers,
      revealed,
      flagged: flaggedMap,
      current: total - 1,
      examTimeRemaining: 0,
      questionRefs: Array.from({ length: total }, (_, i) => ({
        id: packUid === ECG_UID ? `ecg-question-bank-q${i + 1}` : `oph${i + 1}`,
        sourceUid: packUid,
      })),
      sources: [packUid],
    },
  };
}

const OPHTH_UID = "quiz-demo-ophthalmology-quiz";
const SEED_SESSIONS = [
  seedSession(REVIEW_SESSION_ID, { packUid: ECG_UID, packTitle: "ECG Question Bank", mode: "tutor", total: 8, correct: 6, flagged: 1, startedHoursAgo: 4, durationMin: 12 }),
  seedSession("sess-press-2", { packUid: ECG_UID, packTitle: "ECG Question Bank", mode: "timed", total: 20, correct: 15, flagged: 2, startedHoursAgo: 26, durationMin: 20 }),
  seedSession("sess-press-3", { packUid: ECG_UID, packTitle: "ECG Question Bank", mode: "tutor", total: 10, correct: 9, flagged: 0, startedHoursAgo: 74, durationMin: 9 }),
  seedSession("sess-press-4", { packUid: ECG_UID, packTitle: "ECG Question Bank", mode: "tutor", total: 15, correct: 11, flagged: 1, startedHoursAgo: 8 * 24, durationMin: 14 }),
  seedSession("sess-press-5", { packUid: ECG_UID, packTitle: "ECG Question Bank", mode: "timed", total: 25, correct: 19, flagged: 3, startedHoursAgo: 11 * 24, durationMin: 25 }),
  seedSession("sess-press-6", { packUid: OPHTH_UID, packTitle: "Ophthalmology Quiz", mode: "tutor", total: 5, correct: 4, flagged: 0, startedHoursAgo: 2 * 24, durationMin: 5 }),
  seedSession("sess-press-7", { packUid: OPHTH_UID, packTitle: "Ophthalmology Quiz", mode: "timed", total: 5, correct: 3, flagged: 1, startedHoursAgo: 6 * 24, durationMin: 6 }),
];

async function seedProgress(context) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
    // Wait for the app's own boot to create the osler-db-v1 schema.
    const ready = await page.evaluate(async (timeoutMs) => {
      const t0 = Date.now();
      for (;;) {
        const has = await new Promise((res) => {
          const req = indexedDB.open("osler-db-v1");
          req.onsuccess = () => {
            const has = req.result.objectStoreNames.contains("progress");
            req.result.close();
            res(has);
          };
          req.onerror = () => res(false);
        });
        if (has) return true;
        if (Date.now() - t0 > timeoutMs) return false;
        await new Promise((r) => setTimeout(r, 400));
      }
    }, 30000);
    if (!ready) throw new Error("osler-db-v1 progress store never appeared");
    await page.evaluate(async ({ progress, sessions }) => {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open("osler-db-v1");
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      try {
        await new Promise((res, rej) => {
          const tx = db.transaction(["progress", "sessions"], "readwrite");
          const progressStore = tx.objectStore("progress");
          // The stores hold { key, value } wrappers (see idbPut in storage.ts).
          for (const r of progress) progressStore.put({ key: r.key, value: r });
          const sessionsStore = tx.objectStore("sessions");
          for (const s of sessions) sessionsStore.put(s);
          tx.oncomplete = () => res(null);
          tx.onerror = () => rej(tx.error);
        });
      } finally {
        db.close();
      }
    }, { progress: PROGRESS_RECORDS, sessions: SEED_SESSIONS });
  } finally {
    await page.close().catch(() => {});
  }
}

async function mockWorkerApi(route, demoConfig) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const m = req.method();

  if (p === "/v1/health") return route.fulfill(json({ ok: true, googleEnabled: false }));
  if (p === "/v1/admin/me") return route.fulfill(json(adminIdentity));
  if (p === "/v1/admin/stats") return route.fulfill(json(adminStats));
  if (p === "/v1/admin/pending") return route.fulfill(json({ items: contentObjects.filter((c) => c.status === "pending") }));
  if (p === "/v1/admin/content" && m === "GET") {
    const status = url.searchParams.get("status") || "all";
    const items = status === "all" ? contentObjects : contentObjects.filter((c) => c.status === status);
    return route.fulfill(json({ items, total: items.length, page: 1, limit: 100 }));
  }
  if (p === "/v1/admin/users" && m === "GET") return route.fulfill(json({ users: adminUsers, total: adminUsers.length, page: 1, limit: 50 }));
  if (p === "/v1/admin/tickets" && m === "GET") {
    const status = url.searchParams.get("status") || "all";
    const items = status === "all" ? adminTickets : adminTickets.filter((t) => t.status === status);
    return route.fulfill(json({ items, total: adminTickets.length, openCount: 2, page: 1, limit: 50 }));
  }
  if (p === "/v1/admin/audit" && m === "GET") return route.fulfill(json({ items: auditEntries, total: auditEntries.length, page: 1, limit: 50 }));
  if (p === "/v1/admin/config" && m === "GET") return route.fulfill(json(demoConfig));
  if (p === "/v1/admin/analytics/overview") return route.fulfill(json(buildOverview(url.searchParams.get("range") || "24h")));
  if (p === "/v1/admin/analytics/timeseries") return route.fulfill(json(buildTimeseries(url.searchParams.get("range") || "24h")));
  if (p === "/v1/admin/analytics/web-vitals") return route.fulfill(json(analyticsWebVitals));
  if (p === "/v1/admin/analytics/top-pages") return route.fulfill(json(analyticsTopPages));
  if (p === "/v1/admin/analytics/errors") return route.fulfill(json(analyticsErrors));
  if (p === "/v1/admin/analytics/api-performance") return route.fulfill(json(analyticsApiPerformance));
  if (p === "/v1/admin/analytics/content") return route.fulfill(json(analyticsContent));
  if (p === "/v1/admin/analytics/cloudflare-limits") return route.fulfill(json(cloudflareLimits));
  if (p === "/v1/admin/analytics/question-stats") return route.fulfill(json({ packs: [] }));
  if (p === "/v1/admin/tokens") return route.fulfill(json({ items: [] }));
  if (p === "/v1/account/gemini-key") return route.fulfill(json({ apiKey: null, model: null, maxWait: null, hasKey: false }));
  // Everything else (analytics beacons, mutations, account endpoints): ack.
  return route.fulfill(json({ ok: true }));
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

// `guest: true` captures without a seeded session (login screen).
// `steps` run after load: click (exact text) / clickSel (css) / clickPos
// (viewport fractions) / key / wait. A failed step logs a warning and the
// screenshot still fires, so one brittle interaction never kills a surface.
const ECG_PACK = `/qbank/?uid=${ECG_UID}`;

const STUDENT_SURFACES = [
  { name: "login", path: "/login/", guest: true },
  { name: "dashboard", path: "/" },
  { name: "learn", path: "/learn/" },
  { name: "qbank-hub", path: "/qbank/" },
  { name: "qbank-custom", path: "/qbank/", steps: [{ click: "Custom" }, { wait: 1400 }] },
  { name: "qbank-tracker", path: "/qbank/", steps: [{ click: "Tracker" }, { wait: 1400 }] },
  // History mounts its session list at render time, so a cold load shows the
  // empty state — reach it through the tracker's "View all" client-side link.
  { name: "qbank-history", path: "/qbank/", steps: [{ click: "Tracker" }, { wait: 1400 }, { clickRe: "view all sessions" }, { wait: 1600 }] },
  { name: "qbank-pack", path: ECG_PACK },
  { name: "library-hub", path: "/library/" },
  { name: "library-article", path: `/library/?article=${encodeURIComponent("Cardiology/heart-failure-reduced-ef.md")}` },
  { name: "flashcards-hub", path: "/flashcards/" },
  // The flashcard studio selects decks by click (the uid prop only validates),
  // so deck/study surfaces drive the UI: folder card → deck detail → Study All.
  { name: "flashcard-deck", path: "/flashcards/", steps: [{ click: "Medical Board Review" }, { wait: 1500 }] },
  { name: "flashcard-study", path: "/flashcards/", steps: [{ click: "Medical Board Review" }, { click: "Study All" }, { wait: 1800 }] },
  { name: "flashcard-flipped", path: "/flashcards/", steps: [{ click: "Medical Board Review" }, { click: "Study All" }, { wait: 1800 }, { clickPos: [0.5, 0.42] }, { wait: 1400 }] },
  { name: "osce-hub", path: "/osce/" },
  { name: "osce-station", path: "/osce/?uid=osce-internal-medicine-osce-med-history-med-hist-chest-pain-acs" },
  { name: "osce-session", path: "/osce/?uid=osce-internal-medicine-osce-med-history-med-hist-chest-pain-acs", steps: [{ click: "Enter Consultation Room" }, { wait: 2600 }] },
  { name: "videos-hub", path: "/videos/" },
  { name: "video-player", path: "/videos/?video=ecg-basic-interpretation" },
  { name: "profile", path: "/profile/" },
  { name: "settings", path: "/settings/" },
  { name: "settings-account", path: "/settings/?section=account" },
  { name: "settings-sessions", path: "/settings/?section=sessions" },
  { name: "settings-appearance", path: "/settings/?section=appearance" },
  { name: "settings-ai", path: "/settings/?section=ai" },
  { name: "settings-shortcuts", path: "/settings/?section=shortcuts" },
  { name: "settings-downloads", path: "/settings/?section=downloads" },
  { name: "settings-sync", path: "/settings/?section=sync" },
  { name: "settings-native", path: "/settings/?section=native" },
  { name: "settings-support", path: "/settings/?section=support" },
  { name: "settings-backup", path: "/settings/?section=backup" },
  { name: "settings-about", path: "/settings/?section=about" },
  { name: "settings-danger", path: "/settings/?section=danger" },
  { name: "search-panel", path: "/", steps: [{ key: "Control+k" }, { wait: 1400 }] },
  // Review: tracker → history (client-side, hydrated) → pack sheet → Review.
  // Runs BEFORE the live-session surfaces so no resume dialog blocks the hub.
  { name: "quiz-review", path: "/qbank/", steps: [
    { click: "Tracker" }, { wait: 1400 },
    { clickRe: "view all sessions" }, { wait: 1600 },
    { clickRe: "ecg question bank" }, { wait: 1200 },
    { clickSel: '[title="Review"]' }, { wait: 2800 },
  ] },
  // Quiz/written session surfaces last — starting sessions mutates qbank state.
  { name: "quiz-session", path: ECG_PACK, steps: [{ click: "Start quiz" }, { wait: 1800 }] },
  // Tutor mode requires an explicit submit before the explanation reveals.
  // The submit lives in TWO toolbars (top bar + bottom bar); on phone the
  // top-bar twin is hidden, so target the visible bottom-bar button directly.
  { name: "quiz-answered", path: ECG_PACK, steps: [{ click: "Start quiz" }, { wait: 1800 }, { clickSel: '[data-choice-idx="1"]' }, { wait: 900 }, { clickSel: '[data-walkthrough="qbank-next"]:has-text("Submit Answer")' }, { wait: 1600 }] },
  { name: "written-session", path: "/qbank/?uid=written-internal-medicine-written-cardio-past-years", steps: [{ click: "Start session" }, { click: "Start quiz" }, { wait: 2000 }] },
];

const ADMIN_SURFACES = [
  { name: "admin-dashboard", path: "/admin/dashboard/" },
  { name: "admin-content", path: "/admin/content/" },
  { name: "admin-review", path: "/admin/review/" },
  { name: "admin-tickets", path: "/admin/tickets/" },
  { name: "admin-users", path: "/admin/users/" },
  { name: "admin-analytics", path: "/admin/analytics/" },
  { name: "admin-audit", path: "/admin/audit/" },
  { name: "admin-config", path: "/admin/config/" },
  { name: "admin-settings", path: "/admin/settings/" },
];

const SURFACES = [...STUDENT_SURFACES, ...ADMIN_SURFACES].filter((s) =>
  ONLY.length === 0 || ONLY.some((pat) => pat.endsWith("*") ? s.name.startsWith(pat.slice(0, -1)) : s.name === pat)
);

// ── Interaction steps ────────────────────────────────────────────────────────

async function runSteps(page, surface) {
  for (const step of surface.steps ?? []) {
    const label = step.click ?? step.clickRe ?? step.clickSel ?? step.key ?? (step.clickPos ? `pos ${step.clickPos}` : "wait");
    try {
      if (step.wait) {
        await page.waitForTimeout(step.wait);
      } else if (step.click) {
        await page.getByText(step.click, { exact: true }).first().click({ timeout: 8000 });
      } else if (step.clickRe) {
        await page.getByText(new RegExp(step.clickRe, "i")).first().click({ timeout: 8000 });
      } else if (step.clickSel) {
        await page.locator(step.clickSel).first().click({ timeout: 8000 });
      } else if (step.clickPos) {
        const vp = page.viewportSize();
        await page.mouse.click(Math.round(vp.width * step.clickPos[0]), Math.round(vp.height * step.clickPos[1]));
      } else if (step.key) {
        await page.keyboard.press(step.key);
      }
      if (step.waitAfter ?? (step.click || step.clickSel || step.clickPos || step.key)) {
        await page.waitForTimeout(step.waitAfter ?? 900);
      }
    } catch (err) {
      console.warn(`[step-fail] ${surface.name}: "${label}" — ${err.message.split("\n")[0]}`);
    }
  }
}

// ── Capture ──────────────────────────────────────────────────────────────────

async function settle(page, extraWaitMs = 2000) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(extraWaitMs);
}

async function main() {
  const demoConfig = await fetch(`${BASE}/osler.config.json`).then((r) => r.json());
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  for (const form of FORMS) {
    const cfg = FORMS_CFG[form];
    for (const theme of THEMES) {
      const outDir = path.join(OUT_ROOT, form, theme);
      await mkdir(outDir, { recursive: true });

      // One context per theme: storage seeds shared across surfaces.
      const context = await browser.newContext({
        ...cfg,
        userAgent: form === "phone" ? USER_AGENT_PHONE : undefined,
        locale: "en-US",
        timezoneId: "Etc/UTC",
        colorScheme: theme,
      });
      await context.addInitScript(initScript(theme, { session: true }));
      // Mock only the account/admin/sync surface of the Worker; content
      // endpoints (/v1/content*, /v1/health) pass through to the live demo
      // Worker so hubs and deep links render the instance's real content.
      await context.route("**/v1/**", (route) => {
        const p = new URL(route.request().url()).pathname;
        const mocked = ["/v1/admin/", "/v1/account/", "/v1/auth/", "/v1/analytics", "/v1/sync/", "/v1/tickets"].some((pre) => p.startsWith(pre));
        return mocked ? mockWorkerApi(route, demoConfig) : route.fallback();
      });
      // Turnstile widget: keep the login shot clean without a live challenge.
      await context.route("**/challenges.cloudflare.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "/* press-kit: turnstile disabled */" })
      );
      await seedProgress(context);

      for (const surface of SURFACES) {
        // Login must not have a session, or RouteGuard redirects to the app.
        const page = await context.newPage();
        if (surface.guest) {
          // Re-seed this page without the session keys (init script already ran
          // at context level, so clear them before app scripts execute).
          await page.addInitScript(`(function () {
            try {
              sessionStorage.removeItem(${JSON.stringify(SESSION_KEY)});
              localStorage.removeItem(${JSON.stringify(SESSION_KEY)});
              sessionStorage.removeItem("osler-local-session");
              localStorage.removeItem("osler-local-session");
            } catch {}
          })();`);
        }
        try {
          await page.goto(`${BASE}${surface.path}`, { waitUntil: "load", timeout: 60000 });
          await page.addStyleTag({ content: HIDE_SCROLLBARS }).catch(() => {});
          await settle(page, surface.guest ? 2500 : 2200);
          if (surface.steps) await runSteps(page, surface);
          await page.screenshot({ path: path.join(outDir, `${surface.name}.png`) });
          console.log(`[ok] ${form}/${theme}/${surface.name}.png`);
        } catch (err) {
          console.error(`[FAIL] ${form}/${theme}/${surface.name}: ${err.message.split("\n")[0]}`);
        } finally {
          await page.close().catch(() => {});
        }
      }

      await context.close();
    }
  }

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
