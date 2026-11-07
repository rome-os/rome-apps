# Public PR history boundary

## Changes

- Version 0.43.0. Declare only `/pr-history` under `api.noAuth`. Public web code
  uses `/api/app-api/code-review/pr-history`; `/api/apps/...` remains gated by Rome.
- A top-level API allowlist admits non-guardians only for the exact history GET.
  All other endpoints/methods fail before DB access, CLI calls or reconciliation.
- Reuse the dashboard visibility helper, refreshing for public authorization so a
  cached public result cannot expose history after a repo becomes private.
  Private/internal/unknown/failing lookups return the same 404 before history reads.
- Public responses are explicit metadata projections with page-local IDs, fixed
  statuses/lens labels/verdicts and same-PR GitHub links. No stored review/reply
  bodies, historical titles/requesters, errors, prompts, project memory, session
  references, or task tokens. Completed local review text is not necessarily what
  was published to GitHub; full text is available via the GitHub links instead.
- Public visibility subprocesses share a 30/minute, two-concurrent budget;
  saturation returns 429 before spawning GitHub. Guardian reads bypass it.
- Guardian history remains unchanged. Public UI omits Back, Re-review, run/task
  details and session links; it neither loads guardian APIs nor reads/writes the
  guardian dashboard cache. Avatars do not require the private profile endpoint.

## Platform prerequisite (not silently worked around)

The deployed Rome manifest schema has `api.noAuth`, but no per-page public-route
field. `noAuth` opens only `/api/app-api/...`, not `/api/apps/.../manifest`.
`packages/web/src/lib/auth-routing.ts` permits anonymous app pages only when the
app is in the app-wide public access setting. The example public apps use that
setting, not a manifest page declaration. Thus this app change alone does **not**
make `/apps/code-review/pr/rome-os/rome/1804` login-free with the app kept private.
A route-scoped public page/manifest/bootstrap contract in Rome is required to
complete the exact page URL requirement. Do not work around it by making every
page public or inventing a manifest field. No app-wide sharing setting is changed.

## Validation

- App typecheck: passed.
- App production build: passed.
- Workspace typecheck and full suite: passed (489 tests before review fixes).
- Built handler smoke with real GitHub and an in-memory DB: public 200,
  unknown repo 404, dashboard 403. No installation needed for that test.
- App tests: 16 files, 148 tests passed, including 35 new access/projection cases.
- Tests exercise anonymous + visitor callers (including forged identity headers),
  case-insensitive history matching, unknown/private/internal/error visibility,
  public-to-private transitions, invalid inputs, guardian payload preservation,
  all other route/method rejection, capability redaction and unsafe result links.
- Bot review: Design & Alternatives approved; main review found no P0/P1.
  Addressed its P2 lookup-budget and P3 summary-intent findings with tests.
- Briefly installed committed branch `2767dc5` for transport verification, then
  restored the exact Store 0.42.0 build/hash recorded below. No publish or
  access-setting change occurred.
- Anonymous HTTPS probes: public history 200 with five projected runs, unknown
  repo 404, dashboard API 401, dashboard-side history API 401, and app manifest
  for the history page 401 (confirms the platform prerequisite).
- Restored installed hash:
  `e6233cde6a95d2ed12495220869d8ba6b98aece4ad92df3647e33ad450fe6cfe`.
