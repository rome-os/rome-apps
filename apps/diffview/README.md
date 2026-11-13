# Diff

Review Git changes without leaving Rome — and without changing your files.

- Review unpushed commits, all uncommitted changes, staged or unstaged files, branch comparisons and individual commits.
- Browse paginated local commit history and pull requests from one in-place comparison menu.
- Navigate a folder tree with file status, change counts and remembered viewed marks.
- Read unified or side-by-side diffs, with syntax highlighting and large-file safeguards.
- Switch between local repositories and share a link to a comparison.
- Follow Rome’s language and light or dark appearance automatically.

Built for focused, read-only code review. No staging, reverting, commits or comments. Pull request browsing uses your existing GitHub CLI setup; it never manages your credentials.

## Agent actions

- `diffview:select_view` selects the current conversation's repository/comparison, without changing Git state or stealing focus.
- `diffview:inspect` returns a bounded structured workspace or two-ref summary.
- `diffview:show_card` sends a non-blocking comparison card. It does not select or focus the sidebar until the card is opened.

See [the action contract and comparison semantics](docs/agent-surfaces.md).
