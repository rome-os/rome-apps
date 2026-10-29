# Per-project and per-agent settings (0.38.0)

## Product
- Separate Project policies, shared review guidance, memory and connection from five keyboard-navigable agent tabs. Each agent has an enable switch, status dot, relevant events, phrase and live comment example.
- One explicit Save/Discard bar for settings across tabs; preserve drafts during polling, warn on page unload/back, and retain unsaved memory while changing tabs. Memory retains its separate audited save path.
- Investigation: the old page advertised general Assistant mentions, but v0.26 removed that flow (see the superseded design doc). Restore a **reply-only, opt-in** Assistant, off by default, using `@bot ask <request>`. Bare mentions remain ignored. Replies are always framed with an Assistant heading, preventing a response from matching an addressed request. The connected account may be the guardian's own account, so explicit self-authored requests remain allowed by the shared ACL. No coding/memory-write/classifier machinery is restored.

## Data model and routing
- Migration `0017_agent_settings` adds one nullable `agent_settings` text/JSON column with a strictly validated, fixed shape for the five shipped agents. No generic agent registry, new tables, or duplicated existing settings.
- Main review keeps the existing automatic/request gates, five event flags and PTAL phrase. Summary keeps its existing phrase. Security/Design enablement remains solely in `review_lenses`.
- NULL resolves missing controls from the original effective gates without rewriting saved values. Summary inherits its former effective mention gate; Security/Design inherit the main review's effective events. Their `withReviewCommand` defaults true to retain PTAL fan-out. Assistant remains off, matching actual existing behavior. Explicit saves persist independent controls; unrelated memory/connection writes leave NULL untouched.
- Main, Security and Design route separately; webhook queues only selected reviewers. Explicit dashboard review requests retain the existing main + opted-in reviewer fan-out.
- Summary and Assistant are comment-only and no longer depend on Code Review's gates. Every route uses the shared fail-closed actor policy. Wiring/reconciliation/teardown consider all enabled agents, not just main review.
- New saves reject blank, duplicate (case/whitespace-insensitive), multiline, @-containing or overlong phrases, including disabled agents. Legacy collisions retain deterministic exact-command precedence: Code Review, Summary, Security, Design; exact commands precede Assistant requests. Existing saved phrases are not rewritten.
- Agent configuration and existing reviewer opt-ins save in one SQLite transaction after connection setup. Invalid input is rejected before external calls.

## Validation
- `pnpm exec tsc --noEmit` and `pnpm build`.
- `pnpm test -- apps/code-review/` from monorepo root: 55 files / 444 tests passed (the repository script runs the complete suite).
- Added routing, ACL, phrase validation, persistence/default compatibility, independent wiring, selective queueing, and reply-only Assistant lifecycle tests.
- Runtime installation and browser evidence are recorded below.

## Scope / follow-up
- Assistant answers from bounded thread/diff/project-memory context, has no tools, and cannot modify code or memory. It reports missing context rather than pretending to implement requested changes.
- No live GitHub comment is posted during visual verification; action/agent dispatch and posting lifecycle are covered with deterministic tests.

## First browser pass
- Source install succeeded at version 0.38.0 (`9ada4f686e44fd5bb09a262d98086292a153dfa80f3e12009d122793d24addcf`).
- Visually inspected Project, Code Review and Security on `rome-os/rome-apps` at 1440px. No console messages/errors.
- Live duplicate-phrase validation rejects Security = PTAL and disables Save; its comment example updates immediately.
- Found a mobile min-content overflow in the agent rail; fixed with an explicit single minmax grid column and min-width constraints. Clarified off-state copy. Added tab deep links.
- Keyboard arrow navigation moves both selection and focus correctly inside the shadow root. Duplicate phrase test drafts were discarded. Unsaved project memory survives switching to Assistant and back; restored without saving.
- Mobile screenshots exposed absolute screen-reader status text escaping the horizontal rail; use a two-column mobile agent grid with positioned tab buttons instead. All five statuses remain visible without horizontal scrolling.
- Corrected Assistant's loop guard to permit explicit requests from the connected/guardian account: Rome often posts using that same GitHub login. Structural reply framing (`### Assistant`) prevents loops without blocking the guardian. Added regression coverage.
- Verified a real settings round-trip on the disabled Security agent: temporarily saved `security-ui-check`, reloaded and confirmed persistence, then restored `security`. No agent was enabled and no GitHub comment was posted. All previous main flags, phrases, access lists and reviewer opt-ins were retained; the first explicit save materialized the compatibility defaults into the new column.
- Repo-card health now uses the same all-agent wiring predicate as the API, so Summary/Assistant-only configurations are not incorrectly labelled Manual.


## Final verification (2026-10-29 UTC)
- Final runtime code installed successfully from the specified worktree at version **0.38.0**.
- `pnpm build` and `pnpm exec tsc --noEmit` passed after the final code change.
- Source-only Code Review tests: `pnpm exec vitest run apps/code-review/src` — **12 files / 98 tests passed**.
- Exact requested root command `pnpm test -- apps/code-review/` passed; after installation it discovers **67 files / 542 tests**, including the packaged source tests under `.rome/artifact` (the pre-install whole-workspace suite is 55 files / 444 tests).
- Opened the installed app at `http://127.0.0.1:4141/apps/code-review`, then verified `rome-os/rome-apps` Project, Code Review, Security and Assistant views. Tab deep links, keyboard focus/selection, live phrase examples, duplicate validation, real save/reload/restore, unsaved memory and polling-safe drafts passed. Console: zero messages/errors.
- Inspected screenshots at desktop 1440px, mobile 390px, and dark mode. Mobile document/app width is 375px inside a 390px viewport including scrollbar: no horizontal page overflow. Theme and temporary capture-only transition override were restored.
- Screenshots live outside the worktree at `/home/rome/.rome/default/projects/code-review-screens/`:
  - `project.png` (full Project area)
  - `code-review.png`
  - `security.png`
  - `assistant.png`
  - `project-mobile.png`
  - `security-mobile.png`
  - `security-dark.png`
- Remaining verification limit: no real model-generated GitHub comment was sent; Assistant dispatch, idempotency, cancellation, output validation and posting are covered by mocked action tests. Assistant intentionally remains off for existing repos and is reply-only, not the retired coding/classifier workflow.
