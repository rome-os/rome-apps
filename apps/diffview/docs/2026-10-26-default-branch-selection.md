# Default branch selection (0.4.2)

## Change

Selecting **Branch** from the comparison menu now starts from the repository's
detected default branch and compares it with the working tree using the merge
base. For a repository whose default branch is `origin/main`, the initial
selection is therefore `origin/main → Working tree`.

Entering Branch resets an older branch comparison's explicit ref, HEAD target,
or two-dot method. Choices made after entering Branch remain selectable and are
still persisted per conversation.

## Validation

- The production menu browser regression first chooses a non-default
  `main → Working tree` two-dot comparison, switches back to local changes,
  then re-enters Branch and asserts `origin/main → Working tree` with the
  default three-dot method.
- Typecheck, unit tests, production build, source installation, and installed
  UI verification are required before delivery.
