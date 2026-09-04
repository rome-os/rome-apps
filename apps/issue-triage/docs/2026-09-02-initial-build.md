# 2026-09-02 — Initial build of Issue Triage

## Goal
Build a GitHub Issue Triage / auto-labeler app, modeled on the code-review app's
event-bus + agent + dashboard architecture.

## What was built
- **DB** (`issue_triage` prefix): `repositories`, `repo_settings`, `triage_results`.
  Raw-SQL `TriageRepository` mirroring code-review's `ScanRepository`.
- **Agent** `issue-classifier` — structured `outputSchema` { type, priority,
  areas[], flags[], reasoning }; area labels constrained to the repo's existing
  labels; honors enabled dimensions and per-repo custom rules.
- **Worker action** `issue-triage_triage-issue` — fetches the issue + repo labels,
  summons the classifier via `system:summon`, maps output to a restricted label
  set ({repo labels ∪ enabled built-in taxonomy}), replaces prior bot-owned
  type/*/priority/* labels that changed, applies the final set, and records the
  result. Robust to summon `output` vs raw-text JSON fallback.
- **Event handler** `issue-triage_issue-webhook` — event-bus handler for
  `provider:event:github.issues`; filters on per-repo settings (auto on,
  trigger-on-open / trigger-on-edit for opened / edited+reopened), ignores PRs,
  and de-dups re-fires via a title+body content signature + in-flight guard.
- **API** — gh-auth-status, repositories CRUD, repo-settings (enable subscribes
  the GitHub `issues` webhook + ensures the shared routine; disable unsubscribes +
  tears down routines when no repo is left), triage-results (+ repo filter),
  manual `triage` (URL or repo+number), `triage-batch` (cap 50), dashboard,
  connection/repair (guardian-only). Boot self-heal reconcile.
- **Web** — Home dashboard (stats, add repo, manual triage, repo cards, activity
  feed), per-repo Settings page (toggles for auto/open/edit, per-dimension
  enables, create-missing-labels, custom rules, connection health + repair,
  batch + single triage), and a triage result detail page. Uses the `@rome-os/ui`
  kit directly (not copied shadcn) per current SDK guidance.
- **Icon** — custom tag + triage checkmark glyph.

## Decisions / deviations
- Used the `@rome-os/ui` published component kit instead of copying shadcn
  components into `components/ui/`. The current scaffold ships the kit and the
  authoring guide prefers importing it; this keeps the app on component fixes.
- `applyMode` is stored but only `apply` is implemented (direct label apply, no
  approval gate, no explanatory comment) — matches the finalized design.
- Idempotency uses a `content_sig` column (sha256 of title+body, 16 hex) plus an
  in-flight active-result guard, rather than storing the hash in another field.

## Validation
- `pnpm typecheck` clean; `pnpm build` succeeds.
- Installed via `system:app_management` and smoke-tested (see handoff).

## Follow-ups
- GitHub must be connected via the Rome-managed `gh` CLI.
- No repo webhook is subscribed until the guardian enables auto-triage for a repo.
