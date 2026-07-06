# Patch Notes — Osler Rebase v2 (MedOS Lite UI/UX Match)

**Date**: 2026-07-06
**Type**: Major UI overhaul
**Scope**: Topbar-only AppShell + QBank Studio (exact copy) + Article Library

## Overview

Following the initial rebase, this patch:
1. **Removes the sidebar** from Osler's AppShell — now matches MedOS Lite's topbar-only layout exactly
2. **Copies the Quiz/Bank UI from MedOS Lite's QBank Studio** — navy topbar with question counter + timer, left strip question navigator, split-pane question + explanation view, bottom action bar with Prev / Flag / Submit / Next
3. **Adds article support** like MedOS Lite's AMBOSS reader — TOC sidebar with collapsible specialty tree, article panel with rich HTML, zoom controls, bookmarks, search integration
4. **Fixes broken UI** throughout — unified engine components, consistent styling, proper mobile responsive behavior

## Top-bar-only AppShell (matches MedOS Lite exactly)

The previous sidebar-based layout has been replaced with medos-lite's exact topbar pattern:

- **Logo** (left) — Activity icon in primary-tinted rounded square + "Osler / Medical Study Platform" text
- **Horizontal nav** with animated active indicator (`layoutId="nav-active"` spring animation):
  - Dashboard (LayoutDashboard icon)
  - Library (BookOpen icon)
  - Q-Bank Studio (ListChecks icon)
- **Center search pill** (desktop ≥lg) — Popover with article autocomplete; "Ctrl+K" keyboard shortcut
- **Theme toggle** — Sun/Moon icon, dark/light toggle
- **User menu** — Avatar with initials, dropdown with Profile / Settings / Sign out
- **Mobile bottom tab bar** (<768px) — 5-item nav: Home, Library, Q-Bank, Profile, Settings

## QBank Studio — exact copy from MedOS Lite

The previous separate Quiz/Bank/Flashcard/Written/OSCE engine components have been merged into a single unified `QBankStudio` component that copies medos-lite's exact UI:

### Home view (Create Test tab)
- **Section 1**: Select Test Mode — Timed vs Tutor mode cards
- **Section 2**: Available Content Packs — list of all 5 sample packs with progress indicators
- **Right rail**: Sticky Test Summary card

### Quiz view (running session)
- **Navy topbar** (`qbank-topbar` class) — QBank Studio logo, engine label, mode label, "Question X of Y", timer (turns red when < 5 min remaining in timed mode), pause/resume button
- **Left strip navigator** (`qbank-nav-strip`) — 1-per-square numbered grid with state colors:
  - Current: ring-2 ring-primary
  - Flagged: amber background
  - Correct (after submit): blue background
  - Incorrect (after submit): red background
  - Answered (not yet revealed): primary-tinted
- **Center question panel** — Question header with engine badge + difficulty, stem text in `uworld-prose` style, 5 choices with circular letter badges (A–E)
- **Choice buttons** (`qbank-choice` class) — 2px border, rounded-xl, hover state with primary tint
  - Selected: primary border + tinted background
  - Correct (after submit): blue border + blue letter circle with checkmark
  - Wrong (after submit): red border + red letter circle with X
  - Other (after submit): faded opacity
- **Split-pane explanation** (after submit, tutor mode) — Right column 45% width with `ExplanationCard`:
  - Header: blue (correct) or red (wrong) with circular icon
  - Body: explanation text + tags
- **Bottom action bar** — Prev / Flag / Submit Answer (or Retry if submitted) / Next (or End Test if last)
- **Mobile bottom bar** — Compact icon buttons + flex-1 primary action

### Results view
- Score % with color (blue ≥70, amber ≥50, red <50)
- Percentile rank (estimated)
- Answered / Incorrect / Flagged / Total Time / Avg per question
- Score distribution bar (blue correct / red incorrect / gray unanswered)
- Per-question review list

### Engine unification
All 5 engine types are now played through the same QBank Studio UI:
- **Quiz** — Standard MCQ flow
- **Bank** — Passage is prepended to question stem (single-pane), then standard MCQ flow
- **Flashcard** — Front shown as stem, "Reveal Answer" button shows back as explanation
- **Written** — Prompt as stem, rubric items shown inline, "Reveal Answer" shows rubric as explanation
- **OSCE** — Scenario as stem, Red Flags + Differential + Rubric shown inline, "Reveal Answer" shows rubric as explanation

## Article Library (AMBOSS-style)

Added `Library` component matching medos-lite's AMBOSS reader pattern:

### TOC sidebar
- Tree structure with collapsible specialty → subcategory → article
- Chevron icons rotate 90° when expanded
- Active article highlighted with primary tint
- Bookmark indicator on leaf nodes
- Footer shows total article count + bookmark count

### Article panel
- Header with breadcrumb (specialty › system) + read time + zoom controls + bookmark button
- Rich HTML rendering via `dangerouslySetInnerHTML` with `.library-article` styling:
  - h1/h2/h3 with proper hierarchy and primary-colored h3
  - Tables with bordered cells
  - Callout boxes (primary tinted) and warning boxes (red tinted)
  - Code blocks, blockquotes, lists
