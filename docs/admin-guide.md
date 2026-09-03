# Osler Admin Guide

This guide is the complete operator's manual for the Osler admin panel — the secure, role-gated back office that lets you manage users, content, the editorial review queue, and the audit trail. It covers the authentication flow, every page in the panel, the content lifecycle, common admin workflows, and the troubleshooting steps you'll need when something goes wrong.

The admin panel is reachable at `/admin` on any Osler deployment that has the Cloudflare backend enabled. It is intentionally hidden from the public site: there is no link in the main app's navigation, and `robots` is set to `noindex, nofollow`. You either know the URL, or you don't.

> **Related guides:** [`hosting.md`](./hosting.md) · [`security.md`](./security.md) · [`cloudflare-backend.md`](./cloudflare-backend.md) · [`environment.md`](./environment.md)
>
> **Audience:** Osler instance operators — school administrators, content editors, and anyone with the `admin` or `content_admin` role on a deployed instance.

---

## Table of Contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Roles and capabilities](#2-roles-and-capabilities)
3. [Authentication flow](#3-authentication-flow)
4. [Booting your first admin](#4-booting-your-first-admin)
5. [The admin shell](#5-the-admin-shell)
6. [Dashboard](#6-dashboard)
7. [Users](#7-users)
8. [Content](#8-content)
9. [Review Queue](#9-review-queue)
10. [Audit Log](#10-audit-log)
11. [The content lifecycle](#11-the-content-lifecycle)
12. [Common admin workflows](#12-common-admin-workflows)
13. [Audit log reference](#13-audit-log-reference)
14. [D1 SQL cheatsheet for operators](#14-d1-sql-cheatsheet-for-operators)
15. [Troubleshooting](#15-troubleshooting)
16. [Best practices](#16-best-practices)

---

## 1. Architecture at a glance

The admin panel is a Next.js client-side app under `/admin/*`. It talks exclusively to the Osler Cloudflare Worker backend at `/v1/admin/*`. No admin operation ever touches the user's local IndexedDB; everything is server-side and authoritative.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (you)                                │
│                                                                      │
│   /admin/*  ── AdminShell ──┐                                        │
│                             │                                        │
│   sessionStorage +        │  Bearer <session-token>               │
│   localStorage mirror:    │                                        │
│   { token, exp, ... }     │                                        │
│                             ▼                                        │
└─────────────────────────────┬────────────────────────────────────────┘
                              │  HTTPS + JSON
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Cloudflare Worker backend                           │
│                                                                      │
│   /v1/admin/me             ── identity + capabilities                │
│   /v1/admin/stats          ── dashboard counters                     │
│   /v1/admin/users*         ── user CRUD + sessions                   │
│   /v1/admin/content*       ── content CRUD + workflow                │
│   /v1/admin/content/pending ── review queue                          │
│   /v1/admin/content/:id/diff ── pending-vs-published diff            │
│   /v1/admin/audit          ── audit log paging + filter              │
│                                                                      │
│   Reads / writes:                                                    │
│     • D1 (users, sessions, content_objects, admin_audit)             │
│     • R2 (CONTENT binding — content bodies as JSON)                  │
└─────────────────────────────────────────────────────────────────────┘
```

Three databases back the panel:

| Store | Holds | Lifetime |
| --- | --- | --- |
| D1 — `users` | Account rows: id, username, display_name, email, role, password_hash | Forever (until user deleted) |
| D1 — `sessions` | Session IDs + token hashes; one row per login | 7-day TTL; revoked on logout/password reset/role demotion |
| D1 — `content_objects` | Metadata for every content object: status, title, type, creator, timestamps, r2_key_base | Forever (until content deleted) |
| D1 — `admin_audit` | One row per admin action | 1 year, pruned hourly by cron |
| R2 — `CONTENT` bucket | Raw JSON bodies for drafts, pending submissions, and published copies | Forever (until content deleted) |

### Two front doors

The admin panel has two layers of access control:

1. **Cloudflare Access (Zero Trust)** — sits in front of the *whole* Next.js app (or just `/admin*`, your choice). It authenticates the human via email OTP, Google Workspace, Okta, etc., and injects the `cf-access-authenticated-user-email` header. In production, the `AdminShell` refuses to render if this header is missing.
2. **Osler session** — even after Cloudflare Access lets the user through, they must still sign in with their Osler credentials (username/email + password). The Osler session is a bearer token in `sessionStorage`. Each admin API call sends it as `Authorization: Bearer <token>`. The Worker validates the token *and* checks the user's role on every request, so role changes take effect immediately.

This two-door design means a single compromised factor is never enough. An attacker who phishes your Cloudflare Access identity still needs Osler credentials; an attacker who steals an Osler session token can't reach `/admin` without also passing Cloudflare Access.

### Where state lives

| Concern | Source of truth |
| --- | --- |
| "Am I allowed to see this page?" | Client-side `AdminRouteGuard` reads `identity.user.role`; backend re-checks on every call |
| "Is this content published?" | `content_objects.status = 'published'` in D1 **and** a `published.json` object in R2 at the content's `r2_key_base` |
| "Does this user have an active session?" | `sessions` table in D1, matched by token hash |
| "Who deleted this user?" | `admin_audit` row with `action = 'delete_user'`, `target_id = <user-id>` |

The role in the session JWT is informational only — the backend always re-reads the role from D1. This means a demoted user's next API call fails with 403 even though their token hasn't expired.

---

## 2. Roles and capabilities

Osler has three roles. The role is stored on the `users` table and granted only by an existing admin (or, for the very first admin, by a D1 SQL update — see [§4](#4-booting-your-first-admin)).

| Role | Who has it | What they can do in `/admin` |
| --- | --- | --- |
| `student` (default) | Every newly registered user | No admin access. Sign-in at `/admin` returns "Access Denied". |
| `content_admin` | Trusted editors and contributors | `/admin/content` only: create content, edit their own drafts/pending/rejected, see all published content. Cannot publish directly, cannot review others' work, cannot see users or audit log. |
| `admin` | Operators / school IT | Everything: dashboard, users, content (all of it, including direct publish and unpublish), review queue, audit log. |

### Capability matrix

The backend derives a set of boolean capabilities from the role and returns them in `GET /v1/admin/me`. The admin shell uses these to show/hide buttons; the backend enforces them again on every write.

| Capability | `student` | `content_admin` | `admin` |
| --- | :---: | :---: | :---: |
| `manageContent` | — | ✓ (own content only) | ✓ (all content) |
| `manageUsers` | — | — | ✓ |
| `manageSessions` | — | — | ✓ |
| `approveContent` | — | — | ✓ |
| `publishDirect` | — | — | ✓ |
| `viewStats` | — | — | ✓ |
| `viewAudit` | — | — | ✓ |

### Role badge colours

Throughout the panel, role and status badges use a consistent colour language:

```
admin          primary   (blue)
content_admin  warning   (amber)
student        muted     (grey)

draft          muted     (grey)
pending        warning   (amber)
published      success   (green)
rejected       destructive (red)
```

When in doubt, the colour tells you the severity.

---

## 3. Authentication flow

This is the end-to-end sequence from "I'm an operator" to "I'm looking at the dashboard":

```
┌────────────┐
│  Browser   │
└─────┬──────┘
      │ 1. GET https://app.example.com/admin
      ▼
┌──────────────────────────────────────────────┐
│  Cloudflare Access (Zero Trust)              │
│  • Checks for valid CF Access session        │
│  • If absent: redirect to identity provider  │
│    (email OTP, Google Workspace, Okta, etc.) │
│  • On success: injects header                │
│    cf-access-authenticated-user-email: …     │
└─────┬────────────────────────────────────────┘
      │ 2. Request reaches Next.js with the header
      ▼
┌──────────────────────────────────────────────┐
│  Next.js admin layout (server component)     │
│  • Reads cf-access-authenticated-user-email  │
│  • Passes it to <AdminShell cfEmail=…>       │
└─────┬────────────────────────────────────────┘
      │ 3. AdminShell renders
      ▼
┌──────────────────────────────────────────────┐
│  AdminShell (client component)               │
│  • Reads sessionStorage for Osler session    │
│  • If absent: renders <AdminLoginPrompt>     │
│  • If present: calls GET /v1/admin/me        │
│    - 401/403 → show login prompt             │
│    - 200 but !manageContent → "Access Denied"│
│    - 200 + manageContent → render shell      │
└─────┬────────────────────────────────────────┘
      │ 4. User signs in (if needed) via prompt
      ▼
┌──────────────────────────────────────────────┐
│  Worker /v1/auth/login                        │
│  • Verifies password (PBKDF2 310k iters)     │
│  • Creates session row in D1                 │
│  • Returns HMAC-signed token                 │
└─────┬────────────────────────────────────────┘
      │ 5. Token saved to sessionStorage
      ▼
┌──────────────────────────────────────────────┐
│  Worker /v1/admin/me                          │
│  • Validates token (HMAC + D1 lookup)        │
│  • Reads role from users table               │
│  • Returns identity + capabilities           │
└──────────────────────────────────────────────┘
```

### Token storage

The Osler session token lives in `sessionStorage` (key `osler-cloud-session`) mirrored to `localStorage`, **not** a cookie. This is deliberate:

- It's not sent automatically with every request, so cross-site requests can't ride along on it (CSRF resistance without SameSite gymnastics).
- The admin API client (`adminApi`) explicitly attaches `Authorization: Bearer <token>` to every call.
- The localStorage mirror means opening the admin in a new tab or restarting the browser keeps the admin session instead of forcing a fresh sign-in; cross-tab logouts sync via `BroadcastChannel`.

The trade-off: a session persists locally after the browser closes, so sign out on shared machines.

### Session lifecycle

| Event | Effect on sessions |
| --- | --- |
| User signs in | A new session row is inserted with a 7-day `expires_at` |
| User signs out (Sign out button) | Frontend deletes `sessionStorage` + the localStorage mirror; the session row is marked revoked |
| Token near expiry | The client rotates it pre-emptively via `POST /v1/auth/refresh` (sliding expiry) — no re-login needed |
| Token expired but within 30-day grace | `POST /v1/auth/refresh` still accepts it (revoked + reissued) as long as the D1 row is unrevoked |
| Admin resets the user's password | **All** of the user's sessions are revoked |
| Admin changes the user's role | Sessions are *not* automatically revoked; the next API call re-reads role from D1, so elevated/demoted users keep working with their new permissions |
| Admin revokes sessions | All of the user's sessions are revoked |
| Token `exp` passes (7 days) and refresh fails | Token rejected; user must sign in again |
| Hourly cron | Prunes expired/revoked session rows from D1 |

### `cf-access-authenticated-user-email` is informational

The header is used by `AdminShell` only to display the Cloudflare identity in the top bar. It is **not** trusted for authorization — the Worker ignores it. If you deployed without Cloudflare Access and then later enabled it, nothing changes about how Osler sessions work; you just gain the outer door.

In local development (`NODE_ENV !== 'production'`), the header check is skipped so you can run `/admin` without Cloudflare Access in front.

---

## 4. Booting your first admin

A freshly deployed Osler instance has zero admins. The very first one must be promoted directly in D1, because there's no UI path to grant the `admin` role without an existing admin to grant it.

### Step 1: Register a normal account

Sign up at the main app (e.g. `https://app.example.com/`) with the username, email, and password you want to use as the admin. Use a strong password — this account will be a privileged target.

### Step 2: Promote via wrangler

```bash
cd cloudflare/worker

# Find the user to confirm their id and current role
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT id, username, role FROM users WHERE username = '<your-username>';"

# Promote
npx wrangler d1 execute osler-cloud --remote --command \
  "UPDATE users SET role = 'admin' WHERE username = '<your-username>';"

# Verify
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT id, username, role FROM users WHERE username = '<your-username>';"
```

### Step 3: Sign in at `/admin`

Visit `https://app.example.com/admin`. If Cloudflare Access is configured, you'll be asked to authenticate there first. Then sign in with your Osler credentials. You should land on the dashboard.

> **Tip:** Promote at least **two** admins on day one. If you ever lose access to your single admin account (forgotten password, lost 2FA, left the company), recovery requires direct D1 surgery. Two admins means one can recover the other.

### Promoting additional admins later

Once you have a working admin, do all subsequent role changes through the UI ([§7, "Change role"](#change-role)). The D1 path is only for bootstrap and recovery.

---

## 5. The admin shell

Every page under `/admin/*` is wrapped by `AdminShell`. It provides the persistent top bar, the sidebar (on desktop), the theme toggle, and the sign-out button. It also gates the entire experience on authentication.

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Osler Admin   Admin Panel             cf-email@example.com  You  ☀ ⏏ │  ← top bar (h-12)
├────────────────┬─────────────────────────────────────────────────────┤
│ ◧ Dashboard    │                                                     │
│ ○ Users        │                                                     │
│ ○ Content      │            Main content area                        │
│ ○ Review Queue │            (the page you navigated to)              │
│ ○ Audit Log    │                                                     │
│                │                                                     │
│                │                                                     │
│                │                                                     │
│ ─────────────  │                                                     │
│ ⏏ Sign out     │                                                     │
└────────────────┴─────────────────────────────────────────────────────┘
   sidebar (w-52)         main (flex-1, scrollable)
```

The sidebar is hidden on viewports narrower than `md` (768px). On mobile, navigation collapses to the top bar; you can still reach every page by typing its URL or by using the admin home redirect (see below).

### `/admin` redirects intelligently

Visiting the bare `/admin` URL triggers `AdminHomeRedirect`, which sends you to the right landing page based on your role:

| Role | Redirect target |
| --- | --- |
| `admin` | `/admin/dashboard` |
| `content_admin` | `/admin/content` |

This avoids content admins seeing an "Access Denied" page on the dashboard — they go straight to the one page they can use.

### Sidebar badges

If you're an admin, the "Review Queue" nav item shows a red badge with the current pending count. The shell polls `GET /v1/admin/content/pending` once on mount and shows the count; counts over 99 render as `99+`. This is a passive reminder that submissions are waiting — there is no notification sound or toast.

### Theme toggle

The theme toggle (sun/moon icon) switches between dark and light. Your preference is saved to `localStorage["osler-admin-theme"]` and persists across sessions on the same browser. It is independent of the main app's theme.

### Sign out

The Sign out button clears `sessionStorage` **and** the localStorage mirror (`clearCloudSession()`), dropping the Osler session token. The Worker still has the session row in D1, but it will be pruned by cron. To immediately invalidate the session server-side (e.g. if you suspect the token was observed), use a different device, sign in again, and revoke your other sessions from the Users page — though admins typically can't revoke their *own* sessions from the UI (you'd need to reset your own password, which does revoke all sessions).

### Loading and error states

The shell shows a centered spinner for the first ~200ms while it restores the session. If `cfEmail` is null in production, it shows a "Protected by Cloudflare Access" warning instead of the login prompt. If you sign in but your role doesn't include `manageContent`, you see an "Access Denied" screen with a Sign out button — this is the expected behaviour for `student` accounts that wander to `/admin`.

---

## 6. Dashboard

**Route:** `/admin/dashboard`
**Access:** `admin` only (`AdminRouteGuard requireSuperAdmin`)
**API:** `GET /v1/admin/stats`

The dashboard is a single screen of stat tiles. It exists to give you a quick "is anything on fire?" view before you dive into a specific page.

```
┌─────────────────────┬─────────────────────┐
│  Total Users        │  Active Sessions    │
│       1,247         │        83           │
│  (primary / blue)   │  (info / blue)      │
├─────────────────────┼─────────────────────┤
│  Published Content  │  Pending Review     │
│        312          │         5           │
│  (success / green)  │  (warning / amber)  │
└─────────────────────┴─────────────────────┘
```

### What each tile means

| Tile | D1 source | Notes |
| --- | --- | --- |
| Total Users | `SELECT COUNT(*) FROM users` | Includes deleted? No — deletion removes the row. |
| Active Sessions | `SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > now` | A signed-in user with multiple devices counts once per session. |
| Published Content | `SELECT COUNT(*) FROM content_objects WHERE status = 'published'` | Matches the count in the Content → Published tab. |
| Pending Review | `SELECT COUNT(*) FROM content_objects WHERE status = 'pending'` | Drives the sidebar badge. Turns amber (warning colour) when > 0. |

The tile colours aren't decorative: amber on Pending Review is your visual cue to go to the Review Queue.

### What the dashboard does *not* show

- Per-user activity (use the Users page + Audit Log instead)
- Real-user performance & error rates (use the **Analytics** page at `/admin/analytics` — Core Web Vitals, top pages, JS errors, API latency)
- Storage usage (check R2 in the Cloudflare dashboard)
- Worker-level error rates (check the Worker logs — see [`hosting.md` §11](./hosting.md#11-operating--monitoring))

### Refreshing

There is no manual refresh button and no auto-refresh. To refresh, navigate away and back, or press Ctrl/Cmd+R. Stats are fetched once on mount.

---

## 7. Users

**Route:** `/admin/users`
**Access:** `admin` only
**API:** `GET /v1/admin/users`, `GET /v1/admin/users/:id`, `PATCH /v1/admin/users/:id`, `POST /v1/admin/users/:id/reset-password`, `PATCH /v1/admin/users/:id/email-verification`, `DELETE /v1/admin/users/:id`, `GET /v1/admin/users/:id/sessions`, `DELETE /v1/admin/users/:id/sessions`

The Users page is your directory and control panel for every registered account. It's the most powerful page in the panel — every action here is audit-logged, and most are irreversible.

### Page layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Users                                                                │
│  Manage all registered accounts.                                      │
├──────────────────────────────────────────────────────────────────────┤
│  [🔍 Search users…]              1,247 users                          │
├──────────────┬────────┬──────────────────┬──────────┬────────────────┤
│ User         │ Role   │ Email            │ Joined   │ Actions        │
├──────────────┼────────┼──────────────────┼──────────┼────────────────┤
│ Jane Doe     │ Admin  │ jane@example.com │ 03/04/24 │ ChangeRole ▾   │
│ @jane                                          Reset password        │
│                                                 Delete user          │
├──────────────┼────────┼──────────────────┼──────────┼────────────────┤
│ ...                                                                   │
├──────────────────────────────────────────────────────────────────────┤
│                       ◀  1 / 50  ▶                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### Search

The search box accepts free text and matches against three columns with `LIKE` wildcards:

- `username`
- `display_name`
- `email`

The `LIKE` wildcards in your query (`%`, `_`) are escaped before being passed to SQL — you can search for the literal string `100%` without surprising results.

Search is debounced at 350ms. Typing pauses longer than that trigger a fresh query and reset pagination to page 1. There is no exact-match mode; partial matches always come back.

### Pagination

Pages are 25 users each. The pagination control is hidden unless there's more than one page. The total user count is shown next to the search box.

The `total` value comes from a `COUNT(*)` query on the server, so it reflects the full user base, not just the current search result.

### Change role

<a id="change-role"></a>

Clicking "Change role" opens a dropdown with three options: Student, Content Admin, Admin. The user's current role is greyed out.

When you pick a new role:

1. `PATCH /v1/admin/users/:id { role }` is called.
2. The server validates:
   - You can't demote yourself (prevents self-lockout).
   - The target user must exist.
   - The new role must be one of the three allowed values.
3. The user row is updated in D1.
4. An `admin_audit` row is written with `action = 'change_role'` and `detail = { from, to }`.
5. The user's existing sessions remain valid — but their *next* API call reads the new role from D1, so their capabilities update immediately.

> **Note:** Changing someone from `admin` to `student` while they're sitting on the dashboard doesn't kick them out — the page they're already viewing is rendered. Their *next* navigation or API call will fail with 403 and the shell will redirect them.

### Reset password

The Reset password button opens a dialog asking for a new password (visible, not masked — the assumption is you'll read it to the user or paste it into a secure channel). The Submit button is disabled until the password is at least 10 characters long; the backend additionally requires **≥2 character classes** (lowercase, uppercase, digit, symbol) and rejects anything weaker.

On submit:

1. `POST /v1/admin/users/:id/reset-password { password }` is called.
2. The server hashes the password with PBKDF2 (310k iterations) and updates `users.password_hash`.
3. **All** of the user's sessions are revoked. Their existing tabs stop working immediately.
4. An `admin_audit` row is written with `action = 'reset_password'`.
5. The user must sign in again with the new password.

The user is not notified by email - that's a deliberate choice (we don't want to leak the fact that an admin reset their password to anyone who can read their inbox). Communicate the new password to them out-of-band.

### Email verification (manual flip)

The user's detail view shows an **Email verified** badge next to the profile fields, with a *Mark verified / Mark unverified* button. This exists for instances **without** a transactional email provider: an unverified email blocks Google sign-in from linking onto the password account ("This email is already linked to a password account that has not been verified"), and without email delivery there is no self-serve verification path.

When you mark an address verified:

1. `PATCH /v1/admin/users/:id/email-verification { verified: true }` is called.
2. `users.email_verified_at` is set (or cleared when un-verifying).
3. An `admin_audit` row is written with action `verify_email` or `unverify_email`.
4. The user can immediately sign in with Google on that address; existing sessions are unaffected.

Only vouch for addresses you control or can confirm - marking an address verified asserts its ownership. If you later add Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`), prefer the normal emailed verification flow and use this button only as a fallback.

### Delete user

The Delete user button opens a confirmation dialog: "Delete {name}? This will permanently remove their account and all data."

On confirm:

1. `DELETE /v1/admin/users/:id` is called.
2. The server validates that you're not deleting yourself (prevents self-deletion).
3. The user row is deleted from D1.
4. All of the user's sessions are deleted.
5. Any `content_objects` they created are **reassigned to the acting admin** (`created_by` is updated to your user ID). The content itself is preserved.
6. An `admin_audit` row is written with `action = 'delete_user'`, `detail = { username, displayName, contentReassignedTo }`.

Deletion is irreversible. The user's local IndexedDB data on their devices is not wiped (we have no way to reach it), but their cloud-synced progress documents are deleted with the account.

> **Content reassignment matters:** if the deleted user had authored published content, that content stays published and the audit log will now show *you* as the owner. This is intentional — students reading the content shouldn't see it disappear because the author left the school.

### View active sessions & revoke

The Users table doesn't show sessions inline — sessions are a per-user detail. To view or revoke a user's sessions, you'd typically open the user's detail view via `GET /v1/admin/users/:id`, which returns `activeSessionCount` and the user's content. The session list itself comes from `GET /v1/admin/users/:id/sessions` and shows `created_at`, `expires_at`, and `revoked_at` for each session row.

Revoking sessions calls `DELETE /v1/admin/users/:id/sessions`, which marks all of the user's non-revoked sessions as revoked. The user's existing tabs stop working on their next API call. An `admin_audit` row with `action = 'revoke_sessions'` is written.

Use this when:

- A user reports a lost device
- You suspect a session token was leaked (e.g. shared screen recording)
- You're about to delete the user and want to be sure they can't sign in mid-deletion

### Self-protection rules

The UI prevents several self-inflicted wounds:

| Action | Allowed on self? | Why |
| --- | --- | --- |
| Change role (demote) | No | You'd lock yourself out |
| Change role (no-op to current) | UI disables | Nothing to do |
| Delete user | No | You'd delete your own access |
| Reset own password | Yes (but rare) | Not self-locked; revokes all your sessions |

The backend re-validates each of these — even if you craft a custom HTTP request, the Worker rejects self-demotion and self-deletion.

---

## 8. Content

**Route:** `/admin/content` (browser) and `/admin/content/:id` (editor)
**Access:** `admin` + `content_admin`
**API:** `GET /v1/admin/content?status=…`, `POST /v1/admin/content`, `GET /v1/admin/content/:id`, `PUT /v1/admin/content/:id/draft`, `POST /v1/admin/content/:id/submit`, `POST /v1/admin/content/:id/publish`, `POST /v1/admin/content/:id/unpublish`, `DELETE /v1/admin/content/:id`

The Content page is where R2-backed content objects are created and edited. This is the *only* page a `content_admin` can see, and it's where most of the day-to-day editorial work happens.

> **Static content vs. admin content:** Osler ships with a static content folder bundled into the app (quizzes, flashcards, etc.). The admin Content panel manages *additional* R2-backed content. If R2 is not bound to the Worker (no `CONTENT` binding), the page shows a "Content storage is not configured" warning instead of the browser. See [`cloudflare-backend.md`](./cloudflare-backend.md) for binding instructions.

### Browser layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Content                                                              │
│  Create and manage R2-backed content objects.                         │
├──────────────────────────────────────────────────────────────────────┤
│  Published │ Drafts │ Pending │ Rejected              [+ New content]│
├──────────────┬────────┬───────────┬────────┬──────────┬──────────────┤
│ Title        │ Type   │ Status    │ Author │ Updated  │              │
├──────────────┼────────┼───────────┼────────┼──────────┼──────────────┤
│ Cardiology   │ library│ Published │ @jane  │ 04/12/24 │ [Edit]       │
│ 101          │        │           │        │          │              │
├──────────────┼────────┼───────────┼────────┼──────────┼──────────────┤
│ ...                                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Tabs

Four tabs partition the browser by status:

| Tab | Status filter | Who sees what |
| --- | --- | --- |
| **Published** | `status = 'published'` | `admin`: all. `content_admin`: all published (read-only for content they didn't author). |
| **Drafts** | `status = 'draft'` | `admin`: all drafts. `content_admin`: only their own drafts. |
| **Pending** | `status = 'pending'` | `admin`: all pending. `content_admin`: only their own pending submissions. |
| **Rejected** | `status = 'rejected'` | `admin`: all rejected. `content_admin`: only their own rejected work, with the rejection reason visible. |

The count per tab is implicit — there are no count badges on the tabs themselves. If a tab is empty, you see an "No content yet." empty state.

Clicking any row navigates to that content's editor page at `/admin/content/:id`.

### Create new content

The "+ New content" button opens a dialog asking for three fields:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| Title | Free text | (empty) | Required. Will appear in the browser and as the editor's header. |
| Content type | Select | `library` | One of: `quiz`, `bank`, `flashcard`, `written`, `mixed`, `osce`, `library`, `video`. |
| Language | Select | `en` | One of: `en` (English), `ar` (العربية). |

On Create:

1. `POST /v1/admin/content { contentType, title, language }` is called.
2. The server inserts a row into `content_objects` with `status = 'draft'`, `created_by = <your user id>`, and a fresh `r2_key_base` (UUID-like).
3. An empty draft JSON body (`{}`) is written to R2 at `<r2_key_base>/draft.json`.
4. An `admin_audit` row with `action = 'create_content'` is written.
5. You're redirected to `/admin/content/:id` (the editor).

### The editor

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◀  Cardiology 101  published                [Save] [Submit] [Publish]│
│                                                  [🗑]                 │
├──────────────┬───────────────────────────────────────────────────────┤
│ Type         │  {                                                    │
│  library     │    "title": "Cardiology 101",                         │
│              │    "items": [                                         │
│ Language     │      { "q": "What is…", "a": "…" },                   │
│  en          │      …                                                │
│              │    ]                                                  │
│ Created by   │  }                                                    │
│  @jane       │                                                       │
│              │                                                       │
│ Updated      │                                                       │
│  04/12/24    │                                                       │
│  10:42       │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```

The editor is a JSON textarea with a metadata sidebar. The content body must be valid JSON — there is no rich-text editor and no Markdown renderer on the admin side. The frontend app interprets the JSON according to the content type when serving it to students.

#### Auto-save

As you type, the editor debounces a save call every 2 seconds. If the autosave fails (network drop, expired session), nothing is shown — it's silent. The explicit "Save draft" button is your reliable save; the autosave is a convenience. The "●" indicator next to the status appears when there are unsaved changes.

#### Save draft

`PUT /v1/admin/content/:id/draft` writes the current body to R2 at `<r2_key_base>/draft.json` and updates `content_objects.updated_at`. The status doesn't change. This action is *not* audit-logged (it would flood the log).

#### Submit for review

`POST /v1/admin/content/:id/submit` does:

1. Saves the current draft (so what you submitted is what's stored).
2. Copies the draft body to `<r2_key_base>/pending.json` in R2.
3. Sets `content_objects.status = 'pending'`, `submitted_at = now`, `reviewed_by = null`, `reviewed_at = null`, `rejection_reason = null`.
4. Writes `admin_audit` with `action = 'submit_content'`.
5. The editor textarea becomes read-only (you can't edit while pending review).

Once submitted, the content shows up in admins' Review Queue. To make further changes after submission, an admin must first approve or reject it.

#### Publish directly (admin only)

`POST /v1/admin/content/:id/publish` is the admin shortcut. It does:

1. Saves the current draft.
2. Copies the draft body to both `<r2_key_base>/pending.json` (for the audit trail) and `<r2_key_base>/published.json`.
3. Sets `status = 'published'`, `submitted_at = now`, `reviewed_by = <you>`, `reviewed_at = now`.
4. Writes `admin_audit` with `action = 'publish_direct'`.

This bypasses the review queue entirely. Use it for trusted admin-authored content where editorial review would be theatre.

#### Unpublish (admin only)

`POST /v1/admin/content/:id/unpublish` reverts published content back to draft. It does:

1. Deletes the student-facing hybrid copy from `content-files/` (if the object was hybrid-published).
2. Sets `status = 'draft'` and clears `published_r2_key`.
3. Regenerates the category manifest so students stop being served the file.
4. Writes `admin_audit` with `action = 'unpublish'`.

The managed `published.json` under `<r2_key_base>/` is retained so re-publishing doesn't require re-uploading. Students stop seeing the content immediately — both because the app reads `status` from D1 and because the student-facing R2 copy is gone.

#### Delete

`DELETE /v1/admin/content/:id` removes:

- The `content_objects` row from D1.
- All R2 objects at `<r2_key_base>/` (draft, pending, published).
- The student-facing hybrid copy at `published_r2_key` (if any).
- Regenerates the category manifest so the pack disappears from students immediately.

Deletion is irreversible. An `admin_audit` row with `action = 'delete_content'` is written. Admins can delete any content; `content_admin`s can only delete their own.

#### Rejection banner

If the content's status is `rejected`, a red banner appears under the top bar showing the rejection reason (`rejection_reason` from D1). Read it, fix the issue, and resubmit.

#### Read-only mode while pending

When `status = 'pending'`, the textarea becomes `readOnly` and slightly greyed out. The Submit button is hidden; only Save (no-op effectively), Publish (admin only), and Delete are available. This prevents an editor from changing content out from under a reviewer.

---

## 9. Review Queue

**Route:** `/admin/review` (queue) and `/admin/review/:id` (diff view)
**Access:** `admin` only
**API:** `GET /v1/admin/content/pending`, `GET /v1/admin/content/:id/diff`, `POST /v1/admin/content/:id/approve`, `POST /v1/admin/content/:id/reject`

The Review Queue is the editorial inbox. Every submission that's waiting for a decision lands here, in reverse-chronological order.

### Queue layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Review Queue                                                         │
│  Approve or reject content submissions from contributors.             │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Cardiology 101                                                   │ │
│ │ library  •  Submitted by @jane  •  Submitted 04/12/24            │ │
│ │                              [Diff] [Approve] [Reject]           │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Pulmonary Quiz v2                                                │ │
│ │ quiz     •  Submitted by @sam   •  Submitted 04/13/24            │ │
│ │                              [Diff] [Approve] [Reject]           │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

If the queue is empty, you see an "All clear — nothing to review." empty state with a clipboard icon. The sidebar badge also disappears when the count hits zero.

### One-click approve

The green Approve button on each row does the most common action in one click:

1. `POST /v1/admin/content/:id/approve` is called.
2. The server copies `<r2_key_base>/pending.json` to `<r2_key_base>/published.json`.
3. `status = 'published'`, `reviewed_by = <you>`, `reviewed_at = now`, `rejection_reason = null`.
4. `admin_audit` row with `action = 'approve'`.
5. The row is removed from the queue view.

No confirmation dialog — approving is intentional and immediate. If you misclick, use the Content page to unpublish.

### Reject

The Reject button (red outline) navigates to the diff page (`/admin/review/:id`), where the full rejection flow lives. Rejecting requires a reason; you can't just say "no".

### Diff view

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◀  Cardiology 101  Submitted by @jane      [Approve] [Reject]        │
├───────────────────────────────────┬──────────────────────────────────┤
│ CURRENTLY PUBLISHED               │ SUBMITTED VERSION                │
├───────────────────────────────────┼──────────────────────────────────┤
│ {                                 │ {                                │
│   "title": "Cardiology 101",      │   "title": "Cardiology 101",     │
│   "items": [                      │   "items": [                     │
│   "items": [                      │     { "q": "What is…", "a": "…" },│
│     { "q": "What is…", "a": "…" } │     { "q": "New Q", "a": "…" }   │ ← added (green)
│   ]                               │   ]                              │
│ }                                 │ }                                │
└───────────────────────────────────┴──────────────────────────────────┘
```

The diff is a simple line-by-line comparison. Changed lines are highlighted:

- **Left column (currently published):** removed lines are highlighted red.
- **Right column (submitted version):** added lines are highlighted green.

If the content has no published version yet (first submission), the left column header reads "No published version yet." and shows an empty pane.

Both sides are pretty-printed JSON — if parsing fails (invalid JSON), the raw text is shown instead. This is helpful when reviewing a submission that breaks the schema.

### Reject flow

Clicking Reject in the diff view opens a dialog with a textarea for the rejection reason. The reason is required and free-text; "Explain what needs to be changed…" is the placeholder.

On confirm:

1. `POST /v1/admin/content/:id/reject { reason }` is called.
2. `status = 'rejected'`, `reviewed_by = <you>`, `reviewed_at = now`, `rejection_reason = <your reason>`.
3. The pending copy is **not** deleted from R2 — it stays at `<r2_key_base>/pending.json` so the author can see exactly what was reviewed.
4. `admin_audit` row with `action = 'reject'`, `detail = { reason }`.
5. You're redirected back to the queue.

The author will see the rejection reason in their Content → Rejected tab and in the editor's red banner.

### What approve/reject do *not* do

- They don't notify the author by email. The author has to come back and check.
- They don't delete the draft. The author can edit the draft and resubmit (which creates a new pending copy, overwriting the previous one).
- They don't touch the published copy on reject (nothing changes for students).
- They don't allow re-review of an already-approved submission. Once approved, the content is published; further changes require a new submission.

---

## 10. Audit Log

**Route:** `/admin/audit`
**Access:** `admin` only
**API:** `GET /v1/admin/audit?page=…&action=…`

The Audit Log is the immutable trail of every administrative action. It's there for accountability, post-incident investigation, and compliance. Treat it as a write-only log from the panel's perspective — entries can only be added (by performing actions) or pruned (by the hourly cron, after 1 year).

### Page layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Audit Log                                                            │
│  Immutable trail of every administrative action.                      │
├──────────────────────────────────────────────────────────────────────┤
│  Filter by action  [All actions ▾]                  1,438 entries     │
├──────────────────┬─────────────┬──────────────┬────────┬─────────────┤
│ When             │ Actor       │ Action       │ Target │ Detail      │
├──────────────────┼─────────────┼──────────────┼────────┼─────────────┤
│ 04/13/24 14:02   │ Jane Doe    │ change_role  │ abc123 │ {"from":    │
│                  │ @jane       │              │        │  "student", │
│                  │             │              │        │  "to":      │
│                  │             │              │        │  "content_…│
├──────────────────┼─────────────┼──────────────┼────────┼─────────────┤
│ ...                                                                   │
├──────────────────────────────────────────────────────────────────────┤
│            ◀  3 / 29  (1,438 entries)  ▶                              │
└──────────────────────────────────────────────────────────────────────┘
```

### Columns

| Column | Source | Notes |
| --- | --- | --- |
| When | `created_at` | Formatted with `toLocaleString()` in the viewer's locale. |
| Actor | `actor_display_name` + `actor_username` | "Unknown actor" if the actor's account was deleted. |
| Action | `action` | Rendered as a coloured, monospace badge. |
| Target | `target_id` | The user ID or content ID the action was performed on. `—` if not applicable. |
| Detail | `detail` (JSON) | Free-form per-action payload; see [§13](#13-audit-log-reference). |

### Filter

The action filter is a dropdown with 12 options:

- All actions (default)
- Role changes (`change_role`)
- User deletions (`delete_user`)
- Password resets (`reset_password`)
- Session revocations (`revoke_sessions`)
- Content created (`create_content`)
- Content submitted (`submit_content`)
- Content approved (`approve`)
- Content rejected (`reject`)
- Content published directly (`publish_direct`)
- Content unpublished (`unpublish`)
- Content deleted (`delete_content`)

Selecting a filter resets to page 1. The total count updates to reflect the filtered set.

### Pagination

Pages are 50 entries each. The footer shows current page / total pages and the total entry count. Use the chevron buttons to navigate; there's no jump-to-page control.

### Detail payloads

Each entry's `detail` is a JSON object whose shape depends on the action. The full reference is in [§13](#13-audit-log-reference). The Detail column pretty-prints the JSON inline in a scrollable monospace block.

### Retention

Audit entries are retained for 1 year. The Worker's hourly cron (`crons = ["0 * * * *"]` in `wrangler.toml`) runs a `DELETE FROM admin_audit WHERE created_at < ?` sweep on each tick. The pruning is opportunistic — entries slightly older than 1 year may persist until the next cron run, but never longer than ~1 hour past their first birthday.

If you need longer retention for compliance, take periodic D1 exports (see [`hosting.md` §11, Backups](./hosting.md#11-operating--monitoring)).

---

## 11. The content lifecycle

The content workflow is a state machine with five states and six transitions. Admins have access to all transitions; `content_admin`s have access to a subset.

```
                       ┌─────────────────────────────┐
                       │                              │
                       ▼                              │
   ┌────────┐  submit   ┌─────────┐  approve   ┌───────────┐
   │ draft  │ ────────▶ │ pending │ ─────────▶ │ published │
   └────────┘           └─────────┘            └───────────┘
        ▲                   │                       │
        │                   │ reject                │ unpublish (admin)
        │                   ▼                       │
        │              ┌──────────┐                 │
        │              │ rejected │                 │
        │              └──────────┘                 │
        │                   │                       │
        │   (edit + resubmit, overwrites pending)   │
        └───────────────────┘                       │
        │                                           │
        └───────────────────────────────────────────┘
                  (status reverts to draft)
```

### Transition matrix

| From | To | Trigger | Who | R2 effect |
| --- | --- | --- | --- | --- |
| (new) | `draft` | Create content | admin, content_admin | Write `<base>/draft.json` |
| `draft` | `pending` | Submit for review | admin, content_admin | Copy draft → `<base>/pending.json` |
| `pending` | `published` | Approve (review queue) | admin | Copy pending → `<base>/published.json` |
| `pending` | `rejected` | Reject (with reason) | admin | No R2 change |
| `draft` | `published` | Publish directly (admin shortcut) | admin | Copy draft → pending + published |
| `published` | `draft` | Unpublish (admin) | admin | No R2 change (published copy retained) |
| `rejected` | `pending` | Edit + resubmit | admin, content_admin | Overwrite `<base>/pending.json` |
| any | (deleted) | Delete content | admin (any), content_admin (own) | Remove all R2 objects under `<base>/` |

### R2 key layout

Each content object has a unique `r2_key_base` (a UUID-like string assigned at creation). R2 stores up to three JSON objects per content:

```
<base>/draft.json       ← always present, what the editor shows
<base>/pending.json     ← present after first submit; overwritten on resubmit
<base>/published.json   ← present once published; retained after unpublish
```

The published copy is **never** overwritten by a draft save — only by an explicit publish action (direct or via approval). This means students always see a consistent version even while an author is mid-edit.

### What students see

Students see only `status = 'published'` content. The app fetches the published JSON from R2 via a public read endpoint (cached on the edge). Changes to draft or pending states are invisible to students.

When you unpublish, students stop seeing the content within the cache TTL (usually minutes). When you delete, the R2 objects go away too — any cached copies in service workers will be replaced on next fetch.

### Author visibility

| Status | content_admin sees |
| --- | --- |
| `draft` | Only their own drafts |
| `pending` | Only their own pending submissions |
| `published` | All published content (read-only for others' work) |
| `rejected` | Only their own rejected content (with rejection reason) |

`admin` sees everything regardless of authorship. There is no "private" content — once published, every admin and content_admin can read the body.

---

## 12. Common admin workflows

Step-by-step recipes for the tasks you'll actually do.

### Workflow: Promote a user to `content_admin`

A new contributor has joined the editorial team.

1. Visit `/admin/users`.
2. Search for the user by username, display name, or email.
3. Click "Change role" on their row.
4. Select "Content Admin" from the dropdown.
5. Confirm the toast appears ("Role changed: <name> → Content Admin").
6. Tell the user to visit `/admin` and sign in. They'll land on `/admin/content`.
7. (Optional) Check the Audit Log → filter by "Role changes" to confirm the entry was written.

> **What changes for the user:** They can now create and edit content, submit it for review, and see published content. They can't publish directly, can't see other users, can't review others' submissions, and can't see the audit log.

### Workflow: Approve a pending article

A contributor submitted a new quiz.

1. Visit `/admin/review` (or look at the sidebar badge count).
2. Click "Diff" on the submission row to open the diff view.
3. Review the submitted version (right pane) against the currently published version (left pane, may be empty).
4. If acceptable, click "Approve" — done. The content is now published.
5. If not acceptable, click "Reject", type a clear reason ("Question 3 has no correct answer", "Citation needed for the stat in item 5"), and confirm.
6. The contributor will see the rejection in their Rejected tab and the editor banner. They edit, resubmit, and you repeat.

### Workflow: Publish content directly (skip review)

You (an admin) wrote some content and want it live immediately.

1. Visit `/admin/content` → Drafts tab.
2. Either click an existing draft, or click "+ New content" to create one.
3. In the editor, paste your JSON body.
4. Click "Publish directly" (the upload icon, top right).
5. The status changes to "published". The content is live.

No review queue entry is created. The audit log records `publish_direct` so there's still a trail.

### Workflow: Unpublish and re-edit a live article

A published article has an error.

1. Visit `/admin/content` → Published tab.
2. Click the row to open the editor.
3. Click "Save draft" first (so you have the current body in the editor).
4. Click the kebab menu / unpublish action — *note: unpublish is exposed via the API, not a visible button in the editor toolbar; in the current build, unpublish is invoked via the API directly. If you need to unpublish, see [§14](#14-d1-sql-cheatsheet-for-operators) for the API call, or use the unpublish button if your build exposes it*.
5. The status reverts to `draft`. Students no longer see the content.
6. Edit the JSON, save, then click "Publish directly" to push the corrected version live.

The old published JSON remains in R2 but is no longer referenced by the app.

### Workflow: Investigate suspicious activity

You got an alert that someone reset a password at 3 a.m. — and it wasn't you.

1. Visit `/admin/audit` → filter by "Password resets".
2. Find the entry with the suspicious timestamp. Note the actor and target.
3. If the actor's account is compromised:
   - Go to `/admin/users`, search for the actor.
   - Click "Reset password" and set a strong new password. This revokes all their sessions.
   - Then click "Reset password" on any accounts they may have changed roles on (filter the audit log by "Role changes" with the same time window).
4. If a non-admin somehow performed the action (shouldn't be possible — every admin endpoint checks role), the audit log will show "Unknown actor" — investigate via D1 directly (see [§14](#14-d1-sql-cheatsheet-for-operators)).
5. Document the incident. The audit log is your forensic record.

### Workflow: Onboard a batch of content editors

You're standing up the editorial team for a new semester.

1. Have each editor register a normal account at the main app.
2. Collect their usernames.
3. For each: visit `/admin/users`, search, change role to Content Admin.
4. (Optional) Send each editor their first assignment: "Create one `library` content object about topic X and submit it for review."
5. Watch the Review Queue as submissions come in.

For large batches (10+ editors), consider scripting the role changes via D1 (see [§14](#14-d1-sql-cheatsheet-for-operators)) — but be aware that bypassing the API means no audit log entries are written.

### Workflow: Reset a locked-out user

A student forgot their password and is locked out.

1. Visit `/admin/users`, search by username or email.
2. Click "Reset password".
3. Generate a strong password (10+ chars, ≥2 char classes). You can use a password manager or `openssl rand -base64 18`.
4. Paste it into the dialog and confirm.
5. Communicate the new password to the user out-of-band (in person, via your school's official email, etc.).
6. All their existing sessions are revoked — they must sign in fresh with the new password.

> **Email is not sent automatically.** Osler doesn't notify the user when an admin resets their password. This is intentional — it prevents an attacker who has compromised an admin account from using the password-reset email as a reconnaissance channel.

### Workflow: Recover from a lost admin account

Your only admin left the org and didn't transfer credentials.

1. Get D1 access via wrangler (you'll need Cloudflare account access).
2. Promote a known-good user to admin:
   ```bash
   npx wrangler d1 execute osler-cloud --remote --command \
     "UPDATE users SET role = 'admin' WHERE username = '<recovery-username>';"
   ```
3. Have that user sign in at `/admin`.
4. Have them demote the old admin's account to `student` (don't delete it — you want the audit trail to remain queryable).

If you've also lost Cloudflare account access, you're in deeper trouble — that's outside Osler's scope.

### Workflow: Clean up after a departing editor

A content_admin is leaving the team.

1. Visit `/admin/users`, find them.
2. Change their role to "Student". They lose admin access on their next API call.
3. Their existing drafts remain owned by them. They can still see and edit those drafts as a content_admin — except they're no longer a content_admin. As a student, they can't see `/admin` at all.
4. If you want their drafts reassigned to someone else: this isn't a UI flow. Either leave the drafts as orphans (visible to admins only) or reassign via D1:
   ```sql
   UPDATE content_objects
   SET created_by = '<new-owner-id>'
   WHERE created_by = '<departing-user-id>' AND status = 'draft';
   ```
5. Don't delete the user — that would reassign their *published* content to whoever does the deletion, which may not be what you want. Demote instead.

### Workflow: Audit the audit log

A compliance officer wants to know "who did what, when".

1. Visit `/admin/audit`.
2. Filter by the action category of interest (e.g. "User deletions").
3. Paginate through the results, noting timestamps, actors, and targets.
4. For deeper analysis, export to CSV via D1:
   ```bash
   npx wrangler d1 execute osler-cloud --remote --command \
     "SELECT datetime(created_at/1000, 'unixepoch') as when_iso, \
             actor_username, action, target_id, detail \
      FROM admin_audit \
      WHERE created_at > strftime('%s','now','-30 days')*1000 \
      ORDER BY created_at DESC;" \
     --json > audit-30d.json
   ```
5. Convert the JSON to a spreadsheet (jq, csvkit, or paste into Excel) for the compliance officer.

---

## 13. Audit log reference

Every admin action that mutates state writes exactly one row to `admin_audit`. Read-only actions (listing users, viewing content, fetching stats) are **not** logged — that would be both noisy and privacy-invasive.

### Schema

| Column | Type | Description |
| --- | --- | --- |
| `id` | TEXT (UUID) | Primary key |
| `actor_id` | TEXT | The admin user's id (foreign key to `users.id`) |
| `actor_username` | TEXT NULL | Denormalized for readability after actor deletion |
| `actor_display_name` | TEXT NULL | Same |
| `action` | TEXT | One of the 11 action codes below |
| `target_id` | TEXT NULL | The id of the affected user or content object |
| `detail` | TEXT NULL | JSON blob with action-specific context |
| `created_at` | INTEGER | Unix milliseconds |

### Action codes and detail payloads

#### User actions

| Action | Target | Detail |
| --- | --- | --- |
| `change_role` | user id | `{ "from": "student", "to": "content_admin" }` |
| `delete_user` | user id | `{ "username": "jane", "displayName": "Jane Doe", "contentReassignedTo": "<admin-id>" }` |
| `reset_password` | user id | (none — no detail, intentionally) |
| `revoke_sessions` | user id | (none) |

#### Content actions

| Action | Target | Detail |
| --- | --- | --- |
| `create_content` | content id | `{ "contentType": "library", "title": "Cardiology 101", "language": "en" }` |
| `submit_content` | content id | (none) |
| `approve` | content id | (none) |
| `reject` | content id | `{ "reason": "Question 3 has no correct answer" }` |
| `publish_direct` | content id | (none) |
| `unpublish` | content id | (none) |
| `delete_content` | content id | `{ "title": "Old Quiz v0" }` |

### Action badge colours (in the UI)

```
change_role      primary   (blue)
delete_user      destructive (red)
reset_password   warning   (amber)
revoke_sessions  warning   (amber)

create_content   muted     (grey)
submit_content   warning   (amber)
approve          success   (green)
reject           destructive (red)
publish_direct   success   (green)
unpublish        muted     (grey)
delete_content   destructive (red)
```

The colour language is consistent: destructive actions are red, approval/publication are green, pending-state actions are amber, neutral actions are grey.

### Retention and pruning

| Aspect | Value |
| --- | --- |
| Retention | 1 year from `created_at` |
| Pruning | Hourly cron (`0 * * * *`) runs `DELETE FROM admin_audit WHERE created_at < ?` |
| Pruning granularity | ~1 hour past the 1-year mark |
| Manual export | `npx wrangler d1 execute osler-cloud --remote --command "SELECT * FROM admin_audit;" --json` |

The audit log is append-only from the application's perspective — no admin endpoint can modify or delete individual entries. The only deletion path is the age-based cron sweep.

---

## 14. D1 SQL cheatsheet for operators

For tasks the UI doesn't expose, or for batch operations, go directly to D1. **Always run SELECT first to verify the target row before any UPDATE or DELETE.**

### Connect

```bash
cd cloudflare/worker
# Remote (production)
npx wrangler d1 execute osler-cloud --remote --command "SELECT COUNT(*) FROM users;"
# Local (dev)
npx wrangler d1 execute osler-cloud --local --command "SELECT COUNT(*) FROM users;"
```

### Promote the first admin (bootstrap)

```sql
SELECT id, username, role FROM users WHERE username = '<your-username>';
UPDATE users SET role = 'admin' WHERE username = '<your-username>';
```

### Promote many users at once

```sql
UPDATE users
SET role = 'content_admin'
WHERE username IN ('alice', 'bob', 'carol', 'dave');
```

> **Note:** Direct SQL updates bypass the audit log. If you need an audit trail for batch promotions, do them one-by-one via the UI, or insert audit rows manually:
>
> ```sql
> INSERT INTO admin_audit (id, actor_id, actor_username, actor_display_name, action, target_id, detail, created_at)
> VALUES (
>   lower(hex(randomblob(16))),
>   '<your-admin-id>',
>   '<your-username>',
>   '<your-displayname>',
>   'change_role',
>   '<target-user-id>',
>   '{"from":"student","to":"content_admin"}',
>   unixepoch() * 1000
> );
> ```

### Inspect users

```sql
-- Recent signups
SELECT id, username, display_name, email, role, created_at
FROM users
ORDER BY created_at DESC
LIMIT 20;

-- Users by role
SELECT role, COUNT(*) FROM users GROUP BY role;

-- Find a user by email
SELECT id, username, role FROM users WHERE email = 'jane@example.com';
```

### Inspect sessions

```sql
-- Active sessions for a user
SELECT id, created_at, expires_at, revoked_at
FROM sessions
WHERE user_id = '<user-id>'
  AND revoked_at IS NULL
  AND expires_at > unixepoch() * 1000;

-- Total active sessions
SELECT COUNT(*) FROM sessions
WHERE revoked_at IS NULL AND expires_at > unixepoch() * 1000;
```

### Revoke all sessions for a user (manual)

```sql
UPDATE sessions
SET revoked_at = unixepoch() * 1000
WHERE user_id = '<user-id>' AND revoked_at IS NULL;
```

### Inspect content

```sql
-- Content by status
SELECT status, COUNT(*) FROM content_objects GROUP BY status;

-- Pending submissions
SELECT id, title, content_type, creator_username, submitted_at
FROM content_objects
WHERE status = 'pending'
ORDER BY submitted_at DESC;

-- Content by an author
SELECT id, title, status, updated_at
FROM content_objects
WHERE created_by = '<user-id>'
ORDER BY updated_at DESC;
```

### Reassign content ownership

```sql
-- Find the new owner's id
SELECT id FROM users WHERE username = '<new-owner>';

-- Reassign
UPDATE content_objects
SET created_by = '<new-owner-id>'
WHERE created_by = '<old-owner-id>';
```

### Force a content state change (emergency)

If the UI is broken and you need to manually flip a content's state:

```sql
-- Force-publish (you also need to copy pending → published in R2!)
UPDATE content_objects
SET status = 'published',
    reviewed_by = '<your-admin-id>',
    reviewed_at = unixepoch() * 1000,
    rejection_reason = NULL
WHERE id = '<content-id>';
```

> **Warning:** D1 status changes don't move R2 objects. If you flip `pending` → `published` via SQL, students will see a 404 because `<base>/published.json` doesn't exist. Use this only for recovery scenarios where you also manually copy the R2 object.

### Inspect the audit log

```sql
-- Last 50 actions
SELECT datetime(created_at/1000, 'unixepoch') as when_iso,
       actor_username, action, target_id, detail
FROM admin_audit
ORDER BY created_at DESC
LIMIT 50;

-- Actions by a specific admin
SELECT datetime(created_at/1000, 'unixepoch') as when_iso,
       action, target_id, detail
FROM admin_audit
WHERE actor_username = '<admin-username>'
ORDER BY created_at DESC;

-- All deletions in the last 30 days
SELECT datetime(created_at/1000, 'unixepoch') as when_iso,
       actor_username, action, target_id, detail
FROM admin_audit
WHERE action IN ('delete_user', 'delete_content')
  AND created_at > unixepoch('now', '-30 days') * 1000
ORDER BY created_at DESC;
```

### Export the audit log to JSON

```bash
npx wrangler d1 execute osler-cloud --remote --command \
  "SELECT * FROM admin_audit ORDER BY created_at DESC;" \
  --json > audit-export.json
```

### R2 inspection

```bash
# List all content objects in R2
npx wrangler r2 object list osler-content --remote

# Fetch a specific content body
npx wrangler r2 object get osler-content/content/library/abc123/published.json /tmp/out.json

# (Optional) Remove an orphaned R2 object
npx wrangler r2 object delete osler-content/content/library/abc123/draft.json
```

---

## 15. Troubleshooting

### "Access Denied" page at `/admin`

You signed in with valid credentials but see the red shield-off screen.

| Cause | Fix |
| --- | --- |
| Your account has role `student` | Ask an admin to promote you, or run the bootstrap SQL in [§4](#4-booting-your-first-admin). |
| Your account was just demoted from `admin` | The page you were already viewing is still rendered; refresh or navigate to trigger the role re-check. |
| You're trying to reach `/admin/dashboard` as a `content_admin` | That page is admin-only. The shell should redirect you to `/admin/content`. If it doesn't, navigate there manually. |
| Cloudflare Access let you through but you didn't sign in with Osler creds | Sign out (top-right) and sign back in with your Osler account. |

### "Protected by Cloudflare Access" screen

The amber warning triangle means `cfEmail` was null in production.

| Cause | Fix |
| --- | --- |
| Cloudflare Access is not configured for this domain | Follow [§3 in `hosting.md`](./hosting.md#step-4-recommended-put-the-admin-panel-behind-cloudflare-access) to set it up. |
| You're hitting the app via a domain that isn't in the Access policy | Add your domain to the Access application, or access via the canonical domain. |
| You're a developer running locally with `NODE_ENV=production` | Either set `NODE_ENV=development` or temporarily bypass the check (don't do this in production). |

### Lost admin access (no admin can sign in)

Recovery requires D1 access via Cloudflare.

1. Sign in to the Cloudflare dashboard.
2. Open the D1 console for `osler-cloud`.
3. Promote a known-good user:
   ```sql
   UPDATE users SET role = 'admin' WHERE username = '<recovery-username>';
   ```
4. Have that user sign in at `/admin`.
5. Once in, demote any compromised admin accounts and rotate `JWT_SECRET` (which invalidates *all* sessions — see [`security.md`](./security.md)).

### Forgot my own admin password

You can't reset your own password from the admin UI — there's no "I forgot" link there. Use the main app's password-reset flow:

1. Visit `https://app.example.com/` (the main app, not `/admin`).
2. Use the "Forgot password" link. A reset email is sent (requires `RESEND_API_KEY` configured — see [`environment.md`](./environment.md)).
3. Reset via the email link.
4. Sign back in at `/admin`.

If email reset isn't configured, another admin can reset your password from the Users page.

### Accidental user deletion

Once a user is deleted, the row is gone. But:

- Their **content** wasn't deleted — it was reassigned to the admin who performed the deletion. Check the audit log entry for `delete_user` to find the `contentReassignedTo` field.
- Their **local device data** (IndexedDB) is untouched. If they re-register with the same username (or you re-create it via D1), they get a fresh empty account — their old progress isn't restored.

If you need to undo a deletion, you can't — but you can:

1. Create a new user with the same username (the user would need to register again, or you insert a row directly into D1 with a known password hash).
2. Reassign the previously-reassigned content back to them via SQL (see [§14](#14-d1-sql-cheatsheet-for-operators)).

### Accidental content deletion

Content deletion removes both the D1 row and all R2 objects under `<r2_key_base>/`. There is no undo. Recovery options:

- **D1 backup restore**: if you take periodic `wrangler d1 export` backups, you can restore the `content_objects` row from a backup. The R2 objects are also gone, so you'd need an R2 backup too.
- **Recreate from source**: if the author still has the JSON (in their notes, a git repo, etc.), create new content and paste the body in.

This is why the deletion confirmation dialog has the wording it does — *"All versions (draft, pending, published) will be removed."* Take it seriously.

### Content stuck in `pending` forever

A submission is in the queue, you click Approve, but nothing happens (toast says "Approve failed").

| Cause | Fix |
| --- | --- |
| R2 write failed (transient) | Retry the approve button. R2 is usually consistent within seconds. |
| R2 binding misconfigured | Check the Worker has a `CONTENT` R2 binding in `wrangler.toml`. Redeploy if missing. |
| `pending.json` is missing in R2 | Someone deleted it out-of-band. Reconstruct by saving a fresh draft and resubmitting. |
| Session expired mid-click | Sign back in; the pending item is still in the queue. |

### Pending count badge is wrong

The sidebar badge polls `/v1/admin/content/pending` once on shell mount. If you approve items in another tab, the badge in the original tab won't update. Refresh the page to re-fetch.

### Audit log entry shows "Unknown actor"

The actor's user account was deleted. The audit row itself is preserved (it has `actor_id` as a foreign key but the FK isn't enforced — D1 doesn't enforce FKs by default). The display falls back to "Unknown actor" because `actor_username` and `actor_display_name` are denormalized at write time, so they should normally be present. If they're null, the entry was written by an older code path before denormalization was added.

To find the actor's id:

```sql
SELECT actor_id, action, target_id, detail
FROM admin_audit
WHERE actor_username IS NULL
  AND created_at > unixepoch('now', '-30 days') * 1000;
```

### R2 not configured

The Content page shows an amber alert: "Content storage is not configured."

Fix: add the `CONTENT` R2 binding to `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "CONTENT"
bucket_name = "osler-content"
```

Redeploy the Worker (`npm run deploy`). The Content page will work after the binding is live.

### Admin tab is stuck on a loading spinner

The shell shows a spinner while `adminApi.me()` is in flight. If it never resolves:

1. Check the Worker is up: `curl https://<worker-domain>/v1/health`.
2. Check the browser console for a CORS error — your `ALLOWED_ORIGIN` may not match the domain you're visiting.
3. Check `sessionStorage` for a stale token — clear it and sign in again.
4. Check the Worker logs (`cd cloudflare/worker && npm run tail`).

### "Cloud features are disabled" error

The admin API throws `AdminApiError(503, "Cloud features are disabled")` when `cloud.enabled = false` in `osler.config.json`. The admin panel requires the cloud backend; without it, there are no users to manage, no content to edit, nothing.

Fix: set `cloud.enabled = true` and `cloud.apiUrl = "<your-worker-url>"` in `public/osler.config.json`, then redeploy the frontend.

### Token works in main app but not in `/admin`

The admin panel uses the same Osler session as the main app, but the Worker enforces role checks on `/v1/admin/*` endpoints. If your role is `student`, `/v1/admin/me` returns 403 and the shell shows the login prompt's "Access Denied" message. Promote your account to `admin` or `content_admin` (see [§4](#4-booting-your-first-admin)).

---

## 16. Best practices

### Least privilege

- Promote users to `content_admin` first. Only upgrade to `admin` when they genuinely need user-management or audit-log access.
- Demote departing editors to `student` rather than deleting them. Their audit trail and content ownership remain queryable.
- Avoid granting `admin` to more than 3-5 people per instance. Each admin is a potential attack surface.

### Operational hygiene

- **Take a D1 export weekly.** `npx wrangler d1 export osler-cloud --remote --output=backup-$(date +%F).sql`. Keep at least 4 weeks of backups.
- **Take an R2 inventory monthly.** List all objects; verify the count matches `SELECT COUNT(*) FROM content_objects * 3` (draft + pending + published slots).
- **Review the audit log weekly.** Filter by `delete_user`, `delete_content`, `reset_password` — the high-impact actions. Investigate anything unexpected.
- **Rotate `JWT_SECRET` annually** (or immediately on any suspected compromise). This invalidates every session everywhere.

### Content hygiene

- Encourage contributors to submit for review rather than asking admins to publish directly. The review queue creates an audit trail and a second pair of eyes.
- Use clear, descriptive titles. The browser doesn't show content_type as a search filter — titles are how you find things.
- Delete unused drafts. They clutter the Drafts tab and consume (tiny amounts of) R2 storage.
- Don't unpublish content as a soft-delete. Either leave it published or delete it outright. Unpublished-but-not-deleted content confuses future admins.

### Security hygiene

- **Always** use Cloudflare Access in front of `/admin` in production. The two-door design is your friend.
- Don't share admin accounts. Each admin signs in with their own Osler identity; the audit log attributes every action to a specific person.
- If you suspect an admin's session was observed (screen share, shoulder surf), have them sign out, then sign back in on a clean device, then visit the Users page and revoke their other sessions.
- Treat `JWT_SECRET` like a root password. Anyone with it can forge any session, including admin sessions. Store it in `wrangler secret`, never in `wrangler.toml` or git.

### Communication

- When you change a user's role, tell them — both the fact and the implication (what they can now do, what they can no longer do).
- When you reset a password, deliver the new password out-of-band (in person, via phone, via your school's official messaging). Never via the same channel the user used to request it.
- When you reject a submission, write a constructive reason. "Bad" is not a reason. "Question 3's correct answer is B, not A — please re-check the source" is.
- When you delete content, tell the author before you do it. They may have a local copy and won't be surprised.

### What not to do

- **Don't** insert fake audit rows to cover up an action. The schema is append-only from the application; if you insert via SQL, timestamps will mismatch cron-pruned neighbours and the forgery will be obvious.
- **Don't** manually flip content status in D1 as a shortcut. The R2 state will diverge from the D1 state and students will see 404s.
- **Don't** grant `admin` to "test" accounts. Even if you intend to demote them later, you'll forget.
- **Don't** copy R2 objects between content ids by hand. The `r2_key_base` is the source of truth; if you copy `published.json` to a different base, the app won't find it.
- **Don't** leave the admin tab open on a shared computer. Sign out when you walk away. `sessionStorage` survives page refreshes.

---

## Appendix: Quick reference

### All admin API endpoints

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/admin/me` | any | Returns identity + capabilities |
| GET | `/v1/admin/stats` | admin | Dashboard counters |
| GET | `/v1/admin/users?page=…&q=…` | admin | Paginated user list (25/page) |
| GET | `/v1/admin/users/:id` | admin | User detail with sessions + content |
| PATCH | `/v1/admin/users/:id` | admin | Change role / display name |
| POST | `/v1/admin/users/:id/reset-password` | admin | Reset password (revokes sessions) |
| PATCH | `/v1/admin/users/:id/email-verification` | admin | Manually flip email verification (enables Google linking) |
| DELETE | `/v1/admin/users/:id` | admin | Delete user (cannot be self) |
| GET | `/v1/admin/users/:id/sessions` | admin | List user's sessions |
| DELETE | `/v1/admin/users/:id/sessions` | admin | Revoke all user's sessions |
| GET | `/v1/admin/content?status=…&q=…` | admin, content_admin | List content by status |
| GET | `/v1/admin/content/:id` | admin, content_admin | Get content (with body) |
| POST | `/v1/admin/content` | admin, content_admin | Create new content |
| PUT | `/v1/admin/content/:id/draft` | admin, content_admin | Save draft body |
| POST | `/v1/admin/content/:id/submit` | admin, content_admin | Submit for review |
| POST | `/v1/admin/content/:id/publish` | admin | Publish directly |
| POST | `/v1/admin/content/:id/unpublish` | admin | Revert published → draft |
| DELETE | `/v1/admin/content/:id` | admin (any), content_admin (own) | Delete content |
| GET | `/v1/admin/content/pending` | admin | Review queue |
| GET | `/v1/admin/content/:id/diff` | admin | Pending vs. published diff |
| POST | `/v1/admin/content/:id/approve` | admin | Approve pending |
| POST | `/v1/admin/content/:id/reject` | admin | Reject pending (with reason) |
| GET | `/v1/admin/audit?page=…&action=…` | admin | Audit log (50/page) |

### All admin routes (Next.js)

| Route | Component | Guard |
| --- | --- | --- |
| `/admin` | `AdminHomeRedirect` | redirects to `/admin/dashboard` (admin) or `/admin/content` (content_admin) |
| `/admin/dashboard` | `StatsOverview` | `requireSuperAdmin` |
| `/admin/users` | `UsersTable` | `requireSuperAdmin` |
| `/admin/content` | `ContentBrowser` | (any admin role) |
| `/admin/content/:id` | `ContentEditor` | (any admin role) |
| `/admin/review` | `ReviewQueue` | `requireSuperAdmin` |
| `/admin/review/:id` | `ContentDiff` | `requireSuperAdmin` |
| `/admin/audit` | `AuditLogTable` | `requireSuperAdmin` |

### All audit actions

```
User actions:    change_role, delete_user, reset_password, revoke_sessions
Content actions: create_content, submit_content, approve, reject,
                 publish_direct, unpublish, delete_content
```

### Key file paths in the repo

| Path | Purpose |
| --- | --- |
| `src/app/admin/layout.tsx` | Server component, reads CF Access header, renders shell |
| `src/app/admin/*/page.tsx` | One per route, wraps a content component in `AdminPageFrame` + guard |
| `src/components/osler/admin/admin-shell.tsx` | Top bar, sidebar, theme, sign-out, session restore |
| `src/components/osler/admin/admin-api.ts` | The `adminApi` client + all TypeScript types |
| `src/components/osler/admin/admin-route-guard.tsx` | Client-side `requireSuperAdmin` check |
| `src/components/osler/admin/users-table.tsx` | Users page UI |
| `src/components/osler/admin/content-browser.tsx` | Content browser UI + create dialog |
| `src/components/osler/admin/content-editor.tsx` | Content editor UI |
| `src/components/osler/admin/content-diff.tsx` | Diff view for review |
| `src/components/osler/admin/review-queue.tsx` | Review queue list UI |
| `src/components/osler/admin/stats-overview.tsx` | Dashboard tiles |
| `src/components/osler/admin/audit-log-table.tsx` | Audit log table + filter |
| `src/components/osler/admin/admin-login-prompt.tsx` | The Osler credential sign-in form |
| `src/lib/osler/i18n/en.ts` | English strings (search `"admin."` for the admin namespace) |
| `cloudflare/worker/src/index.ts` | The backend that serves `/v1/admin/*` |
| `cloudflare/worker/migrations/0001_schema.sql` | Schema for `content_objects` + `admin_audit` (consolidated single-file baseline) |

---

*This guide describes the admin panel as of the current `main` branch. If you find a discrepancy between this document and the actual UI, trust the UI — and please open a PR to fix the doc.*
