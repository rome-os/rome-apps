---
name: get-pr-diff
description: Fetch GitHub pull request diffs with gh CLI, including large-PR fallback strategies.
tools: [Bash]
---

# Get PR Diff

Skill for fetching GitHub pull request diffs using the `gh` CLI. Supports normal and large PRs with automatic fallback strategies.

## Tools

- Bash

## Quick Start

Given a repository (`owner/repo`) and PR number, use these commands to get the diff.

### Strategy 1: Full Diff (try first)

```bash
gh pr diff <PR_NUMBER> --repo <OWNER/REPO>
```

This returns the unified diff for the entire PR. It works for most PRs but will fail with HTTP 406 if the diff exceeds GitHub's 20,000 line limit.

### Strategy 2: Per-File Patches (fallback for large PRs)

If the full diff fails or the PR is known to be large, fetch the list of changed files with their individual patches:

```bash
gh api "repos/<OWNER/REPO>/pulls/<PR_NUMBER>/files" --paginate -q '.[] | "--- \(.filename) (\(.status), +\(.additions) -\(.deletions))\n\(.patch // "")"'
```

**Note on pagination:** GitHub returns at most 30 files per page. The `--paginate` flag handles this automatically, but for PRs with 300+ files, the response may be very large. In that case, consider reviewing only the most impactful files.

### Strategy 3: Individual File Diff (for targeted review)

To fetch the patch for a single file:

```bash
gh api "repos/<OWNER/REPO>/pulls/<PR_NUMBER>/files" --paginate -q '.[] | select(.filename == "<FILE_PATH>") | .patch'
```

### Strategy 4: Full File Content (when patch context is insufficient)

To see the full content of a file at the PR's head commit:

```bash
gh api "repos/<OWNER/REPO>/contents/<FILE_PATH>?ref=<BRANCH_OR_SHA>" -q '.content' | base64 -d
```

## Handling Large PRs

When dealing with a large PR (many files or a diff that exceeds GitHub's limit):

1. **Start with the file list** — use Strategy 2 without the patch to get an overview:
   ```bash
   gh api "repos/<OWNER/REPO>/pulls/<PR_NUMBER>/files" --paginate -q '.[] | "\(.filename)\t\(.status)\t+\(.additions)\t-\(.deletions)"'
   ```

2. **Prioritize files for review** — focus on:
   - Files with the most changes (high addition/deletion counts)
   - Security-sensitive paths (auth, crypto, config, env)
   - Core business logic (not generated code, lock files, etc.)
   - Files that are added or modified (skip deleted-only files if the deletion is straightforward)

3. **Fetch patches for priority files** using Strategy 3

4. **Use the local clone** if available — for understanding broader context, the repository clone (if provided) lets you `Read`, `Grep`, and `Glob` files directly without API calls.

## Tips

- The `gh` CLI is pre-authenticated. No token setup needed.
- All `gh api` calls support `--paginate` for multi-page results.
- The `-q` / `--jq` flag lets you filter JSON responses inline.
- Patch output from the GitHub API uses unified diff format, same as `gh pr diff`.
