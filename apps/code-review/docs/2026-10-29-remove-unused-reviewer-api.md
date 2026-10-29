# Remove unused reviewer enablement API

- Audited all tracked repo sources, including UI, skills, agents, docs and actions. Only the unimported `ReviewerLensesSection`, README endpoint documentation and tests referenced the legacy API; no live caller remained.
- Deleted the unused reviewer GET/PATCH API, legacy component and UI-only type. Reviewer writes now use only `POST /pr-review-settings`, which already owns webhook/routine lifecycle. Kept repository persistence helpers still used by that path.
- Regression tests reject retired routes without mutation and exercise first-enabled / last-disabled Security and Design reviewers through the remaining endpoint, including webhook subscription/removal, routine creation/deletion and retained preferences.
- Validation passed: focused API tests (9 tests), `pnpm build`, `pnpm exec tsc --noEmit`, and `pnpm test -- apps/code-review/` (67 files / 541 tests, including packaged copies).
