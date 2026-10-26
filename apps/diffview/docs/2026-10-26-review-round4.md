# PR review follow-up, round 4 — 2026-10-26

v0.3.10 addresses six additional findings on PR #28 (five inline comments and one review-summary-only scope finding).

## Changes

- **Conversation persistence:** chat, home and scroll keys share an owned-prefix group LRU, bounded to 32 scopes / 512 KiB including keys and index. Entries are capped at 64 KiB; scroll writes drop old anchors to fit. Reading discovers and prunes legacy scopes too. Quota recovery evicts whole older owned groups, never another app's values, global Diffview preferences or viewed marks. Viewed state retains its independent 32-key / 256 KiB budget. Browser storage remains best-effort when blocked or the origin is full of unrelated apps' data.
- **PR fallback capability:** file-list DTOs expose `fallback`. The UI labels GitHub-provided hunks, disables global and per-file context/full-file controls, and disables renderer context buttons. The API rejects unsupported expansion with `fallback_context_unavailable`; normal finite-hunk loading remains supported. Fallback listing and explicit patch matching use parsed file names rather than header substrings, including Git's trailing tab on spaced names.
- **PR remote transport:** after canonical repository validation, prefer a configured fetch remote with the same host/owner/repository identity. Standard scp-like SSH and `ssh://` URLs are supported. Never infer identity from only the repository name or choose a different fork. Use the synthesized canonical HTTPS URL only when no matching remote exists. Authentication is left to Git and existing configuration; the app does not read credential stores or configure authentication. SSH host aliases that cannot establish a canonical-host match are not guessed.
- **Unborn branches:** the All comparison uses the format-independent empty-tree OID against the working tree, preserving edits after staging. Staged and Unstaged retain their separate index semantics.
- **Unpushed availability:** suppress retained query results, counts and file metadata when tracking is unavailable or erroneous. Availability transitions cancel old patch work. Tracking head/upstream OIDs participate in the Unpushed query key, so recovery/new branches cannot reuse a previous branch's cached list; existing unavailable-state explanations are displayed.
- **Lockfile scope:** restore every existing importer/package/snapshot entry from the base branch, including the root Vitest peer graph with `@types/node` 26.4.1. Only Diffview's importer and additional graph entries remain. Semantic comparison confirms zero changed existing entries; frozen install validates the combined graph. Other apps' React importer versions were already unchanged; the root peer graph did have unrelated churn and is now restored.

The review's v0.3.8 description remark was stale: the PR already said v0.3.9 when fetched for this follow-up. Historical verification documents retain their original versions.

## Validation boundaries

Unit/API fixtures cover group-count/byte limits, legacy migration, cross-prefix/group eviction, quota/index failures, unreadable storage, oversized scroll anchors, fallback spaced paths and denied expansions in snapshot/paged modes, unborn staged/worktree behavior, and SSH source selection with verified endpoints/ref cleanup against a local bare fixture. No real private SSH account or credentials are needed by these tests.

Production-browser cases cover ready→no-upstream and ready→detached transitions, restoration on a different tracking HEAD, and fallback notices plus disabled menu/global/renderer controls. The old production bundle reproduces stale Unpushed content and lacks fallback capability feedback. Existing worker, sidebar, menu, scroll, large hidden-gap and refresh-order regressions remain in `test:browser`.

Run frozen workspace install, all workspace typechecks/tests and `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium> pnpm --filter @rome/app-diffview test:browser`. Final totals and installed-runtime evidence are recorded in the PR and local validation artifact. No native macOS/Windows or long memory-soak acceptance is claimed. The PR remains draft; no merge or App Store publication is performed.
