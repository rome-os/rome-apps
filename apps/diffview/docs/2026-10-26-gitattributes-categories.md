# Git attributes review categories (0.4.0)

Diff now reads review categories from each repository's `.gitattributes` and
keeps generated or supporting changes from dominating the primary line totals.
Every changed file remains in the tree and review stream.

## Behavior

- `diffview-category=generated|lockfile|test|fixture|snapshot|vendored` is the
  authoritative category when present.
- `linguist-generated`, `linguist-vendored`, and
  `linguist-documentation` provide portable fallback categories.
- Files without one of those attributes are `primary`.
- The files DTO includes the category on every entry plus backend-computed
  `primary`, `supporting`, `all`, and per-category totals. The comparison pill
  shows primary additions/deletions; its menu shows primary, supporting, and
  all totals so excluded lines remain visible and auditable.

## Target selection and batching

Attributes are resolved for the right side of the selected comparison:

- all/unstaged and ref-to-worktree use working-tree attributes;
- staged uses the real index;
- branch, commit, unpushed, PR, and ref-to-HEAD use the resolved target commit.

The installed Git is 2.39 and has no `git check-attr --source`. Historical
targets therefore use a temporary `GIT_INDEX_FILE`: one `read-tree` loads the
target tree and bounded `check-attr --cached --stdin -z` batches resolve all
paths without checking out a branch or changing the repository index. An
unavailable target leaves files primary instead of borrowing unrelated
working-tree attributes. GitHub fallback patches have no locally available
target tree and use that safe behavior.

## Validation

- Unit coverage exercises custom-over-Linguist precedence, all comparison
  source mappings, nested attributes, spaces/tabs/newlines in paths,
  staged-versus-worktree rules, historical targets, missing historical
  objects, deletions, renames, repositories without attributes, totals, and a
  9,000-path bounded batch.
- The API paging regression asserts that totals accompany the full file list.
- The production menu browser regression verifies primary/supporting/all
  totals while every file remains navigable.
- The supplied `rome-ctx-connections` rules classify its Drizzle snapshot as
  generated, connection test as test, root pnpm lockfile as lockfile, and
  implementation file as primary.

## Follow-up

GitHub CLI's patch-only fallback cannot safely reconstruct nested attributes
when the fetched target objects are unavailable. Those files deliberately stay
primary; no working-tree rules are substituted.
