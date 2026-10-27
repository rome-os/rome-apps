# Diff design contract

Mode: Operate. Fixed world: Rome tokens and @rome-os/ui; pinned composition: Codex Changes pane.

- One compact toolbar: repo chip, comparison + all-totals pill, quiet icon cluster and overflow. Repository
  and comparison triggers omit decorative down arrows; comparison details live inside one popup rather than
  consuming another toolbar pill.
- Diff stream leads; right file tree is narrow, resizable and compresses single-child folders. Mobile uses a right drawer.
- Sticky 44px file headers, muted directory / emphasized basename, count colors from success/destructive tokens, viewed/copy/menu actions.
- 26px code rows, 3px categorical change rail, token-derived line and word tints. No added chrome border around diffs.
- Rounded muted context bars expand bounded patch context by 20 lines; never ask Pierre to hydrate partial patches without a loader.
- Per-file nested shadows carry a small renderer stylesheet; outer app stylesheet remains the SDK import. Popup portals stay in the outer app shadow root.
- Global html language and theme remain sole source; no app-specific language or theme switch.

## Delivery contract: the server cuts DTOs, the client never fans out

- The browser must not fetch many records one by one or in parallel. The server computes the
  data, crops it to the per-file caps, and delivers it in **pages** of the files that carry a text
  diff (`src/shared/paging.ts`). A cursor is an index into that sequence.
- `GET files` returns the whole file list plus the **first page**; `GET patches?cursor=N&q=…&fp=…`
  returns the page starting at _any_ cursor, over the sequence filtered by `q` (the same substring
  filter as the file tree). Jumping or filtering therefore costs one request, not a walk through
  earlier pages.
- The client keeps **at most one request in flight** and fetches **on demand around the focused
  file** (`PAGE_LOOKAHEAD` pageable files ahead). It never loads ahead of what the guardian can see.
- Mode is chosen by size, not by failure: `git status` already counts the changed paths, so a
  comparison with more than `maxWholeDiffFiles` changed files (or whose diff exceeds the byte cap)
  is paged from the start. Each page is one `git diff -- <the page's paths>`; there is **no
  per-file fallback** for bulk loading.
- `GET patch` (one file) exists only for explicit guardian actions: loading a collapsed/large file,
  "load full file", or expanding more context for one file.
- Refreshes are conditional (`have=<fingerprint>` answers with a tiny `unchanged`) and polling
  backs off in proportion to the server's reported `ms`.

### Why path-limited pages (measured, 20,000 changed files, 45 MB of patch)

| way to get a page                                    | cost                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| whole `git diff -p`                                  | 2.7 s                                                      |
| `git diff --skip-to=<path>`, read until enough, kill | ~0.75 s per page (git first builds the whole change queue) |
| `git diff -- <the page's 150 paths>`                 | ~0.13 s per page (~0.04 s for a directory prefix)          |

`git diff` has no offset/limit and `--pathspec-from-file` is not supported by it; `--skip-to`,
pathspecs, `--diff-filter` and `--no-renames` are the available knobs. Page and file requests carry
the list's fingerprint (`fp`) so they are answered from memory; responses carry `Server-Timing`
(`app`, `git`, `cache`). A page should cost 0–3 git processes whatever its size.

## File header lines

A file header has a 1px line on top and, when code follows, one underneath. The bottom line is drawn
as a 1px `box-shadow` below the header's box (on the next element's first pixel row), not as a
border. Sticky headers are pushed up glued to the next file's header; a bottom border plus the next
header's top border would add up to a 2px rule there, whereas the shadow lands on the same row as
that top border and the two coincide. Both use one opaque colour (`HEADER_LINE`, a mix of
`--border` and `--app-canvas`) so overlapping lines do not darken.

## What can be compared, and how the trigger reads

