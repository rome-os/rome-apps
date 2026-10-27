# Linked Branch and Pull Request context (0.4.9)

## Decision

The Branch and Pull Request rows describe the same reviewed work. Exactly one side drives the context;
the other is a passive label. Following never changes comparison mode or writes another URL field.

| Active comparison                     | Driver           | Branch row                                    | Pull Request row                                   |
| ------------------------------------- | ---------------- | --------------------------------------------- | -------------------------------------------------- |
| Uncommitted: all, staged, or unstaged | Current worktree | Checked-out branch                            | Most recent associated PR, including merged/closed |
| Unpushed                              | Current worktree | Checked-out branch                            | Most recent associated PR, including merged/closed |
| Branch/ref to worktree or HEAD        | Branch           | Checked-out target branch, never the base ref | Most recent associated PR, including merged/closed |
| Pull Request                          | Selected PR      | Exact PR head branch                          | Selected PR number                                 |
| Commit                                | Neither          | Generic Branch row                            | Generic Pull Request row                           |

Examples:

- `origin/main ... worktree` on `feat/diffview` shows `Branch · feat/diffview`; `origin/main`
  remains the base inside the Branch pane.
- Selecting PR #18 with head `refactor/code-review-ui-library` shows that head in Branch and `#18`
  in Pull Request.
- A stale `pr=18` hash parameter while `mode=ref` is ignored; the checked-out branch remains authoritative.

## Data contract

`GET revisions` is Git-only and supplies local branches, tags and commits without waiting for GitHub. The independent
`GET refs` request carries at most 50 open PR summaries and one exact current-branch association. The latter uses a
bounded `--head <branch> --state all --limit 50` lookup only when the open list has no valid same-repository match,
so a merged PR can still follow its branch without making the picker an unbounded history. Both paths reject
same-named fork heads and choose the most recently updated matching PR. The client loads one repository-level PR
DTO rather than requesting data per menu row; a slow or failed GitHub request never blocks the local ref picker.
An explicit PR comparison also carries the exact resolved PR number, base branch and head branch in the files DTO.
This keeps PR-to-branch following correct even when the selected PR is absent from the bounded list or Git falls
back to GitHub's patch.

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
