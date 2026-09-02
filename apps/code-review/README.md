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
- Lets you tune review instructions per repository.
- Lets you either allow selected GitHub users or allow everyone except people you block.
- Keeps a review history dashboard in Rome for status, results, and follow-up.

## Best fit

Use Code Review when review turnaround is a bottleneck, when a repo needs a reliable baseline quality gate, or when you want an always-available reviewer for side projects, prototypes, and small teams.

It does not replace human review. It handles the repetitive first pass so humans can spend attention on the decisions that actually need judgment.
