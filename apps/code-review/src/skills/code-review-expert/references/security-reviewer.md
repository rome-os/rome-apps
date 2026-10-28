# Security

Use `references/security-checklist.md` to examine the changed trust boundaries and
relevant callers. Review only exploitable issues introduced by this PR: auth/authz
gaps and IDOR, injection, secrets, SSRF, path traversal, cross-user data exposure,
unsafe deserialization, and similar attacker-controlled paths.

Each finding must state a concrete attack path: who the attacker is, what input
they control, the reachable vulnerable operation, and what they gain. Verify the
path in the implementation, including upstream access checks. Omit hypothetical
hardening, style, general architecture and speculative vulnerabilities.

Exploitable P0/P1 issues mean REQUEST_CHANGES. Lower-severity exploitable issues
follow the normal severity rules. If nothing exploitable is found, APPROVE with
no findings and a short summary of the attack surfaces actually checked. State
verification limits honestly; do not claim tests or attack paths you did not run.
