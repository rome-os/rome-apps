# rome-apps migration validation (2026-10-25)

> Historical report: the results below describe the original migration at v0.1.1,
> not the current PR head. Later validation is recorded in
> [review corrections](2026-10-25-review-fixes.md) and
> [second-review follow-up](2026-10-25-review-followup.md). Preserve these original
> measurements rather than relabelling them as results from a newer build.

## Scope

Import the existing Diff app into `apps/diffview` without changing its app ID or
UI/API behavior. Runtime sources were compared recursively with the working
standalone source and match exactly. This includes the portable-worker OOM fix
and the default AST-cache setting that had just been confirmed to scroll
smoothly. The original checkout is retained as a rollback copy, not deleted.

Use a `feat/diffview` worktree; the primary rome-apps checkout stays on `main`.
Nothing was pushed, published, or submitted as a PR as part of this migration.

## Repository integration

- App and package version: `0.1.1`.
- Merge dependencies into the root pnpm lockfile; remove the app-local lockfile,
  workspace file, and package-manager override.
- Adapt the 58 unit/API/memory tests to Vitest so the root suite discovers them.
  Restore HOME/profile values after the sandboxed API/memory suites.
- Keep the production Worker browser suite opt-in as `*.browser.mjs` via
  `pnpm --filter @rome/app-diffview test:worker`.
- Add the README app entry, development instructions, and manual publish choice.

## Results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| App TypeScript check | PASS |
| App Vitest suite | 8 files, 58 tests PASS |
| Repository-wide TypeScript checks | All packages PASS |
| Repository-wide Vitest suite | 36 files, 256 tests PASS |
| Built production bundle Worker suite | Standalone and sidebar iframe, 2 tests PASS |
| Install from the new worktree app directory | PASS, existing `diffview` ID at `0.1.1` |
| Live app catalog source path | Points to the new worktree's `apps/diffview` |
| Installed synthetic-diff worker check | 2 active workers, initialization/highlight replies, zero reflected errors |
| Soft navigation away from installed app | Active workers drop from 2 to 0 |
| Repeated installed iframe loads | Two successive mounts PASS, zero console/page errors |

## Installed data/UI verification

An independent disposable Git repository was created under the projects root
and removed in a `finally` cleanup. No existing user repository was edited.
The installed app's real API returned 37 uncommitted files, 1 staged file,
36 unstaged files, 1 branch-comparison file, and 37 files for a two-dot custom
comparison. Single-file patch data included the expected new content.

The installed full-mode UI rendered those real API results. Unified/split
roundtrip, light/dark rendering, a 447x660 iframe, and scrolling were exercised.
After changing one fixture file, the visible diff received the fresh contents
and the scroll position stayed at 850px instead of resetting. Console and page
errors: zero. Git status/index state was unchanged by application use.

The Worker/OOM regression remains covered by the production bundle tests, not
by console filtering. This controlled validation is not a long-duration memory
soak or a new real-remote-PR test; no claim is made that those were performed.
