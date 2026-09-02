# Trigger access policy

## What changed

- Added a per-repository access mode with two explicit choices:
  - **Selected people only** keeps the existing fail-closed allowlist behavior.
  - **Everyone except blocked** allows any identified GitHub user unless their login is on the repository blocklist.
- Added a dedicated blocklist editor to Automation settings. Allowlist and blocklist entries are stored separately, so switching modes does not discard either list.
- Applied the same policy to PR-open, PR-push, review-request, review-command, and summary-command triggers.

## Product and technical decisions

- Existing repositories migrate to `allowlist`, preserving their current behavior. The broader policy is opt-in rather than a silent access expansion.
- The connected GitHub account is always allowed and is removed from both submitted lists. Unknown actor or guardian identities remain fail-closed.
- The API validates the access-mode enum and normalizes logins case-insensitively. The legacy `manualTriggerAllowlist` response remains available for compatibility.
- `trigger_access_mode` and `trigger_blocklist` are additive columns; the existing allowlist column remains the source of truth for selected-people mode.

## Validation

- Code Review TypeScript typecheck passes.
- Code Review unit tests pass, including allowlist compatibility, open-mode behavior, blocked-user rejection, guardian override, and fail-closed identity handling.
- The full monorepo typecheck and test suite pass, and the Code Review production bundle builds successfully.
- The complete migration chain applies to an in-memory SQLite database; a pre-existing settings row retains `allowlist` mode with an empty blocklist.
- Installed `0.30.0` into the running Rome daemon and verified the Automation page at desktop and 390 px widths. Both access choices render without horizontal overflow; switching to open mode shows the blocklist editor and empty state. The switch request was intercepted during the visual check so production repository settings were not changed.
- The live settings API returns `allowlist` plus an empty blocklist for an existing repository, rejects an invalid access-mode value with HTTP 400, and the final browser reload is console-clean.

## Follow-up

- None required. App Store publication happens only after the pull request is reviewed and merged.
