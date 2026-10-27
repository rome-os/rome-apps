# Review categories (0.4.1)

Diffview separates primary implementation changes from supporting changes so
generated artifacts, tests, fixtures, snapshots, and lockfiles do not dominate
the main line totals. Every changed file remains in the tree and review stream.

## Classification

Repositories can use the portable GitHub Linguist attributes
`linguist-generated`, `linguist-vendored`, and `linguist-documentation`.
Diffview does not define or read a custom `diffview-category` attribute.

For common categories without a standard Linguist attribute, Diffview applies
deliberately narrow path rules:

- exact lockfile basenames: `pnpm-lock.yaml`, `package-lock.json`,
  `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`,
  `Gemfile.lock`, `poetry.lock`, and `uv.lock`;
- snapshots: a `__snapshots__` directory or `.snap` suffix;
- fixtures: a `fixture`, `fixtures`, or `__fixtures__` directory;
- tests: a `test`, `tests`, or `__tests__` directory, or a basename containing
  `.test.` or `.spec.`.

Priority is vendored, documentation, exact lockfile, generated, snapshot,
fixture, test, then primary. A false/unset Linguist attribute disables only
that attribute; path rules can still classify the file. Broad names such as
`vendor`, `dist`, `docs`, `generated`, arbitrary JSON/Markdown, or substrings
like `contest` and `locksmith` are not guessed.

The files DTO includes a category on every entry plus backend-computed
`primary`, `supporting`, `all`, and per-category totals. The comparison pill
shows all additions/deletions; its menu shows primary, supporting, and all
totals so excluded lines remain visible and auditable.

## Target selection and batching

Attributes are resolved for the right side of the selected comparison:

- all/unstaged and ref-to-worktree use working-tree attributes;
- staged uses the real index;
- branch, commit, unpushed, PR, and ref-to-HEAD use the resolved target commit.

The installed Git is 2.39 and has no `git check-attr --source`. Historical
targets therefore use a temporary `GIT_INDEX_FILE`: one `read-tree` loads the
target tree and bounded `check-attr --cached --stdin -z` batches resolve all
paths without checking out a branch or changing the repository index. If a
target tree is unavailable, Diffview does not borrow unrelated working-tree
attributes; only deterministic path rules remain available.

## Validation

- Unit coverage exercises attribute/path priority, conservative false-positive
  boundaries, nested attributes, spaces/tabs/newlines in paths,
  staged-versus-worktree rules, historical targets, missing historical
  objects, deletions, renames, repositories without attributes, totals, and a
  9,000-path bounded batch.
- The API paging regression asserts that totals accompany the full file list.
- The production menu browser regression verifies primary/supporting/all
  totals while every file remains navigable.
- The supplied `rome-ctx-connections` rules classify its Drizzle snapshot as
  generated, connection test as test, root pnpm lockfile as lockfile, and
  implementation file as primary.

## Limitation

GitHub CLI's patch-only fallback cannot safely reconstruct nested attributes
when the fetched target objects are unavailable. Those files use path rules
only; no working-tree attributes are substituted.
