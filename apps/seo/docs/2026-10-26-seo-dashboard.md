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
