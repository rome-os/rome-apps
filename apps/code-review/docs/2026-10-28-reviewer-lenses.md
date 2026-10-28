# Reviewer lenses

## Change

- Add optional per-repo additional reviewers, with an Adversarial template.
- Snapshot each enabled reviewer's identity, name and instructions into separate
  queued runs before parallel detached dispatch from webhooks and dashboard.
- Keep the main prompt and GitHub heading unchanged; use the same expert agent
  and COMMENT review event for each lens, with a distinct heading.
- Scope claims and previous-review supersession by nullable lens identity.
  Only the main run owns PR/comment eyes reactions and skip markers.
- Add guardian-only repo-scoped CRUD, instruction audit details, lens badges
  and commit-labelled adjacent history runs; latest verdict refers to main,
  and the history re-review button checks every run's active state.
- Preserve snapshots and historical lens identity after deleting a configuration.
- Bump to 0.36.0; no new action, agent, or dependency.

## Migration

0016 follows 0015's append-only SQL + journal pattern. Existing Drizzle snapshots
stop at 0002; `pnpm db:generate` was attempted but cannot reconcile that stale
baseline without interactive rename/create prompts. No old migration or snapshot
was rewritten. Repository tests apply the complete migration chain to SQLite.

## Validation

- `pnpm typecheck` (entire workspace): passed.
- `pnpm test -- apps/code-review/`: passed (52 files / 420 tests; this command
  currently runs the whole workspace).
- `pnpm exec vitest run apps/code-review/`: passed (9 files / 74 tests).
- `pnpm build` in apps/code-review: passed.
- Tests cover simultaneous main/lens claims, duplicate locking, scoped
  supersession, saved snapshots, CRUD/validation, all webhook trigger types,
  manual fan-out, dispatch failures, prompt precedence, separate COMMENT headings,
  main-only reaction lifecycle and skip markers, and per-row cancellation.

- Source install through system:app_management succeeded at 0.36.0.
- Read-only SQLite inspection confirms the new review_lenses table, all three
  lens snapshot columns, and migration journal timestamp 1793145600000.
- Browser smoke test on /apps/code-review/trigger-settings?repo=rome-os%2Frome-apps:
  clicked Adversarial, verified the saved template via GET, toggled it off,
  verified enabled=false, then deleted the temporary reviewer via the UI.
  The repo is left with no lenses, ready for the guardian's live test.
- Light and dark screenshots: [desktop](screenshots/reviewer-lenses-desktop.png),
  [dark](screenshots/reviewer-lenses-dark.png).
No live PR review will be triggered by this development task.
