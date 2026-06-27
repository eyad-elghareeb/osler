# Contributing

Osler V2 accepts contributions via GitHub pull requests. This page describes
the branch model, the PR checklist, and the CI gates your PR must pass.

## Branch model

Osler uses a trunk-based development model with a single long-lived branch
(`main`) and short-lived feature branches.

| Branch | Lifetime | Purpose |
|--------|----------|---------|
| `main` | Permanent | Always shippable. CI must be green. The source of truth. |
| `feat/{scope}-{short-description}` | Days to weeks | Feature work. e.g. `feat/sync-user-content` |
| `fix/{scope}-{short-description}` | Days | Bug fixes. e.g. `fix/sync-timestamp-divergence` |
| `docs/{short-description}` | Days | Documentation only. e.g. `docs/firebase-bring-your-own` |
| `chore/{short-description}` | Hours to days | Tooling, deps, CI. e.g. `chore/bump-node-20` |
| `release/v{x.y.z}` | Hours | Release prep. Merged into `main` and tagged. |

Branch off `main`, rebase onto `main` before opening a PR, and squash-merge
back into `main`. Force-pushes to your own feature branch are fine; never
force-push to `main`.

## Commit messages

Use conventional commits (see [Coding Conventions](coding-conventions.md#commit-message-format)).
Each PR should have a clean commit history — squash mid-PR commits before
merging if they're noisy.

## Pull request checklist

Before opening a PR, verify:

- [ ] Branch is rebased on latest `main`.
- [ ] `npm run check` passes locally (build + unit/integration + content +
      schema validation).
- [ ] `npm run test:e2e` passes locally if your change touches user flows.
- [ ] No new `localStorage` keys (or, if added, they're in the allow-list
      with a justification in the PR description).
- [ ] No secrets in code, env files, or commits (run `git log -p | grep -iE
      'token|key|secret'` to double-check).
- [ ] No new dependencies without justification (the only runtime dep should
      stay `firebase`).
- [ ] New code follows [Coding Conventions](coding-conventions.md).
- [ ] If touching schemas: bumped `_meta.json` version, ran
      `npm run validate-schemas`.
- [ ] If touching content: ran `npm run validate`.
- [ ] If touching CI: tested the change on a fork branch first.
- [ ] PR description explains the why, not just the what.
- [ ] PR links to the relevant issue (or creates one if missing).
- [ ] PR uses conventional commit format in the title.

## CI gates

Every PR runs the full CI pipeline defined in `.github/workflows/ci.yml`. The
pipeline has three jobs:

### `check` job

Runs on every PR and push to `main`. Steps:

1. Checkout
2. Setup Node 20 (with npm cache)
3. `npm ci`
4. `npm run build`
5. `npm test`
6. `npm run validate`
7. `npm run validate-schemas`
8. (On `main` only) Install Playwright Chromium
9. (On `main` only) `npm run test:e2e`

Any failure blocks the PR.

### `tauri` job

Runs on every PR and push to `main`. Steps:

1. Checkout
2. Restore Cargo cache
3. Install Linux system deps (webkit2gtk, etc.)
4. `cargo build` in `tauri-admin/`

Any failure blocks the PR.

### `deploy-pages` job

Runs only on `main` after `check` and `tauri` succeed. Deploys the PWA build
(`dist/`) to GitHub Pages. This job does not block PRs.

## Code review

A PR needs at least one approval from a maintainer to merge. Maintainers look
for:

- **Correctness** — does the code do what it claims?
- **Convention compliance** — see [Coding Conventions](coding-conventions.md).
- **Test coverage** — are the new code paths tested?
- **Surgical changes** — is the diff minimal? Could it be split into smaller
  PRs?
- **Anti-goal violations** — does the PR add React, Supabase, TTS, RAG, or any
  other anti-goal from the v2 plan? (If yes, reject and ask.)
- **Schema changes** — if the PR touches schemas, is the version bump
  justified? Is the migration path documented?
- **Security** — are secrets handled per [Security Model](../architecture/security-model.md)?
- **Performance** — does the PR add a blocking sync operation? A large
  dependency? A new render loop?

Reviews are async. Don't ping for review unless 48 hours have passed.

## Anti-goal violations — stop and ask

If your PR adds any of the following, **stop and ask in a GitHub Discussion
before opening the PR**:

- React/Vue/Svelte or any frontend framework
- Supabase, Postgres, or any backend other than Firebase
- Orgs/teams/multi-user tenancy beyond personal
- Public content registry
- Stripe or any payment integration
- Native mobile apps (React Native/Flutter)
- Auto-translation
- TTS audio
- RAG / embeddings / vector DB
- ML-based SR optimizer
- Custom domain management in the generator
- AWS/GCP/Azure deploy targets
- General-purpose chatbot (the AI tutor must be scoped to the current item)
- DRM on content packs
- Drag-and-drop site builder
- Real-time collaboration on content authoring
- Air-gapped self-hosting (V2 self-hosting = "bring your own Firebase project")

The full list is in
[the v2 plan §5](https://github.com/osler-app/osler/blob/main/v2-osler-plan-enhanced.md#5-anti-goals-cross-cutting).

## Release process

Releases are tagged from `main` after the V2 success metrics are met. The
process:

1. Create a release branch `release/v{x.y.z}`.
2. Bump version in `package.json`, `tauri-admin/Cargo.toml`,
   `tauri-admin/tauri.conf.json`, and `update-manifest.json`.
3. Update `PATCH_NOTES.md` with the changelog.
4. Open a PR from the release branch to `main`.
5. After merge, tag `v{x.y.z}` on `main` and push the tag.
6. CI builds the Tauri binaries and creates a GitHub Release.
7. The release notes (from `PATCH_NOTES.md`) are auto-attached to the release.
8. The admin dashboard's self-updater picks up the new release within 24 hours.

For V2, the first release will be `v2.0.0` after Phase 16 ships. See
[the v2 plan §9](https://github.com/osler-app/osler/blob/main/v2-osler-plan-enhanced.md#9-success-metrics)
for the ship criteria.

## Reporting bugs

Open a GitHub Issue with:

- Osler version (PWA: from `update-manifest.json` version; admin: from
  Settings → About)
- Browser + OS
- Steps to reproduce
- Expected vs. actual behavior
- Console logs (open DevTools → Console, copy any red errors)
- Screenshots if relevant

For security-sensitive bugs, do NOT open a public issue — see `SECURITY.md`
for the responsible disclosure process.

## Suggesting features

Open a GitHub Discussion in the "Ideas" category. Frame the suggestion as a
user story ("As a {persona}, I want {action} so that {outcome}"). Reference
the relevant phase in the v2 plan if applicable. Be prepared to discuss
whether the feature fits within V2's anti-goals.

## What's next

- [Coding Conventions](coding-conventions.md) — the rules every PR must follow.
- [Operations → CI/CD](../operations/ci-cd.md) — the CI pipeline in detail.
- [Migration → V1 to V2](../migration/v1-to-v2.md) — if you're migrating an
  existing V1 instance.
