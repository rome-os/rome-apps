# Built-in reviewers (0.37.0)

Replaces the PR's original 0.36.0 free-form lenses with opt-in Design & Alternatives
and Security reviewers. Deletes name/instruction CRUD, Adversarial template and
obsolete editor screenshots. No new action, agent, dependency or migration.

## Decisions

- Keep the existing queue, parallel detached runs, per-reviewer claims,
  supersession, reactions and history. Snapshot shipped reference text per run.
- Authorize mode-specific scope and verdict rules in the base agent and skill;
  remove the task-level claim that arbitrary prompts override base instructions.
- Reuse unchanged 0016: deterministic repo + built-in keys store only opt-ins;
  required legacy name/instructions columns are empty. Existing custom UUID rows
  are ignored, not remapped; historical snapshots survive. Pending custom runs skip.
- Let Design judge triviality and return a brief APPROVE without a comparison
  table. Simpler and more accurate than a line threshold for schema/API changes.
- Retain GitHub COMMENT events with real verdicts in the body: advisory output,
  no branch-protection coupling, compatible with guardian-as-PR-author credentials.

## Validation

- App typecheck, focused code-review source tests, and build pass.
- Tests cover opt-in defaults, toggle-only API validation, repo isolation,
  ignoring legacy custom rows, snapshots, claims/supersession, parallel fan-out,
  separate review headings, main-only reactions and per-row cancellation.
- Live install and PR #32 review verification: recorded in the PR description
  after the installed reviewers finish.
