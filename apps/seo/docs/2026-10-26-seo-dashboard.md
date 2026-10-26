# SEO dashboard · 0.3.0

- Adopted the reference full-stack src/ → dist layout. Existing nine action schemas, workflows, agent, twenty skills, commands, and references are preserved. Updated summon references to canonical IDs for manifest format 2.
- Added a token-based responsive dashboard using Rome UI primitives: instant check, workflow launcher with spec-driven fields, report rendering, deep-linked run details, searchable/filterable history, re-run and confirmed deletion.
- Added deterministic HTML parsing/scoring, Google-style snippet approximation and privacy-preserving social preview (remote images deliberately not loaded).
- Added DNS-pinned, per-redirect public HTTP(S) fetching: standard ports, no credentials, all-answer private/reserved-IP rejection (including mapped IPv6), 10s request timeout, max five redirects, 2 MiB decoded response cap. Crawl probes use 6s limits. No authenticated requests or JS rendering.
- Added SQLite/Drizzle migration/repository and persisted jobs dispatched through a detached action, following Code Review. Polling status survives tab closure. Runs interrupted for 30 minutes become failed and can be manually retried; no automatic AI retry or monitoring.
- Results are heuristics. Robots rules and sitemap membership are not evaluated. Word count is whitespace-based and image alt coverage distinguishes missing vs empty alt. AI content remains untrusted rendered Markdown.

Validation and runtime evidence will be recorded after installation.

## Initial validation

- Typecheck, production build, and 47 tests pass (including existing workflow tests, parser/scoring, network guards, detached job outcomes).
- `pnpm install --frozen-lockfile` succeeds. Root lock refresh also fills the previously missing existing Diffview workspace importer; no other app source was changed.
- Initial runtime install succeeded, exposing a production-only ESM chunk cycle in Rspack's shared Markdown bundle (`__webpack_require__` before initialization). Extracted the ESM runtime into its own chunk in the app's rslib config; dynamic language/highlighter imports remain lazy. Rebuilding/reinstalling to verify the actual mounted UI.

## Runtime verification

- `system:app_management` installed SEO 0.3.0 successfully from this worktree. Actual browser verified at `/apps/seo` using connected profile `3teautxk`, isolated session `seo-review`.
- Real instant check `e0fa8cab-adf1-4553-ae18-9da781df555f` for https://romeos.cc/ completed: 100/100, all 17 signals passed; HTML response 280 ms. Search/social previews and page-data views render.
- Optimize Meta launched from that result using the UI; job `ddc594a9-8198-48a6-99d1-cee4500ad508` completed in ~75 seconds. Confirmed live status, persistence after leaving/reloading, report table, syntax-highlighted HTML and its code-copy control, and the completed report in history.
- `execute_action seo:optimize_meta` independently fetched https://romeos.cc and returned current-state analysis and recommended title/description/HTML (session `dca48a58-b27c-433b-9f7d-bfb27091b7af`). Existing public action schema remains unchanged.
- Exercised instant-check Re-run and confirmed-delete through UI using new test record `372ac353-b350-4016-9780-62140adc2767`; original check/report retained. Private URL submission rejected inline without creating a record.
- Dark mode reviewed; 390px responsive captures reviewed. Host sidebar transitions were disabled temporarily for accurate resized captures (no application styling altered).
- Independent verifier (fresh `assistant:assistant` with `coding:app_verification`, session `c3271c50-e19d-406a-80f4-60119cc4f041`) reports runtime PASS: both real runs, all 9 workflows, original 9 actions and 20 skills, filters/reloads, malformed/private URL 400s, and no 390px horizontal overflow. It flagged only a pending source/artifact mismatch for singular count copy; final install includes that correction.
- Full workspace `pnpm typecheck` passed. Focused SEO tests: 47 passed. Production build and frozen-lockfile install passed.

## Evidence

Real browser screenshots are in `.rome_store/assets/`: `dashboard-empty.png`, `page-check.png`, `workflows.png`, `workflows-dark.png`, `workflows-mobile.png`, `ai-report.png`, `report-code.png`, `history.png`, `report-loading-mobile.png`, and `private-url-error.png`. Desktop captures are cropped only to remove unrelated sidebar/account details; app contents are not composited.

## Remaining limits

Instant checks do not execute JavaScript or measure Core Web Vitals. Social cards intentionally omit remote image loading. AI output is advisory, with model/tool availability affecting completion. Dashboard jobs survive tab closure, but are not automatically resumed after a daemon interruption: stale jobs fail after 30 minutes and can be re-run. History lists the newest 200 records (older records remain in SQLite and are addressable by deep link). No PR or publishing performed.
