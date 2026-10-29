# Preserve triggers when disabling the last agent

- Persist `enableAutoReview` in the no-active-agents save path; remove only webhook wiring, retaining all trigger preferences.
- Regression test covers disabling Code Review as the last agent, retained automatic/request flags, skipped opened/push routing while disabled, and resumed routing plus webhook subscription on re-enable.
- Validation: regression reproduced before the fix; `pnpm build`, `pnpm exec tsc --noEmit` and `pnpm test -- apps/code-review/` passed (67 files / 543 tests, including packaged copies).
