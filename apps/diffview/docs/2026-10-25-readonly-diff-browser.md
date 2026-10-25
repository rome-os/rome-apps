# Diff — phase 1

## Product and boundaries
- New independent source app `diffview`, full-page `/apps/diffview`, sidebar entry, read-only file/branch/PR/ref review. No index, worktree, commit or comment mutations.
- PR reads may fetch to `refs/diffview/pr/<n>` (repository metadata only, never checkout/index). Existing gh credentials are used, never managed or changed.
- No selected-project property exists in the published SDK/bootstrap. Fall back to profile projects/default; when it is a container, prefer its workstation-core repo. Switcher scans depth ≤3 under the profile projects root.
- Guardian-only GET API. Repository and Git-directory realpaths must stay in root. Refs are resolved to commit hashes with --end-of-options. Git/gh use spawn argument arrays, no shell, timeouts, bounded output, disabled diff helpers/fsmonitor/hooks. Untracked content rejects symlinks/special files and checks opened-fd realpath on Linux.
- Status polling uses porcelain-v2 + HEAD + changed-file size/mtime (the extra metadata detects edits that leave porcelain unchanged). Small ephemeral cache; viewed marks in localStorage keyed by repo/comparison/HEAD.

## Renderer P0
- `@pierre/diffs` pinned **1.6.1**, Apache-2.0 (`node_modules/@pierre/diffs/LICENSE.md`); Shiki pinned 4.5.0.
- Native Pierre CodeView works inside the Rome-style outer ShadowRoot; each visible file has another ShadowRoot. `rome build` bundles the module workers via new URL(). Two workers initialized and highlighted correctly.
- Selected **shiki-js** deliberately: no WASM request or runtime initialization is needed. A dormant oniguruma WASM chunk is emitted by the upstream library but not fetched. No renderer fallback required.
- Curated lazy grammar catalog: JS, TS, JSX, TSX, JSON, CSS, HTML, Markdown, YAML, Python, Bash; unsupported file types are explicitly plain text. Other grammar packs are not emitted. Themes and backend libraries remain lazy upstream chunks.
- Before optimization: 12,000 changed lines, extreme scrollbar jumps (~2k px/frame) produced long tasks; word-level diffs were costly. Disabled intra-line word diff, split UI loading from renderer, and tested the requested scale with realistic continuous scrolling.
- Historical P0 measurement (the one-off scripts were retired in favor of the production `test:worker` regression); 200 files, 5,200 added/deleted lines, 1440×1000 headless Chrome, two workers. Recorded run: text 505 ms; highlighted tokens 867 ms; 900 scrolling frames at 120 px/frame; p50 16.7 ms, p95 19.4 ms, maximum 45.3 ms; **zero >50 ms main-thread tasks** during cold mount and scrolling. At most three file containers mounted. Timing is machine-specific, not a universal guarantee. Earlier cold runs had 51–214 ms startup tasks; dynamic route separation removed them in the measured run.
- Separate source notes and tests capture the 8 MB explicit-load ceiling and 512 KB default patch ceiling. Initial viewport text precedes highlighting.

## UI
- Kit controls, inherited Rome semantic tokens, nested-shadow header styles isolated inline (the outer Tailwind sheet cannot cross Pierre's per-file shadow root).
- Global html lang observed live, rome.lang only a fallback; no app switch. Full UI is Chinese or English, not bilingual. Global theme observed live.
- Lazy on-visible file patches (3 concurrent), folder tree, filter, status/counts, remembered viewed marks, hash state, unified/split, context size/expand, j/k file navigation and n/p hunk navigation.
- Large changed files (>2,000 changed lines), lock/generated/vendor files collapse by default. Binary placeholders; loading, empty and localized error states; polling and focus refetch; last good data retained on failed updates.
- Manual refresh is a deliberate exception to AUTHORING's default (explicit product requirement). Read-only data is sourced from git, not duplicated into a database.

## Checks completed before install
- `pnpm test`: 6 tests pass including real temporary git fixture, staged+unstaged+untracked+rename+binary, branch/ref mapping, invalid refs, root/symlink escape rejection and content-change fingerprint.
- `pnpm typecheck`, `pnpm build` pass.
- Source API smoke against real workstation-core: files 200 (~838 ms cold), refs 200 (~698 ms; nine branches, 40 commits, PR ready), fingerprint 200 (~46 ms).
- Dedicated safe fixture: projects/default/diffview-smoke, branch feature, staged + unstaged + untracked + renamed + binary and a collapsed lockfile; no user repo mutated.

## Limits / follow-ups
- No file-editing operations, comments, inline word diffs or non-curated-language highlighting by design.
- PR fallback uses the gh patch when local fetch/base resolution fails. Live PR fetching still requires a reachable remote and existing gh authorization; missing/not-authenticated/no-remote states are surfaced without touching credentials.
- Context expansion requests up to 10,000 unchanged lines rather than hydrating whole blobs, bounded by patch caps. Larger files can still be reviewed as a summary but not displayed beyond 8 MB.
- Unborn HEAD all mode currently uses the cached diff plus untracked; unstaged edits to newly staged files before the first commit need the unstaged filter.
- Independent installed-app verification and browser evidence are added after installation.

## Installed browser smoke / corrective pass
- Installed source mode successfully (first artifact b1b77327…). Verified full-page route, sidebar icon, default repo, lazy patches, binary placeholder, lockfile load and branch comparison in real dashboard.
- Found and fixed a transition race: Pierre may emit an old header-slot snapshot when switching item lists; header lookup now tolerates removed paths and the viewer remounts per comparison. Previously switching branch → uncommitted could throw and blank the page. Runtime regression test includes that roundtrip.
- Non-git directories now report `not_repo` rather than a generic command failure.

## Independent verification findings and repair
- First clean assistant:assistant verdict: FAIL. Independently reproduced context-expansion crash (`loadDiffFiles is required`), viewed keys including inactive-mode params, and narrow-screen tree compression.
- Repair: never enable Pierre full-blob `expandUnchanged` for partial patches; the toolbar expands via bounded `git diff --unified=10000` requests instead, and metadata-only hunk separators expose no unsupported blob-expansion actions. Expanded context uses a larger collapse threshold.
- Repair: viewed keys now include only effective comparison inputs (uncommitted filter / branch base / PR number / ref+dots+target), not inactive params or context display size. Added a unit test.
- Repair: mobile file tree is an overlay drawer, with an explicit close button and auto-close after file selection; desktop retains side-by-side layout.
- Independent perf corroborated two workers and virtualized 2–4 file mounts, 900-frame scroll p95 ~20 ms, zero scrolling long tasks. Its installed-app cold start measured text ~1.52 s, highlight ~1.93 s and **three startup long tasks**. Thus zero long tasks is confirmed for steady scrolling only, not guaranteed for cold dashboard/bundle startup. This corrects the earlier single-run cold-mount result; cold-start performance remains a known gap.
