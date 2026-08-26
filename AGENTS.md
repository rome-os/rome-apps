# AGENTS.md

Guidelines for AI agents working in this repository.

## Overview

This is a pnpm monorepo of **Rome OS apps**. Each app under `apps/` is an independent workspace package that contributes actions, agents, skills, web UIs, APIs, and/or DB schemas to the Rome platform.

- **Language**: TypeScript (ESM)
- **Node**: >=24.11.1 (`.nvmrc`)
- **Package Manager**: pnpm >=10.33.2
- **Testing**: Vitest
- **CI**: GitHub Actions — typecheck + test on push to `main` and all PRs

For the full app development API (app.yaml fields, action patterns, web UI contract, DB/migration model, shadcn/Tailwind setup), read the **app_creation** skill. For lifecycle operations (install, uninstall, enable/disable), read the **app_management** action description.

## Repository Layout

```
rome-apps/
├── apps/                        # All app packages
│   ├── brainstorm/              # Guided product brainstorming agent
│   ├── code-review/             # GitHub PR reviewer (full-stack: DB + API + Web)
│   ├── company-research/        # Company analysis (full-stack)
│   ├── discord-digest/          # Scheduled Discord summaries
│   ├── facebook/                # Facebook scraping
│   ├── learning/                # Learning / vocabulary actions
│   ├── linkedin/                # LinkedIn browser automation
│   ├── memory/                  # Memory & relationship skills
│   ├── news/                    # News ingestion (full-stack)
│   ├── reddit/                  # Reddit radar dashboard (full-stack)
│   ├── rome-table/              # Rome database browser
│   ├── seo/                     # SEO/GEO skill library + actions
│   ├── stock-daily/             # Daily stock-market reports
│   ├── summary/                 # Work summary generator (full-stack)
│   ├── survey/                  # AI-native survey builder
│   ├── utility/                 # Apache-licensed utility skills (6 skills)
│   ├── x-manager/               # X account and content management
│   └── xiaohongshu/             # Xiaohongshu browser automation
├── packages/                    # Shared packages (reserved, currently empty)
├── package.json                 # Root workspace config
├── pnpm-workspace.yaml          # workspaces: apps/*, packages/*
├── .nvmrc                       # Node version pin
└── .github/workflows/
    ├── ci.yml                   # typecheck + test
    ├── rome-publish.yml          # Manual single-app publish (dropdown)
    ├── rome-publish-changed.yml  # Auto-publish apps changed in a commit
    └── rome-publish-stale.yml    # Publish apps whose version isn't live yet
```

---

## Branching Strategy (Git Worktree)

This repository uses **git worktree** to keep the main checkout always on the `main` branch while doing feature work in isolated directories.

### Rules

1. **The main checkout stays on `main`** — never switch branches in the primary repo directory.
2. **Before starting new work**, pull `main` to the latest commit first.
3. **Create a worktree** for every feature / iteration — this gives you a separate directory and branch in one step.
4. **After publish is complete**, remove the worktree and its directory, then update the main checkout to `main` latest.

### Workflow

```bash
# 0. Ensure main is up to date (run in the main repo directory)
cd /path/to/rome-apps
git checkout main
git pull origin main

# 1. Create a worktree + feature branch (from the repo root)
git worktree add ../rome-apps-<feature> -b <feature-branch>
#   e.g. git worktree add ../rome-apps-fix-login -b fix/login-bug

# 2. Work inside the worktree directory
cd ../rome-apps-<feature>
pnpm install          # first time in the worktree
# ... code, build, apply, test, bump version, create PR ...

# 3. After PR is merged & publish is done, clean up
cd /path/to/rome-apps
git worktree remove ../rome-apps-<feature>   # removes worktree + directory
git branch -d <feature-branch>               # delete the local branch
git pull origin main                         # update main to latest
```

> **Tip**: `git worktree list` shows all active worktrees. Always clean up finished worktrees to avoid confusion.

---

## Dev Workflow

> **Goal**: code a change, verify it works locally against the running Rome daemon, then open a PR for review.

### Steps

```
pull main -> create worktree -> code -> build -> install -> test/verify -> bump version -> create PR -> STOP (ask human to review)
```

#### 0. Set Up Worktree

