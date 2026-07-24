# Osler documentation

This folder contains the complete documentation for the Osler medical study platform. Start with the guides most relevant to your role, then dive deeper as needed.

> **Source repository:** <https://github.com/eyad-elghareeb/osler> · **License:** MIT

## Getting started

| If you want to… | Read this first |
| --- | --- |
| Deploy Osler for the first time | [`hosting.md`](./hosting.md) |
| Fork & customise Osler for your school | [`forking.md`](./forking.md) |
| Understand the security model | [`security.md`](./security.md) |
| Use the admin panel | [`admin-guide.md`](./admin-guide.md) |
| Integrate against the Worker API | [`api-reference.md`](./api-reference.md) |
| Configure environment variables | [`environment.md`](./environment.md) |
| Operate the Tauri admin desktop app | [`tauri-admin.md`](./tauri-admin.md) |

## Document index

| Document | Audience | Description |
| --- | --- | --- |
| [`hosting.md`](./hosting.md) | Operators | All hosting options (Cloudflare, Vercel, VPS, Docker, static), custom domains, post-deploy verification, monitoring, upgrades. |
| [`forking.md`](./forking.md) | Fork maintainers | Fork workflow, white-labelling, keeping in sync with upstream, resolving merge conflicts, contributing back. |
| [`deployment.md`](./deployment.md) | Operators / DevOps | Per-host deployment runbooks (Cloudflare Pages+Worker, Vercel, VPS, Docker, GitHub Pages, Netlify), CI/CD pipelines, blue/green & canary, rollback procedures. |
| [`security.md`](./security.md) | Operators / Security teams | Threat model, authentication, RBAC, CORS, security headers, rate limiting, audit logging, hardening checklist, known limitations. |
| [`admin-guide.md`](./admin-guide.md) | Admins | Walkthrough of every admin page, common workflows, D1 SQL cheatsheet, troubleshooting. |
| [`api-reference.md`](./api-reference.md) | Developers | Full HTTP API reference for all 39 Worker endpoints with curl examples, request/response schemas, and error handling. |
| [`cloudflare-backend.md`](./cloudflare-backend.md) | Operators / Developers | Worker backend overview, deployment steps, Google Sign-In config, environment variables, sync behavior. |
| [`environment.md`](./environment.md) | Operators / Developers | Complete reference for all env vars, `osler.config.json` schema, `wrangler.toml` config, hardcoded constants, validation rules, precedence. |
| [`troubleshooting.md`](./troubleshooting.md) | Everyone | Symptom → cause → fix for ~80 common issues across build, deploy, auth, admin, sync, PWA, content, performance. |
| [`tauri-admin.md`](./tauri-admin.md) | Operators | Tauri desktop admin app: build, first-run, setup wizard, config editor, instance generator, content editor, build runner, git ops, deployment providers, troubleshooting. |
| [`contributing.md`](./contributing.md) | Contributors | Dev setup, coding conventions, i18n rule, git workflow, adding content packs / engine plugins / admin endpoints, releasing. |

## Related files outside `docs/`

| File | Purpose |
| --- | --- |
| [`../README.md`](../README.md) | Project overview, features, tech stack, project structure. |
| [`../SELF-HOSTING.md`](../SELF-HOSTING.md) | Quick self-hosting guide (older, see `hosting.md` for the comprehensive version). |
| [`../AGENTS.md`](../AGENTS.md) | Architecture & conventions for AI agents and contributors. |
| [`../SECURITY.md`](../SECURITY.md) | Vulnerability disclosure policy. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Release notes. |
| [`../LICENSE`](../LICENSE) | MIT license. |
| [`../cloudflare/worker/README.md`](../cloudflare/worker/README.md) | Worker-specific deployment summary. |
| [`../tauri-admin/README.md`](../tauri-admin/README.md) | Tauri admin quick start. |

## Quick links to common tasks

- **Deploy to Cloudflare**: [`hosting.md` §3](./hosting.md#3-option-a-cloudflare-pages--worker-recommended)
- **Configure Google Sign-In**: [`cloudflare-backend.md` §Google Sign-In Configuration](./cloudflare-backend.md#google-sign-in-configuration)
- **Promote the first admin user**: [`admin-guide.md` §4](./admin-guide.md) or [`hosting.md` §3 Step 3](./hosting.md#step-3-create-your-first-admin-user)
- **Reset a user's password as admin**: [`admin-guide.md` §7](./admin-guide.md)
- **Investigate suspicious admin activity**: [`admin-guide.md` §12](./admin-guide.md) → "Investigate suspicious activity"
- **Put admin behind Cloudflare Access**: [`security.md` §5](./security.md#5-admin-panel-security) → "Cloudflare Access integration"
- **Set up rate limiting rules in Cloudflare**: [`security.md` §7](./security.md#7-rate-limiting--abuse-prevention)
- **Back up D1**: [`hosting.md` §11](./hosting.md#11-operating--monitoring) → "Backups"
- **Upgrade your instance**: [`hosting.md` §12](./hosting.md#12-upgrading-your-instance) or [`forking.md` §5](./forking.md#5-keeping-your-fork-in-sync-with-upstream)
- **Resolve a merge conflict on osler.config.json**: [`forking.md` §6](./forking.md#6-resolving-common-merge-conflicts)
- **Find the right environment variable**: [`environment.md` §10](./environment.md) → "Quick-reference cheat sheets"
- **Report a security vulnerability**: [`../SECURITY.md`](../SECURITY.md)
- **Contribute a bug fix**: [`contributing.md`](./contributing.md)
