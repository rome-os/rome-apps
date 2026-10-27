# Linked Branch and Pull Request context (0.4.9)

## Decision

The Branch and Pull Request rows describe the same reviewed work. Exactly one side drives the context;
the other is a passive label. Following never changes comparison mode or writes another URL field.

| Active comparison                     | Driver           | Branch row                                    | Pull Request row                                   |
| ------------------------------------- | ---------------- | --------------------------------------------- | -------------------------------------------------- |
| Uncommitted: all, staged, or unstaged | Current worktree | Checked-out branch                            | Most recent associated PR, including merged/closed |
| Unpushed                              | Current worktree | Checked-out branch                            | Most recent associated PR, including merged/closed |
| Branch/ref to worktree or HEAD        | Branch           | Checked-out target branch, never the base ref | Most recent associated PR, including merged/closed |
| Pull Request                          | Selected PR      | Explicit `PR head:` label and exact branch     | Selected PR number                                 |
| Commit                                | Neither          | Generic Branch row                            | Generic Pull Request row                           |

Examples:

- `origin/main ... worktree` on `feat/diffview` shows `Branch · feat/diffview`; `origin/main`
  remains the base inside the Branch pane.
- Selecting PR #18 with head `refactor/code-review-ui-library` shows `PR head: <head>` in Branch and `#18`
  in Pull Request.
- A stale `pr=18` hash parameter while `mode=ref` is ignored; the checked-out branch remains authoritative.

## Data contract

`GET revisions` is Git-only and supplies local branches, tags and commits without waiting for GitHub. The independent
`GET refs` request carries at most 50 open PR summaries and one exact current-branch association. The latter uses a
bounded `--head <branch> --state all --limit 50` lookup only when the open list has no valid same-repository match,
so a merged PR can still follow its branch without making the picker an unbounded history. Both paths compare
the head repository’s canonical GitHub node ID to the checkout branch’s tracking remote (or origin for an
untracked branch), fail closed for unknown identity, and choose the most recently updated matching PR.
The client loads one repository-level PR DTO rather than requesting data per menu row; a slow or failed GitHub request never blocks the local ref picker.
An explicit PR comparison also carries the exact resolved PR number, base branch and head branch in the files DTO.
This keeps PR-to-branch following correct even when the selected PR is absent from the bounded list or Git falls
back to GitHub's patch.

Checkout labels now use the Git-only tracking snapshot (including unborn and no-upstream branches),
not the separately cached repository scan. A branch change keys a new PR request and bypasses the old
branch's server cache; detached HEAD has its own empty-branch key. Each PR DTO identifies the checkout
it sampled, so a switch during a slow GitHub request cannot apply another branch's repository identity.
PR requests no longer enumerate local branches, tags or commits; only the independent revisions request
performs that work. Passive PR context polls every five minutes in local views, and every minute
in PR mode or while the comparison menu is open. Opening the menu refreshes stale PR context
immediately; checkout changes still request the new context without waiting for either interval.

Tracking remotes may be named remotes or literal URLs, including fork URLs stored by `gh pr checkout`.
Push-remote preferences do not replace the tracking identity. An observed matching open PR invalidates
the older historical cache entry (including a miss), so its subsequent merge/closure is resolved afresh.

Checkout identity comes from the full symbolic HEAD ref with exactly `refs/heads/` removed,
so a same-named tag cannot change the branch name or disable upstream tracking. If the tracking
request fails, the independent PR request still runs and retains its own error/retry path;
passive labels do not infer checkout identity from that fallback response. The revisions DTO
contains only branches, tags and commits, never placeholder PR state.

## Interaction constraints

- Following is display-only: it cannot create a Branch/PR effect loop.
- Selecting Branch does not silently select a PR comparison; selecting PR does not turn into ref mode.
- All local filters retain the worktree branch and matching PR labels.
- Explicit fork PRs remain reviewable, while passive branch association requires the PR head to be this repository.
- The comparison base is edited independently in the Branch pane.
- Detached/commit states do not guess ancestry-based branch names.
- Horizontal comparison choices are menu-native radio items so keyboard focus can reach every segment.

## Regression coverage

Unit tests exercise every row of the state table, stale URL state, newest matching PR selection, exact PR metadata
outside the bounded list, detached HEAD, and branch names containing `origin/`. The production browser regression
checks local → ref → commit → PR #18 → local transitions at 360px, 447px iframe, and 1100px, including an exact
merged/closed branch association outside the bounded open list and exact PR-head linkage.

Regression coverage also checks branch switches within the PR-cache TTL, detached HEAD, the absence
of local listing commands during PR polling, and live linked-label changes while the repository scan is
stale and GitHub is delayed. Production browser coverage retains the local-picker failure isolation,
keyboard-only activation, and narrow/iframe layouts.
Branch/tag collisions cover ordinary and `heads/`-prefixed branch names, Unpushed files and
canonical PR association. A production browser regression exhausts tracking and PR retries,
then recovers the PR picker through its retry action without inventing passive branch labels.

Regressions also cover URL-valued tracking remotes, fail-closed local/unknown remotes,
miss → open → merged and old-history → open → closed transitions within the historical TTL,
and production-browser polling frequency for passive, menu-open and PR-mode views.

Validation uses Diffview `pnpm typecheck`, `pnpm test`, and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome pnpm test:browser`.