The scope menu starts in this order: **Unpushed**, **Uncommitted**, **Staged**,
**Unstaged**, separator, **Branch · review branch**, **Pull Request · #number**. Branch and Pull Request
drill down in place inside the same popup; there is no adjacent revision trigger or overflow-menu PR action. There is no "Local changes /
Include" layer and no "Last turn" placeholder: accurate turn snapshots are a separate
platform capability. Uncommitted is the aggregate, not a disjoint peer of Staged/Unstaged.

Branch and Pull Request are two views of one review context, not two unrelated persisted choices.
For local and ref comparisons the checked-out branch drives the context and its most recent associated PR
(open, merged, or closed) follows passively; merged/closed associations include their state in the row.
For a PR comparison the exact selected PR drives the context and Branch follows its head branch with an
explicit **PR head** prefix (selecting Branch still switches to the local worktree). A commit comparison is
intentionally neutral because a detached object does not identify one review branch. The comparison base remains a separate Branch-pane field and is never shown as
the review branch. Stale inactive URL fields do not override the active mode. Local branches/tags/commits load from
the Git-only `revisions` DTO and never wait for GitHub. The bounded open-PR list and one exact current-branch
association load independently at repository scope; resolving an explicit PR also returns its exact base/head
metadata, including when it is outside that list. Passive association requires both the branch name and the same
head repository, and chooses the most recently updated match through one shared matcher. The checkout identity is
resolved from its tracking remote (origin when untracked) to a canonical GitHub node ID; never use the PR’s
head-versus-base `isCrossRepository` flag for this. Unknown identities do not link passively. Identity resolution
and per-branch historical hits/misses are bounded-cache entries with a five-minute TTL; fresh open-list matches win.

- Unpushed = the current branch's merge base with its tracking upstream → HEAD, excluding
  dirty/index/untracked files. Never substitute the default branch and never fetch automatically.
  The menu shows `↑N`. No upstream, detached HEAD, unborn HEAD and a missing upstream ref
  have distinct explanations; the entry stays visible but disabled when unavailable.
- Committed opens bounded pages of 40 reachable commits with title, short SHA and date;
  the input filters the loaded page or accepts any commit expression on Enter. A selected
  commit compares its first parent to the commit itself; roots use the empty tree. Merges
  use the first parent, not a combined diff. Committed lives inside the secondary selector,
  not the main scope menu. The primary scope remains Branch; the secondary trigger reads
  `Committed abc1234` and remains available to switch commits or return to a branch.
- The Branch pane owns the in-place base/ref and commit pickers, with arbitrary refs accepted on Enter. Existing
  target (HEAD / working tree) and method (merge base / two-dot) options are preserved.
- The single comparison pill is content-sized, may shrink, and never grows or stretches into spare grid space.
  Its label prioritizes a selected PR number, then the selected branch/ref, then local scope labels. A selected
  commit keeps its short commit description because substituting a branch would misstate that comparison. Long
  names truncate and full semantics stay in the tooltip.
- The comparison pill always shows **all-change** additions/deletions. The menu's bottom summary breaks those
  totals into primary, supporting and all changes, so supporting changes remain visible without moving the scope rows.
- Root scope labels, Branch/Pull Request identities, and every change-summary row are single-line controls. Literal
  labels never shrink into vertical CJK text; long branch identities truncate, while counts and +/- metrics never wrap.
- The Branch pane's Back row is the stable section title **Branch**. The target section owns the
  **Compare to · branch** identity, keeps it on one truncated line, and exposes the complete branch as its title.
  Target (worktree/HEAD) and comparison method (merge base/two-dot) use full-width horizontal segmented controls.
  Inside the Radix menu those segments remain native menu radio items—not a nested standalone radiogroup—so the
  menu's arrow-key focus order reaches and activates every choice.
- Pull Request is a root comparison choice. Its bounded list is loaded with branch context at repository scope,
  so local and branch modes can show a matching PR without per-row requests. It refreshes at most once per minute
  or on explicit refresh.
- Legacy `mode=branch` links still migrate to a committed-only `ref` comparison. New commit
  and unpushed modes persist independently in conversation state, scroll keys and viewed marks.

### Second-level lists drill down in place, they do not open beside the menu

