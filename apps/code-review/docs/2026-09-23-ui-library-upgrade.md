# UI library upgrade

## What changed

- Added the latest `@rome-os/ui` release (`0.3.2`) and upgraded the web SDK to `0.3.4` so the app uses the current Rome component and token vocabulary.
- Replaced the app-local Button, Card, Avatar, Switch, Skeleton, and Tooltip implementations with their published `@rome-os/ui` counterparts.
- Replaced hand-built dialog, alerts, badges, radio controls, inputs, textareas, loading indicators, empty states, page headers, activity filters, list rows, timestamps, and Markdown rendering with library primitives.
- Removed the copied Radix/CVA/classname dependencies that were only needed by the deleted local primitives.
- Kept only Pagination and Timeline under `components/ui/` because `@rome-os/ui@0.3.2` does not publish equivalents; both now compose shared kit primitives and `cn`.
- Reduced `styles.css` to the SDK/UI stylesheet imports plus a small Markdown compatibility layer.

## Product and technical decisions

- Existing routes, settings semantics, review actions, and API behavior are unchanged; this iteration only consolidates visual primitives and dependency ownership.
- The shared Markdown component is used despite its larger optional renderer bundle because the goal is maximum convergence on the Rome UI library and consistent Markdown behavior.
- The full shared Markdown stylesheet currently cannot be mounted by the Rome app host because its KaTeX font URLs pass through an app-relative CSS URL rewriter. Until that host path is fixed, the app imports Streamdown's font-free stylesheet, scans the same renderer packages, and keeps only the base shared typography rules locally.
- Semantic status presentation now uses shared `Badge` and `Alert` variants instead of app-owned color recipes.

## Validation

- `pnpm typecheck`
- `pnpm build`
- `pnpm test -- apps/code-review/` — 6 files, 40 tests passed

## Follow-up

- Revisit the remaining local Pagination and Timeline components when the shared UI package publishes equivalents.
