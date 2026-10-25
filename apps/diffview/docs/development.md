# Developing Diff in rome-apps

The canonical source is `apps/diffview/` in this repository. Keep the primary
checkout on `main` and use a feature worktree per the root `AGENTS.md`.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @rome/app-diffview typecheck
pnpm --filter @rome/app-diffview test
pnpm --filter @rome/app-diffview build
```

The app's unit/API/memory tests use Vitest and are also discovered by the
repository-wide `pnpm test`. They create disposable Git fixtures and do not
require a running Rome instance. `pnpm typecheck` includes the app too.

## Worker/OOM regression

```sh
pnpm --filter @rome/app-diffview exec playwright install chromium
pnpm --filter @rome/app-diffview test:worker
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chrome
binary. The browser regression is deliberately opt-in (`*.browser.mjs`): it
builds and loads the production bundle, checks standalone/iframe mounts and
repeated cleanup, and guards against the worker-entry error feedback loop.
Ordinary repository tests do not launch Chrome or require build output.
See [the incident report](2026-10-25-worker-error-loop.md) for the root cause.

## Local installation

Use Rome's `system:app_management` action, with the absolute app directory in
the feature worktree, not the repository root:

```json
{
  "op": "install",
  "source": {
    "mode": "source",
    "path": "/absolute/path/to/rome-apps-worktree/apps/diffview"
  }
}
```

This rebuilds and installs the existing `diffview` app ID; it does not create a
second app or reset viewed/preferences state. Reuse this source path for later
installs. Keep the worktree until the local installation is switched to another
permanent source or a published release. Never edit the app lockfile directly.

Validate `/apps/diffview` and the chat-sidebar `/full/apps/diffview` surface.
Check actual repository data, scrolling, comparison selection, theme/language,
and worker teardown. The `?p0=1` route provides synthetic diffs without API data
for controlled worker checks. Existing old tabs from before the worker-entry
fix require a full page reload.

Migration from the original standalone checkout preserves the source tree,
including the portable worker entry and the default (100-entry) AST cache
setting that was validated after the OOM fix. The old standalone source can be
kept as a rollback copy; it is no longer the authoring source after installation
from this repository.

Publishing is separate from installation. The manual publish workflow includes
`diffview`, but migration does not push, open a PR, or publish anything.

## Conversation scroll persistence

`pnpm --filter @rome/app-diffview test:scroll` builds and tests conversation-
scoped reading positions, including reload, close, context switching and lazy
file anchors. It uses the same browser executable option as `test:worker`.
See [scroll memory](2026-10-25-scroll-memory.md) for scope and storage behavior.

## Scope menu regression

`pnpm --filter @rome/app-diffview test:menu` builds and loads the production UI
**and API** against disposable Git fixtures. It tests 360/447/1100px layouts
(including a real iframe), flat ordering, staged/unstaged/unpushed semantics,
commit pagination/root selection/reload, branch-only endpoint controls, keyboard
selection, missing upstream and unchanged Git index. It uses the same browser
executable override as `test:worker`; ordinary scopes never query GitHub.
See [scope menu](2026-10-25-scope-menu.md) for comparison definitions.

## Review correctness regressions

`pnpm --filter @rome/app-diffview test:browser` builds once and runs all three
production browser suites (worker, scroll and menu). Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` only when using an existing browser.
`review.test.ts` and `cache.test.ts` run in the normal Vitest suite; they require
no real GitHub account. See [review corrections](2026-10-25-review-fixes.md) for
comparison identity, PR refresh, cache budgets and safe file-link behavior.

The browser aggregate also runs `git-output.browser.mjs`: configured Git prefixes,
visible unresolved conflicts, ordinary diff rendering and read-only merge/index
checks. See [second-review follow-up](2026-10-25-review-followup.md).