The branch, ref, commit and pull-request pickers are levels of the _same_ menu: choosing their row swaps
the menu's content for the list, with a "‹ back" row on top, and the menu grows to
`min(20rem, available width)`. A Radix sub-menu opens _beside_ its parent and needs room there; in
the chat's side panel the app is an iframe about 450px wide, where the parent menu alone takes 208px
and the sub-menu ended up 156px wide squeezed against the edge (measured). `side`/`align` cannot
be overridden on `DropdownMenuSubContent` (Radix sets them after spreading props), so the pane swap
is the way to keep the list readable at any width. Verified at 360, 447 and 1100px.

- The pointer to the current commit is always written `HEAD`, never the branch name.
- Counts (`+N −M`) appear only when there is a result. A half-made choice or an empty comparison
  shows none, so it never looks like a finished answer.
- Comparison rules stay in tooltips; unavailable scopes carry an inline reason.
- The wording lives in `describeComparison` / `describeEmpty` (`src/shared/describe.ts`), pure
  functions covered by tests for every combination.

Empty states say _why_ and offer the one useful step, instead of a generic "no changes":
on the base branch itself ("HEAD is already at main") → compare with the working tree; nothing
staged → show all changes; no PR chosen → choose one; a PR number that matches nothing →
"not found" rather than "no differences".

## Repository menu

Two sections: **Related repositories**, **Other repositories**. Membership follows
`repos.selectedProject` (the selected conversation project directory), including the project
itself and nested repositories with segment-aware path boundaries. It never follows the active
diff repository or a remembered first-opened repository. Empty sections explain that no repos
were found. There is one shared radio selection across both groups. No "return to repository"
arrow, special home border, first-opened tag or duplicate section heading.

## Memory: what is bounded, and why

The app's API runs inside the Rome daemon, a single Node process with a ~2 GB heap and no limit
below it; a runaway cache there takes the whole platform down, not just this app. Measured, then
bounded (every guard has a test that fails without it, see `tests/memory.test.ts`):

- **Untracked file text** was kept for every file (about one byte of heap per byte on disk; 600 MB for
  1,500 files of 400 KB, times up to 6 cached views). A snapshot now keeps at most 16 MB of it
  (`DIFFVIEW_UNTRACKED_BUDGET`); collapsed files and files over the budget are read from disk when
  asked for (`lazy`).
- **Cached views** are limited by bytes (96 MB, `DIFFVIEW_VIEW_BUDGET`), not only by count.
- **Fingerprint** (polled by every open tab): concurrent callers share one `git status`; `lstat` calls
  are limited to 64 at a time and skipped past 5,000 changed paths (60,000 untracked files cost
  +252 MB of transient memory per poll).
- Other stores are small and capped: validated-repo cache, `gh pr diff` cache (6), generic cache (32).
- `cat-file --batch` output is read as bytes (`latin1`), not UTF-8 text: the sizes in its replies
  are byte counts, so decoding as text corrupted line totals for non-ASCII files.

In the browser, the leak that mattered was **refreshing**. A repository that keeps changing (an agent
is working in it) changes the fingerprint every few seconds. Each refresh used to clear all records
and re-parse everything with a clock-based cache key, so Pierre's per-item caches filled with
copies of unchanged files: +3.6 MB of JS heap per minute on a 60-file repo, more on bigger ones, and
the view jumped back to the top each time. Now:

- A patch's version is a hash of its text (`contentVersion`): same content, same cache entry.
- Same comparison, new fingerprint = **merge**, not reset. Unchanged files keep their record (not
  re-parsed, not re-rendered); the viewer's window is re-fetched because older records are stale;
  scroll position and the focused file stay.
- Pierre's highlighted-AST cache is capped at 40 (default 100).
- Result on the same scenario: heap flat at 18–19 MB for 5+ minutes of changes every 2 s.

Known limit: records for files the guardian has scrolled past are kept (about 80 KB of heap per
file for small files, more for big ones), so scrolling through tens of thousands of files in one
sitting will grow the tab's memory.