Before writing any code, make sure the main checkout is on the latest `main`, then create a worktree (see [Branching Strategy](#branching-strategy-git-worktree) above). All subsequent steps happen inside the worktree directory.

#### 1. Code

Edit source files under `apps/<appId>/src/` (or `apps/<appId>/actions/` for simple apps without `src/`).

- Follow existing patterns in the same app before inventing new ones.
- Do not introduce cross-app runtime imports. Import only: files inside the same app, Node builtins, declared deps, `@rome-os/app-runtime`, `@rome-os/app-web-sdk`.

#### 2. Build

From the app directory:

```sh
cd apps/<appId>
pnpm install          # if deps changed or first time
pnpm build            # alias for `rome build` — compiles src/ -> dist/
```

`pnpm build` must succeed with no errors. The daemon reads from `dist/`, not `src/`.

Also run typecheck to catch issues early:

```sh
tsc --noEmit
```

#### 3. Install

Build, pack, and hot-swap the app into the running daemon:

```jsonc
// app_management action
{ "op": "install", "source": { "mode": "source", "path": "<absolute-path-to-app-dir>" } }
```

The daemon runs the workspace's own `pnpm install` + `pnpm build`, packs the result into `<app-root>/.rome/artifact`, then installs (or re-installs) the app, runs any pending DB migrations, and makes the new code live immediately. Every install rebuilds and repacks, so re-running the same call after edits ships YAML, migration, backend, or frontend changes through one call.

#### 4. Test / Verify

After `install` succeeds, use the browser to open the Rome platform and verify the change:

- **Web UI apps**: navigate to `/apps/<appId>` in the browser. Confirm the page loads without errors, the layout renders correctly, and interactive features (buttons, forms, data loading) work as expected.
- **Actions / APIs**: invoke the action or hit the API endpoint, then check results are correct. If the action has a UI surface, verify it in the browser as well.
- **Run the test suite** if tests exist: `pnpm test -- apps/<appId>/`

#### 5. Bump Version

Update the `version` field in `apps/<appId>/app.yaml`. Follow semver:

- **patch** (0.1.1 -> 0.1.2): bug fixes, minor tweaks
- **minor** (0.1.2 -> 0.2.0): new features, new actions
- **major** (0.2.0 -> 1.0.0): breaking changes

#### 6. Create PR

Commit all changes and open a pull request. **Stop here** — do not merge. Ask the human to review.

---

## Publish Workflow

> **Goal**: after PR is merged to `main`, publish the app to the Rome app store and verify the published version works.

### Steps

```
merge PR -> trigger rome store deploy -> update app to app store version -> test/verify again -> clean up worktree
```

#### 1. Merge PR

Human merges the reviewed PR into `main`.

#### 2. Trigger Rome Store Deploy

Publishing happens via GitHub Actions. There are three workflows:

| Workflow | Trigger | Use Case |
|----------|---------|----------|
| `rome-publish.yml` | Manual (`workflow_dispatch`) — pick app from dropdown | Publish a specific app on demand |
| `rome-publish-changed.yml` | Manual — optionally specify a commit SHA | Auto-detect and publish all apps changed in a commit |
| `rome-publish-stale.yml` | Manual | Publish any app whose `app.yaml` version is not yet live in the store |

All workflows run: `pnpm install` -> `pnpm build` (for the app) -> `pnpm exec rome publish "apps/<appId>"`.

**Required secrets**: `ROME_TOKEN`, `ROME_STORE_HOST`.

Each workflow supports a `dry_run` option (package and hash but don't upload) for safety.

#### 3. Update App to App Store Version

After the GitHub Action publishes successfully, switch the local running instance from the workspace dev copy to the published app store version.

First, look up the published version's `contentHash` from the store API:

```
GET https://romeos.cc/api/store/listings/<appId>
```

The response contains a `versions` array. Find the entry matching the version you just published (the version bumped in the PR). Extract its `contentHash`.

Then install the app store version:

```jsonc
// app_management action
{
  "op": "install",
  "appId": "<appId>",
  "source": {
    "mode": "appstore",
    "listingId": "<appId>",       // same as the app id
    "version": "<version>",       // the version from app.yaml (bumped in the PR)
    "contentHash": "<contentHash>" // from the store API response
  }
}
```

This ensures the running daemon uses the exact artifact that was published, not the local dev build.

#### 4. Test / Verify Again

After installing the app store version, use the browser to open the Rome platform and re-verify:

- Navigate to `/apps/<appId>` and confirm the UI loads and functions correctly.
- Exercise the same actions / API routes tested during dev to ensure the published artifact behaves identically.
- Run the test suite if applicable: `pnpm test -- apps/<appId>/`

#### 5. Clean Up Worktree

After verification passes, remove the worktree, delete the feature branch, and pull `main` to latest:

```bash
cd /path/to/rome-apps
git worktree remove ../rome-apps-<feature>
git branch -d <feature-branch>
git pull origin main
```

This returns the repo to a clean state, ready for the next task.

---

## Quick Reference: Common Commands

```bash
# Install all deps
pnpm install

# Build all apps
pnpm build

# Build single app
pnpm --filter "./apps/<appId>" run build

# Typecheck all
pnpm typecheck

# Run all tests
pnpm test

# Run tests for one app
pnpm test -- apps/<appId>/

# Generate DB migrations (full-stack apps)
cd apps/<appId> && pnpm db:generate

# Local publish (from repo root)
pnpm exec rome publish "apps/<appId>"

# Dry-run publish (verify without uploading)
pnpm exec rome publish "apps/<appId>" --dry-run

# --- Git Worktree ---

# Create a worktree with a new feature branch
git worktree add ../rome-apps-<feature> -b <feature-branch>

# List all worktrees
git worktree list

# Remove a worktree after work is done
git worktree remove ../rome-apps-<feature>
```

## CI Checks

Every push to `main` and every PR runs:

1. **typecheck** — `pnpm typecheck` (tsc --noEmit across all apps)
2. **test** — `pnpm test` (vitest run)

Both must pass before merging.
