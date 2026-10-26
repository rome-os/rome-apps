# Third PR review follow-up — 2026-10-26

The four P2 findings posted on PR #28 against `799dcba` are addressed in v0.3.9.

## Fixes

- **Large-tree freshness:** hash stat metadata for every changed path. At most 64 `lstat` operations run concurrently, and only 256 result tuples are retained before incrementally updating the digest. Size, mtime and ctime supplement porcelain output; the old 5,000-path skip is removed. This remains metadata-based detection, not a full file-content checksum or a persistent filesystem watcher.
- **Visible paging demand:** select the lookahead from visible pageable files, then map those paths into the server's filtered cursor sequence. Hidden viewed files no longer consume the lookahead. The backend page limits and single in-flight page request are unchanged; pages may still contain hidden files following a requested cursor, but the client does not walk those pages merely to reach the next unread file.
- **Out-of-order refresh:** `useWorktreeFreshness` reconciles both list/event fingerprints and comparison/context/mode changes. A mismatching event is reconciled once per active comparison/context, so an old event behind a newer list cannot drive an invalidation loop. A matching event clears the mismatch guard.
- **Submodule format:** both shared snapshot/page diff arguments and explicit file diff arguments force `--submodule=short`. Repository `log`/`diff` formatting cannot hide gitlink changes or misidentify nested submodule paths as parent-repository files.

## Regression coverage

- A real 5,001-changed-path API fixture edits an already-dirty tracked file and a late untracked file; `/events` changes and conditional `/files` returns new data.
- Real staged submodule gitlinks with `diff.submodule=log` and `diff` retain the correct path and `Subproject commit` patch across snapshots, forced paging, and expanded single-file requests. Index and status invariants are checked.
- Production-browser coverage hides 200 viewed files, verifies demand jumps to the next unread cursor, retains one page request in flight and stays idle when satisfied.
- Production-browser coverage deliberately returns new events before old lists, switches comparison scope with the same event hash, and tests the reverse ordering without repeated invalidation.
- The unchanged `799dcba` production bundle fails the new hidden-gap and delayed-list cases; the fixed bundle passes. The reverse-order guard is an additional regression, not a previously claimed failure.

Run `pnpm test`, `pnpm --workspace-concurrency=1 -r run typecheck`, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium> pnpm --filter @rome/app-diffview test:browser`. See `docs/development.md` for individual browser commands. Runtime evidence and final totals are recorded in the PR and local validation artifact. This change does not claim a long-running memory soak or native macOS/Windows acceptance.
