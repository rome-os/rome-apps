# Code Review

Every pull request deserves a fast first pass. Code Review watches your GitHub repos, reviews PRs with an AI agent, and posts the result back to GitHub as a normal PR review with inline comments.

## Why install it

- **Catch issues before review time is spent** — surface bugs, risky edge cases, security concerns, performance regressions, and maintainability problems early.
- **Keep PRs moving** — give solo projects and small teams a second set of eyes when nobody is immediately available.
- **Make reviews consistent** — apply the same baseline checks to every PR, then let humans focus on architecture and product judgment.
- **Stay inside GitHub** — findings appear as inline PR comments with a verdict and summary, so the review lives where the code discussion already happens.

## What it does

- Monitors GitHub repositories you add from the Rome dashboard.
- Runs automatically when PRs open or receive new commits.
- Supports manual runs from Rome, GitHub review requests, or a PR mention command.
- Posts line-level findings plus a concise review summary and verdict.
- Lets you tune review instructions per repository, including optional parallel reviewer lenses.
- Lets you allow everyone except people you block (the default for newly configured repositories) or allow only selected GitHub users.
- Keeps a review history dashboard in Rome for status, results, and follow-up.
- Groups every review run and bot conversation on a PR into one history view, so you can trace how the feedback evolved. Each GitHub review links to that history in its footer.

## Best fit

Use Code Review when review turnaround is a bottleneck, when a repo needs a reliable baseline quality gate, or when you want an always-available reviewer for side projects, prototypes, and small teams.

It does not replace human review. It handles the repetitive first pass so humans can spend attention on the decisions that actually need judgment.

## Additional reviewers

In a repository's settings, use **Additional reviewers** to add a named lens with
its own instructions, or click **Adversarial** for an evidence-focused template.
Enabled lenses run alongside the unchanged main reviewer on every PR-open, push,
review-request, PTAL, or dashboard trigger. Each posts a separate GitHub review
(always a COMMENT event) and has its own status, session, and per-run cancellation.

Names and instructions are snapshotted on each run; editing, disabling, or deleting
a lens only affects future triggers. Past runs retain their instructions in the
review detail view. Re-review supersedes only that same reviewer's previous review.
Only the main reviewer manages the PR/comment eyes reactions.

### API

All paths below are under `/api/apps/code-review`, using the dashboard's guardian
authentication. Encode the repository query value as `owner%2Frepo`.

- `GET /review-lenses?repo=owner%2Frepo` → `{ lenses: [...] }`.
- `POST /review-lenses?repo=owner%2Frepo` with
  `{ "name": "Adversarial", "instructions": "Try to break the change. Report only concrete, code-evidenced bugs; no style nits.", "enabled": true }`
  → `{ lens: { id, ... } }`. Enabled defaults to true.
- `PATCH /review-lenses/<id>?repo=owner%2Frepo` with any of
  `{ "name": "...", "instructions": "...", "enabled": false, "position": 0 }`.
- `DELETE /review-lenses/<id>?repo=owner%2Frepo` removes the configuration, not run history.
- `POST /pr-reviews` with `{ "repo": "owner/repo", "prNumber": 123 }` or
  `{ "prUrl": "https://github.com/owner/repo/pull/123" }` queues main + enabled
  lenses; the 202 response includes the main `reviewId` and all `reviewIds`.
- `POST /pr-reviews/<reviewId>/cancel` cancels only that run.
