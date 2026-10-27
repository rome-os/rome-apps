# Unified comparison menu (0.4.5)

## Change

The toolbar now has one comparison trigger. The former branch/revision pill is
removed, and repository/comparison triggers no longer display decorative down
arrows. The trigger label is the most specific active identity: a PR number,
the selected branch/ref, a selected commit description, or the local scope.

Branch and Pull Request are explicit root rows. Both replace the current popup
contents in place, with a Back row, rather than opening beside the menu or in a
second dropdown. Branch contains base/ref and commit drill-downs plus target and
comparison-method controls. Pull Request lazily loads the PR list only after the
guardian enters its pane. The old overflow action is removed.

The trigger uses backend `totals.all`, so supporting lines never disappear from
the toolbar number. Detailed primary, supporting and all totals remain visible
at the bottom of the root menu; placing them after the choices keeps async or
changing counts from moving the comparison rows.
Each added/deleted counter reserves at least `2ch`. When the comparison changes,
the previous toolbar counters remain for at most three seconds while the next
result loads; a ready result replaces them immediately. This prevents the pill
from repeatedly shrinking and growing without leaving stale counts indefinitely.
The Branch/PR row names remain foreground text while their selected ref or PR
number uses muted text. The summary keeps an accessible name but omits a
redundant visible heading.
For the default remote branch, menu chrome presents the human branch name
(`main`) instead of the implementation ref (`origin/main`): the root row reads
`Branch · main` and the branch pane reads `Compare to main`. The exact ref is
still retained for Git operations and in the comparison trigger.

## Compatibility

Existing `mode`, `base`, `ref`, `target`, `dots`, `commit` and `pr` URL state is
unchanged. Entering Branch from a local scope still initializes the repository
default branch to Working tree with merge-base comparison. Existing branch and
commit choices are preserved when reopening their panes.

## Verification

The production browser regression covers 360px standalone, 447px iframe and
1100px standalone layouts; label priority; all-change totals; bottom summary
placement; in-place Branch/PR/commit navigation; keyboard selection; lazy PR
loading; and absence of the old trigger/action. Typecheck, unit tests, production
build, source installation and installed-runtime browser checks are required for
delivery.

## PR endpoint fidelity

PR comparison fetches the exact base and head object IDs returned by GitHub's
PR API into temporary refs. It does not substitute the current base branch: an
open PR may legitimately retain an older base SHA after that branch advances.
Only an inability to fetch the exact objects falls back to patch-only
`gh pr diff`, which cannot support expanded context or complete-file loading.
