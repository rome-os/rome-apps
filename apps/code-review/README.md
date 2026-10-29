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
- Supports manual runs from Rome, GitHub review requests, or a PR mention command. Text after a command is passed to the agent as a note, e.g. `@bot PTAL focus on the migration`.
- Gives the reviewer the PR's existing reviews, inline threads and comments, so it does not repeat findings that were fixed or explained in a reply. When a newer review supersedes an older one, the older review's unanswered inline findings are deleted; findings with replies are kept.
- Posts line-level findings plus a concise review summary and verdict.
- Lets you tune review instructions per repository, including two optional built-in parallel reviewers.
- Lets you allow everyone except people you block (the default for newly configured repositories) or allow only selected GitHub users.
- Keeps a review history dashboard in Rome for status, results, and follow-up.
- Groups every review run and bot conversation on a PR into one history view, so you can trace how the feedback evolved. Each GitHub review links to that history in its footer.

## Best fit

Use Code Review when review turnaround is a bottleneck, when a repo needs a reliable baseline quality gate, or when you want an always-available reviewer for side projects, prototypes, and small teams.

It does not replace human review. It handles the repetitive first pass so humans can spend attention on the decisions that actually need judgment.

## Additional reviewers

In a repository's settings, the **Security** and **Design & Alternatives** agent tabs
each have an enable switch, independent triggers and a command phrase. Both are off by default:

- **Design & Alternatives** compares the approach with 2–3 feasible alternatives,
  citing inspected repo paths, and recommends the best fit. Its summary includes
  the problem, goals/non-goals and a compact trade-off table. Trivial changes get
  a brief APPROVE without the table: an agent judgment avoids brittle line-count
  thresholds (a one-line schema change may matter more than a large formatting PR).
- **Security** reports only exploitable issues with concrete attacker/input/gain
  paths, using the existing security checklist. No hypothetical hardening advice.

Reviewers can run on PR-open, push, review-request and their own commands.
By default they retain the main reviewer's effective events; a Code Review
command (PTAL) runs only Code Review. Explicit dashboard reviews still run main plus enabled reviewers. Each has a
separate GitHub review headed with its name, status, session and per-run cancellation. Claims and supersession are
reviewer-scoped; only main manages PR/comment eyes reactions. History badges
identify each reviewer. Definitions ship in `code-review-expert/references`,
not the DB; each queued run keeps an immutable name/instruction snapshot.
The base agent explicitly authorizes each built-in's scope and verdict policy.

Reviews retain GitHub's **COMMENT event** with the actual APPROVE / COMMENT /
REQUEST_CHANGES verdict in the body. This preserves the app's advisory behavior,
avoids branch-protection coupling and works when the guardian's GitHub identity
is also the PR author (GitHub forbids approving/requesting changes on your own PR).
Design blocks only a clearly inferior one-way door or genuine correctness/data
loss; Security requests changes for exploitable P0/P1 issues.

Migration 0016 is unchanged. Its configuration table now stores only opt-ins under
repo + built-in ID keys; the legacy name/instructions columns are inert. Old
custom rows are ignored, never matched by name, and old run snapshots remain
readable. Queued custom runs are skipped rather than silently becoming main reviews.
No custom name/instruction authoring or Adversarial template remains.

### API

Paths are under `/api/apps/code-review`, with guardian authentication.

- `POST /pr-review-settings` saves per-repo settings, including
  `reviewerEnabled: { "security": true, "design-alternatives": false }`.
  This is the single reviewer configuration write path: it subscribes the webhook
  and ensures event routines for active agents, removes a repo's webhook when its
  last agent is disabled, and removes shared routines when no repo needs them.
- `POST /pr-reviews` with `{ "repo": "owner/repo", "prNumber": 123 }` or
  `{ "prUrl": "https://github.com/owner/repo/pull/123" }` queues main + enabled
  reviewers; the 202 response includes main `reviewId` and all `reviewIds`.
- `POST /pr-reviews/<reviewId>/cancel` cancels only that run.
