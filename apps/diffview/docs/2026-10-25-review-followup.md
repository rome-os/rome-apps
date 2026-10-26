# Second automated-review follow-up

Review baseline: `4e2063b`; six advisory findings and two correctness blockers.
The earlier review corrections remain in place. This follow-up preserves all
subsequent local scope/menu refinements.

## Machine-readable Git output and conflicts

Snapshot/page and expanded single-file diff commands explicitly request
`--src-prefix=a/ --dst-prefix=b/`. Repository/global `diff.noprefix` or
`diff.mnemonicprefix` can no longer change the machine-parsed header contract.

Unmerged paths come from porcelain-v2 status, independently of patch parsing.
All three local scopes (all/staged/unstaged) retain an explicit `U`, conflicted,
collapsed placeholder. The UI says the merge conflict must be resolved in the
working tree, and disables unsupported full-content/context expansion. The API
returns `409 unmerged_conflict` for an explicit patch request. A conflict is
never misrepresented as no changes, and combined hunks are not fed to a two-way
parser. No index/merge state is modified.

## Comparison identity and caches

Pure commit-side comparisons do not run `git status`. Their versions depend on
resolved endpoints/arguments and fallback diff content, not dirty files,
untracked files, index changes or an unrelated local checkout HEAD. Working-tree
comparisons still include the working-state fingerprint. The returned head for
immutable views follows the compared target (or fallback content version).

A cache request with TTL <= 0 retains single-flight but skips serialization,
byte accounting and result retention. Status results cannot displace repository
metadata while being ineligible for a cache hit.

## Authoritative PR repository and temporary refs

`gh pr view` resolves the canonical PR URL; `gh api` reads the base branch and
both commit OIDs from that repository's REST PR resource. This also supports old
GitHub CLI releases (including 2.23) without a `pr view --json baseRefOid` field.
Fetch uses that PR repository's HTTPS Git URL, **not origin**, and verifies both
fetched OIDs against the metadata. A repository/ref race or fetch failure falls
back to the authoritative `gh pr diff` output rather than combining endpoints
from different repositories. Normal Git/gh credential helpers are used without
reading or managing authentication material.

Fetch writes an atomic pair of refs in a unique timestamp/UUID namespace under
`refs/diffview/tmp/`; those refs are compare-and-deleted in a finally block after
resolving their immutable OIDs. User branches, remote-tracking refs and FETCH_HEAD
remain unchanged. Legacy `refs/diffview/pr/` / `refs/diffview/pulls/` refs and temp
refs older than one hour are retired on a bounded-frequency cleanup; recent
active namespaces are not touched. Git operations disable auto-gc/maintenance,
and fetch also passes `--no-auto-maintenance` explicitly. Fetch necessarily
adds Git objects; the app is not a zero-write filesystem snapshot service.

## Portable reads and viewed storage

Safe file reads always compare descriptor type/dev/inode against the pre-open
stat and re-resolve the verified pathname after opening. Linux procfs adds a
second descriptor-location check. If procfs is absent (ENOENT/ENOTDIR), the
portable identity/path checks remain mandatory; unexpected errors or an
out-of-root descriptor still fail closed. Tests simulate absent procfs and
identity/location substitutions. This is not a claim of a live macOS/Windows test.

Viewed marks retain at most 32 comparison keys and 256 KiB of key/value UTF-16,
with a 32 KiB / 2,000-mark per-view cap. A small LRU index preserves recently used
views. Existing viewed keys are migrated/pruned on access, quota recovery removes
only owned `diffview:viewed:*` keys, and storage denial stays best-effort. No other
origin storage values are read or removed. Encoding is linear in marks processed,
not repeated serialization of shrinking arrays.

## Validation commands

```sh
pnpm typecheck
pnpm test --maxWorkers=2
pnpm --filter @rome/app-diffview test:browser
```

The normal suite covers configured prefixes in snapshot/paged/expanded paths,
unresolved merges in all local scopes with unchanged status/index, dirty/index
independence, no worktree-status call for immutable comparisons, fork repositories
with different same-number PRs, metadata/ref races, ref cleanup and maintenance
configuration. It also covers zero-TTL cyclic results (proving no serialization),
procfs-free safety checks, viewed LRU/byte limits/migration/quota handling.

The additional production browser test exercises both prefix configurations
against an unresolved merge plus an ordinary modified file, checks visible
conflict text and disabled unsupported actions, verifies the ordinary patch, and
asserts no Git index/status changes or console/page errors. Existing production
worker, scroll and menu tests remain required. Final installed version/head,
test counts and runtime evidence are recorded in the updated PR body and the
local validation artifact; the migration document remains explicitly historical.
