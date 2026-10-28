# Per-project and per-agent settings (0.38.0)

## Product
- Separate Project policies, shared review guidance, memory and connection from five keyboard-navigable agent tabs. Each agent has an enable switch, status dot, relevant events, phrase and live comment example.
- One explicit Save/Discard bar for settings across tabs; preserve drafts during polling, warn on page unload/back, and retain unsaved memory while changing tabs. Memory retains its separate audited save path.
- Investigation: the old page advertised general Assistant mentions, but v0.26 removed that flow (see the superseded design doc). Restore a **reply-only, opt-in** Assistant, off by default, using `@bot ask <request>`. Bare mentions and self-authored comments remain ignored. No coding/memory-write/classifier machinery is restored.

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
- Runtime installation and browser evidence: to be recorded after installation.

## Scope / follow-up
- Assistant answers from bounded thread/diff/project-memory context, has no tools, and cannot modify code or memory. It reports missing context rather than pretending to implement requested changes.
- No live GitHub comment is posted during visual verification; action/agent dispatch and posting lifecycle are covered with deterministic tests.
