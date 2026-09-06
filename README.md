
<p align="center">
  <img alt="Osler Logo" src="public/assets/icon.svg" width="128" height="128">
</p>

<h1 align="center">Osler</h1>

<p align="center"><strong>Medical Study Platform</strong></p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#tech-stack"><strong>Tech Stack</strong></a> ·
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="#self-hosting"><strong>Self-Hosting</strong></a> ·
  <a href="#documentation"><strong>Docs</strong></a>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js%2016-000000?style=for-the-badge&logo=next.js&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React%2019-61DAFB?style=for-the-badge&logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript%205-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind%20CSS%204-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa">
  <img alt="i18n" src="https://img.shields.io/badge/i18n-EN%20%7C%20AR-10b981?style=flat-square">
</p>

<br>

Unified medical study platform combining **Quiz Banks**, **Flashcards**, **OSCE Clinical Cases**, a **Video Library**, and an **Article Library** — in a single installable PWA with full Arabic RTL support, optional cloud accounts and cross-device sync, and a self-hostable Cloudflare backend that runs entirely on the free tier.

Fully open-source (MIT) and built for self-hosting: fork the repo, white-label it via one config file, choose which engine plugins to include, and deploy frontend + backend in about an hour. The bundled Tauri admin app automates the whole flow.

---

## ✦ Features

### Seven engine plugins

Each engine is a toggleable plugin — disabled engines disappear from the UI and stop loading content, without deleting anything on disk.

| Engine | What it does |
|--------|--------------|
| **Quiz** | Standard MCQ — timed/tutor modes, navigator, split-pane explanations, PDF export |
| **Bank** | Passage-based question sets |
| **Written** | Short-answer prompts with rubric review and photo mode (camera capture + Gemini OCR) |
| **Flashcard** | Spaced repetition — basic + Anki-style cloze cards, subdecks, Anki export |
| **OSCE** | Clinical simulator — AI voice interaction, hidden profiles, rubrics, scoring |
| **Library** | AMBOSS-style article reader — specialty TOC, highlighting, notes, Mermaid diagrams |
| **Video** | Lectures & clinical skills — YouTube/Plyr player, Invidious support, wake lock |

### Platform

- **Cross-device sync** — cloud accounts (email/password + Google OAuth) on a Cloudflare Worker + D1 backend, plus P2P (WebRTC), QR, and file-backup transports
- **Runs on the Cloudflare free tier** — sharded D1 storage (~2.5 GB sync pool), self-imposed write caps, and a live quota panel in the admin analytics
- **PDF export engine** — jsPDF with multi-style layouts and full Arabic BiDi/shaping
- **Full Arabic RTL** — UI language decoupled from content language; per-pack content languages
- **AI assistant** — Gemini-powered Q&A, written-answer grading, photo OCR (users bring their own key)
- **Native-app feel** — installable PWA: slide transitions, haptics, wake lock, safe-area layout, offline content cache
- **White-label ready** — one `osler.config.json` drives branding, plugins, themes, and defaults; 8 built-in themes + custom oklch palettes

---

## ✦ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 (static export) · React 19 · TypeScript 5 · Tailwind CSS 4 · shadcn/ui (49 primitives) · framer-motion |
| **Backend** | Cloudflare Workers · D1 (shardable SQL) · R2 (content storage) · Durable Objects (realtime sync pokes) |
| **Content** | Folder-based JSON packs + Markdown articles (`remark`/`rehype`), manifest-generated |
| **PDF** | jsPDF v4 + bidi-js (Arabic BiDi & shaping) |
| **i18n** | Custom flat-dictionary system (en/ar) + RTL |
| **Sync** | Cloud (Workers/D1) · PeerJS WebRTC + MQTT · QR (LZ-string + CRC32) · `.osler-backup` files |
| **AI** | Gemini API (configurable model, user-supplied key) |
| **Desktop admin** | Tauri (Rust) — instance generator, config editor, content studio, deploy pipelines |

---

## ✦ Project Structure

