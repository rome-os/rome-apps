# Initial activation and legacy compatibility defaults

- Checked freshly fetched `origin/main` (`63924afe`): adding a repo creates no settings row, but its unchanged-default Save was enabled (`saving || autoSaving` only). The new dirty gate introduced the onboarding blockage.
- Missing settings now enable Save with explicit "Save to activate" copy, without treating untouched defaults as user edits or enabling Discard. No new UI test infrastructure.
- Audited all tracked POST callers: the current UI supplies agentSettings; no flag-only production caller remains in this repo. The compatibility fix is small: read explicitly stored agent config, otherwise derive defaults from post-update flags before deciding wiring. NULL remains NULL and explicit independent agent config stays unchanged.
- Regression tests reproduce legacy flag-only teardown and protect explicitly saved independent settings. `pnpm build`, `pnpm exec tsc --noEmit` and `pnpm test -- apps/code-review/` passed (67 files / 540 tests, including packaged copies); focused API tests passed (7).