- Zoom: 80%–140% with reset button
- Animated page transitions via framer-motion

### Sample articles
9 medical articles across 4 specialties:
- **Cardiology** (3): STEMI, Acute Coronary Syndromes, HFrEF
- **Pulmonology** (3): COPD, Asthma, Pulmonary Embolism
- **Neurology** (2): Acute Ischemic Stroke, Subarachnoid Hemorrhage
- **Gastroenterology** (1): Cirrhosis & Portal Hypertension

Each article is 6–10 minute read with full pathophysiology, clinical presentation, diagnosis, management, complications, and prognosis — formatted as structured HTML with tables, callouts, and warnings.

### Search integration
The topbar search pill (Ctrl+K) now searches articles by title, specialty, and tags. Clicking a result jumps to the Library view with that article open.

## Other UI Fixes

### Dashboard
- Removed old "engine cards" pattern
- Added "Continue learning" hero card (shows most recent pack with progress)
- Featured articles section (3 random picks)
- Recent activity section
- Stats tiles are clickable (navigate to relevant views)
- Quick actions: Q-Bank Studio / Article Library / View Profile

### Profile (new view)
- Profile header with avatar + username + active learner badge
- 4 stat tiles: Attempted / Correct / Wrong / Accuracy
- Performance by Engine breakdown with progress bars
- 6 achievements with locked/unlocked states:
  - First Steps (1 question)
  - Sharp Shooter (10 correct)
  - On Fire (80% accuracy with 20+ questions)
  - Consistent (3 packs)
  - Determined (50 questions)
  - Marathon (100 questions)

### Settings
- Theme toggle (Dark/Light) — same as before
- Data & Progress section — shows pack count with Clear button
- Keyboard Shortcuts list
- About section with version info

### Mobile responsive
- Topbar nav items collapse to icons only on small screens
- Mobile bottom tab bar replaces sidebar nav
- Library TOC becomes a slide-in overlay (triggered by floating button)
- QBank Studio bottom action bar switches to compact icon buttons
- All touch targets meet 44px minimum

## Files Added

- `src/components/osler/library.tsx` — AMBOSS-style article reader
- `src/components/osler/qbank-studio.tsx` — Unified QBank Studio (replaces 5 separate engine files)
- `src/components/osler/profile.tsx` — Profile view with achievements
- `src/lib/osler/articles.ts` — 9 sample articles + TOC tree + search

## Files Removed

- `src/components/osler/quiz-engine.tsx` (replaced by QBank Studio)
- `src/components/osler/bank-engine.tsx` (replaced by QBank Studio)
- `src/components/osler/flashcard-engine.tsx` (replaced by QBank Studio)
- `src/components/osler/written-engine.tsx` (replaced by QBank Studio)
- `src/components/osler/osce-engine.tsx` (replaced by QBank Studio)
- `src/components/osler/hub.tsx` (replaced by QBank Studio Home view)
- `src/components/osler/tracker.tsx` (replaced by Profile + QBank Performance tab)

## Files Changed

- `src/app/globals.css` — Added 400 lines of QBank Studio + Library styling
- `src/app/page.tsx` — Updated view routing (5 views instead of 7)
- `src/components/osler/app-shell.tsx` — Rewritten as topbar-only (no sidebar)
- `src/components/osler/mobile-tab-bar.tsx` — Updated for new 5-tab layout
- `src/components/osler/dashboard.tsx` — New layout with featured articles
- `src/components/osler/settings.tsx` — Minor updates

## Self-verification

Browser-verified end-to-end:
- ✅ Topbar-only AppShell (no sidebar) — 3 nav items + search + theme + user menu
- ✅ Mobile bottom tab bar with 5 tabs
- ✅ Dashboard: continue-learning card, stat tiles, quick actions, featured articles, recent activity
- ✅ Library: TOC sidebar with collapsible tree, article panel with rich HTML, zoom, bookmarks
- ✅ Article search via Ctrl+K pill — filters 9 articles by query
- ✅ QBank Studio home: Create Test / Performance tabs, mode cards, pack list, summary sidebar
- ✅ QBank Studio quiz: navy topbar, left strip navigator, split-pane question+explanation
- ✅ Choice buttons: blue correct / red wrong with letter circles and checkmark/X icons
- ✅ Submit → reveal explanation in right pane
- ✅ Results view with score, percentile, distribution, per-question review
- ✅ All 5 engines unified through QBank Studio UI (Quiz, Bank, Flashcard, Written, OSCE)
- ✅ Profile view with stats + engine breakdown + 6 achievements
- ✅ Theme toggle (dark ↔ light) persists
- ✅ Progress persists across navigation (localStorage)
- ✅ Mobile responsive: topbar collapses, TOC slides in, bottom bar adapts
- ✅ No console errors, no runtime errors, lint clean