```
src/                        Next.js app (App Router, components, hooks, lib)
├── app/                    Path-based routes under (app)/ + login
├── components/osler/       App components (studios, shell, admin, sync panels)
├── components/ui/          49 shadcn/ui primitives
├── hooks/                  Shared React hooks
└── lib/osler/              Business logic (storage, content, sync, pdf, i18n, native/)

public/osler-content/       Folder-based content (qbank/, flashcard/, osce/, library/, videos/)
public/osler.config.json    Instance configuration (branding, plugins, themes, cloud)
cloudflare/worker/          Cloudflare Worker backend (D1 + R2 + realtime hub + cron)
tauri-admin/                Desktop admin suite (Rust + TS): wizard, generator, CMS
scripts/                    Manifest generation, build & deploy helpers
docs/                       Full documentation set
```

---

## ✦ Quick Start (development)

```bash
# Prerequisites: Node.js 22 (see .nvmrc)
npm install                    # Install dependencies
npm run generate-manifests     # Generate content manifests
npm run dev                    # Frontend → http://localhost:3000
npm run dev:full               # Frontend + Cloudflare Worker backend (http://localhost:8787)
```

Local-first by default: everything works without an account. Add the cloud backend for accounts and cross-device sync — see the self-hosting guide. Environment templates: `.env.example` (root) and `cloudflare/worker/.env.example`.

Production build: `npm run build` produces a static export in `out/` (`npm start` serves it locally).

---

## ✦ Self-Hosting

The fastest full deployment target is Cloudflare's free tier — Pages for the frontend, a Worker for the backend, D1 for accounts/sync, R2 for content storage. The guide covers every step A to Z:

> **[`SELF-HOSTING.md`](SELF-HOSTING.md) — start a full instance from zero, step by step.**

| What | Where |
|---|---|
| Full A-to-Z deployment (Cloudflare, free tier) | [`SELF-HOSTING.md`](SELF-HOSTING.md) |
| Worker backend overview & Google Sign-In | [`docs/cloudflare-backend.md`](docs/cloudflare-backend.md) |
| All hosting targets (Vercel, VPS, Docker, GitHub Pages) | [`docs/hosting.md`](docs/hosting.md) · [`docs/deployment.md`](docs/deployment.md) |
| Desktop admin app (automates the deployment steps) | [`docs/tauri-admin.md`](docs/tauri-admin.md) · [`tauri-admin/`](tauri-admin/) |

---

## ✦ Configuration

Every instance decision lives in one file: [`public/osler.config.json`](public/osler.config.json). Site identity, engine plugins, themes, default view/language/quiz options, and the cloud backend URL are all driven from it — the schema lives in [`src/lib/osler/config.ts`](src/lib/osler/config.ts) and the loader merges your file over sensible defaults, so a partial config always boots. The Tauri admin app ships a visual **Config Editor** and a first-run **Setup Wizard** for the same file.

---

## ✦ Documentation

| Document | Covers |
|---|---|
| [`SELF-HOSTING.md`](SELF-HOSTING.md) | Step-by-step full-instance deployment (A→Z) |
| [`docs/hosting.md`](docs/hosting.md) | Every hosting target, custom domains, monitoring, upgrades |
| [`docs/deployment.md`](docs/deployment.md) | Per-host runbooks, CI/CD, rollback procedures |
| [`docs/cloudflare-backend.md`](docs/cloudflare-backend.md) | Worker backend, Google Sign-In, sync behavior |
| [`docs/environment.md`](docs/environment.md) | All env vars, config schema, precedence rules |
| [`docs/api-reference.md`](docs/api-reference.md) | Worker HTTP API reference |
| [`docs/admin-guide.md`](docs/admin-guide.md) | Admin panel walkthrough + D1 cheatsheet |
| [`docs/security.md`](docs/security.md) | Threat model, RBAC, hardening checklist |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Symptom → cause → fix for ~80 issues |
| [`docs/tauri-admin.md`](docs/tauri-admin.md) | Desktop admin app guide |
| [`docs/forking.md`](docs/forking.md) | Fork workflow, staying in sync with upstream |
| [`docs/contributing.md`](docs/contributing.md) | Dev setup, conventions, releasing |

---

## ✦ License

<p align="center">
  <a href="LICENSE">
    <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-0ea5e9?style=for-the-badge">
  </a>
</p>

<p align="center">
  <a href="https://github.com/eyad-elghareeb/osler">github.com/eyad-elghareeb/osler</a> ·
  <a href="SELF-HOSTING.md">Self-hosting guide</a> ·
  <a href="docs/">Full documentation</a> ·
  <a href="docs/security.md">Security</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>
