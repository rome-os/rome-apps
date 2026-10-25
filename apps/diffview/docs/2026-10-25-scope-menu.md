# Flat scope menu and local commit review

## Requested behavior

Order: Unpushed, Uncommitted, Staged, Unstaged; separator; Branch (plain action).
Clicking Branch only reveals the secondary selector and opens no popup. Committed
is an entry inside that secondary selector, with in-place commit history. Do not implement Last turn yet. Only Branch has the
contextual revision selector (base → target, or selected commit) next to the scope/totals pill.

All primary labels share the same left inset. Selected indicators use the shared
right inset; the unpushed ahead count sits immediately beside its label.
The secondary selector uses the same text inset for Base, Committed, section labels
and radio choices, with drill arrows in the radio-check column. Committed mode
keeps its additional selected check beside the arrow, never before its label.

## Comparison rules

- **Unpushed** uses locally recorded tracking upstream, not the default/main branch.
  It computes the merge base with upstream and shows that tree → local HEAD. Dirty
  files, staged content and untracked files are excluded. Ahead/behind counts use
  reachability; no fetch runs. On divergence this is the local side, not the remote
  side's additions/deletions. Ahead commits can have zero net file changes; the empty
  state distinguishes that from having no ahead commits.
- **Committed** is one chosen commit versus its first parent. An initial commit
  compares with the empty tree (hash derived for the repository's object format).
  Merge commits compare with their first parent. The local history is reachable
  from HEAD, 40 records per page; search is explicitly limited to the loaded page,
  and typing a commit/ref expression plus Enter can select a commit outside it.
- **Branch** preserves existing base/ref, working-tree-or-HEAD and merge-base-or-two-dot
  semantics. Long ref names truncate in chrome and are present in tooltips. The
  endpoint pill goes on a second row in the narrow chat sidebar.
- **PR** remains supported via review options and legacy links, but is not a normal
  root-menu item. Local revision/history/tracking APIs do not invoke GitHub.

## Implementation boundaries

`ComparisonMenu.tsx` owns popup navigation; no adjacent Radix submenus. Existing
rendering, paging, portable workers and scroll-memory infrastructure are reused.
`commit` and `unpushed` are explicit comparison identities and conversation modes;
commit selection persists separately from branch base selection. Old branch/PR URLs
retain their meaning. New APIs retain the guardian-only, GET-only, project-root
allowlist gates. They never stage, switch branch, commit, fetch or manage credentials.

Fingerprints include resolved ref/upstream identities for new modes and custom-ref
comparisons, so updating a ref without editing HEAD/worktree invalidates conditional
refresh. A rejected view-cache accounting observer is caught to avoid an unhandled
promise rejection when an unavailable upstream or invalid ref is requested.

## Verification

- Unit/API tests cover tracking states, ahead/behind/divergence, staged/unstaged and
  untracked exclusion, first-parent merges, roots, paginated history, invalid refs,
  persistence identities, fingerprint refresh and unchanged Git index.
- Production UI + production API browser regression: 360px and 1100px standalone,
  447px real iframe, exact menu order, no Last turn entry, each local scope, history
  paging, root selection/reload, branch-only pill, target/method controls, keyboard
  choice, missing-upstream disabled explanation, no GitHub requests and no errors.
- Run existing worker and per-conversation scroll regressions after changing the toolbar.

Last turn is deliberately absent rather than a fake comparison against HEAD. An
accurate implementation requires durable, reliable turn-boundary filesystem snapshots.
