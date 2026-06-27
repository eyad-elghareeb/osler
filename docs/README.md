# Osler V2 — Developer & Site Admin Documentation

This package contains the complete developer and site administrator documentation
for **Osler V2**, the modular quiz-site platform that succeeds Osler V1.

> Named after Sir William Osler, the father of modern medical education.

## What's inside

| Path | Purpose |
|------|---------|
| `mkdocs.yml` | mkdocs-material configuration — serves the docs locally or builds the static site |
| `docs/index.md` | Landing page |
| `docs/architecture/` | V2 vision, surfaces, personas, data flow, threat model |
| `docs/development/` | Local setup, project structure, coding conventions, testing, contributing |
| `docs/admin-dashboard/` | Tauri desktop admin — install, CMS workflow, AI content generation, bundle updates |
| `docs/site-generation/` | Generator wizard, content packs, local preview |
| `docs/deployment/` | Provider integrations — GitHub Pages, Netlify, Vercel, Cloudflare Pages, rollback |
| `docs/firebase/` | Self-hosting ("bring your own Firebase"), security rules, sync strategies |
| `docs/engines/` | Engine reference — quiz, bank, flashcard, written, OSCE |
| `docs/content-authoring/` | JSON schemas, content types, meta fields, validation |
| `docs/i18n/` | EN/AR UI strings, RTL layout guide |
| `docs/ai-tutor/` | Lightweight chat modal, cost caps |
| `docs/operations/` | CI/CD pipelines, monitoring, backups, incident response |
| `docs/troubleshooting/` | Common issues, debugging |
| `docs/api-reference/` | `src/lib/*` modules + Tauri admin commands |
| `docs/migration/` | V1 → V2 migration guide |
| `docs/glossary.md` | Key terms used throughout the docs |

## Quick start

### Serve docs locally (recommended for writers)

```bash
pip install mkdocs mkdocs-material mkdocs-section-index
cd osler-v2-developer-admin-docs
mkdocs serve
# open http://127.0.0.1:8000
```

### Build a static site for deployment

```bash
mkdocs build              # produces site/
# deploy site/ to GitHub Pages / Netlify / Firebase Hosting
```

### Deploy to GitHub Pages with one command

```bash
mkdocs gh-deploy          # pushes site/ to the gh-pages branch
```

## Audience

This documentation set targets three audiences:

1. **Developers** — engineers contributing to the Osler V2 codebase (vanilla JS
   PWA + Tauri Rust admin). Read the *Development*, *API Reference*, and
   *Architecture* sections.
2. **Site administrators** — operators of the Tauri admin dashboard who manage
   content, generate site bundles, and push updates to deployed instances. Read
   the *Admin Dashboard*, *Site Generation*, and *Deployment* sections.
3. **Self-hosters** — users who deploy a generated Osler site and bring their
   own Firebase project for multi-user sync and the AI tutor. Read the
   *Firebase*, *Deployment*, and *Operations* sections.

## Source plans

These docs are derived from:

- `v1-osler-plan-enhanced.md` — V1 ship state (Phases 0-8)
- `v2-osler-plan-enhanced.md` — V2 plan (Phases 9-16) — the authoritative
  scope document for this documentation set
- `v2-llm-execution-guide.md` — per-session execution steps for LLM agents
- `AGENTS.md`, `SECURITY.md`, `README.md` — V1 contributor and security
  references

Where V2 work is still in progress (Phases 9-16 are not yet shipped), the docs
describe the **intended V2 behavior** as specified in the plan, with clear
callouts when a feature is still pending implementation.

## License & attribution

Osler is open source. See the repository LICENSE file for details.
