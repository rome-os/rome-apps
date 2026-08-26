---
name: summary-skill
description: Use when the task is to summarize a pull request's reviews and discussion into a prioritized, triage-style report — an overview plus per-item fix-size (LOC bucket) and fix-value (trigger probability × impact). The task prompt (from the pr-summary action) will tell you to follow this skill and end by calling submit_output.
tools: [Read, Glob, Grep, Bash]
---

# Summary Skill — recap reviews/discussion + triage the fixes

Your job: read everything said about a single pull request and produce a crisp,
prioritized summary that helps the author decide **what to fix and in what
order**. Your output contract is the `submit_output` tool (structured JSON) —
the `pr-summary` action turns it into a comment on the PR. Do not post to GitHub
yourself.

## Inputs (from the task prompt)

- `repo` and PR `number`, title, and description.
- The collected **reviews** (body + verdict + author), **inline review
  comments** (path/line + body + author), and **issue-thread discussion**
  (comments). Large threads may be truncated — fetch more yourself if needed.

## Steps

1. **Read the provided reviews and discussion carefully.** These are the source
   of truth. Every item you report must trace back to something actually raised.
2. **Gather more context as needed** with `gh` + Read/Grep/Glob:
   - `gh pr diff <number> --repo <repo>` (use the `get-pr-diff` skill's
     strategies for large diffs) to gauge how much code a fix really touches.
   - `gh api repos/<repo>/pulls/<number>/reviews` and
     `.../pulls/<number>/comments` and `.../issues/<number>/comments` if the
     prompt's copy was truncated.
   - Read the referenced files to ground your size/impact estimates in real code.
3. **Distill the DISTINCT open action items.** Merge duplicates across reviewers;
   drop points already resolved/addressed and pure praise. Prefer a handful of
   meaningful items over an exhaustive list of nits.
4. **Assess each item:**
   - `fix_size` — the code needed to FIX it (not the PR size):
     - `small` = 1-10 LOC
     - `medium` = 10-100 LOC
     - `large` = >100 LOC
   - `fix_size_loc` — a SINGLE concrete LOC number inside that bucket (e.g. 3,
     60, 220). The user sees this exact number rendered as "Medium (~60)", so
     give a real estimate grounded in the diff/code, not just the bucket.
   - `trigger_probability` (`low`/`medium`/`high`) — how likely the underlying
     problem is to actually be hit in practice.
   - `impact` (`low`/`medium`/`high`) — how bad the consequence is when it hits.
   - `fix_value` (`low`/`medium`/`high`) — combine probability × impact:
     - high × high → high; low × low → low; mixed → medium (use judgment).
   - `rationale` — 1-2 sentences justifying size + value, citing the review/
     discussion or the code.
5. **Write the wrapper prose:**
   - `overview` — 1-2 paragraphs: what the PR does + the themes raised.
   - `overall` — a short recommendation on what to prioritize (e.g. "land the two
     high-value small fixes first; the large refactor can be a follow-up").
6. **Finish by calling `submit_output`** with `{ overview, items, overall }`.
   If nothing actionable is open, return an empty `items` array and say so.

## Rules

- Never invent problems — only summarize what the reviews/discussion raised.
- Estimate `fix_size` against the real diff/code when you can, not by guessing.
- Be concrete: name files, reviewers, or specific concerns where it helps.
- Your ONLY final action is `submit_output`. Do not reply in plain text.
