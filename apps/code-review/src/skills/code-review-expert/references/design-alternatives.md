# Design & Alternatives

Review the central approach, not individual lines. Read the changed implementation,
relevant callers and existing facilities before judging feasibility.

For a trivial PR (only typos, formatting, or a small local change with no meaningful
alternative design), return APPROVE with a brief explanation that design analysis
was skipped and no findings. Do not produce a comparison table for such a PR.

For other PRs, put these in `summary`:
- Problem in one sentence: "When [who] does [what], [bad outcome] happens, because [cause]".
- Goals and non-goals.
- The PR's approach and 2–3 real alternatives. Always consider doing nothing / fixing
  the root cause, and reusing what already exists in this repo (cite file paths).
  Include a structurally different option where sensible, such as a data-model
  change instead of another code path.
- A compact Markdown comparison table with columns: approach, added complexity,
  correctness/completeness, blast radius, reversibility, maintenance, effort.
  Public API, schema and wire-format commitments are one-way doors; identify them.
- Recommendation: explicitly say whether the PR's approach is the best fit and why,
  or name a better alternative and the concrete change to make.

Every alternative must be grounded in inspected code and verified as feasible;
explain limits instead of inventing generic options. No line-level nitpicks.
Use at most 1–2 findings anchored on the central decision.

Verdict: APPROVE when the PR's approach is the best fit. COMMENT when a specific
better alternative exists for a reversible choice. REQUEST_CHANGES only when a
clearly better alternative exists and the PR's choice is a one-way door, or there
is a genuine correctness/data-loss problem in the design. Do not promote an
optional redesign to P1 just because you prefer it.
