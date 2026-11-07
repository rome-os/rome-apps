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
  references, or task tokens. Unexpected public read errors return a generic
  message rather than the platform dispatcher's exception details. Completed local review text is not necessarily what
  was published to GitHub; full text is available via the GitHub links instead.
- Public visibility subprocesses share a 30/minute, two-concurrent budget;
  saturation returns 429 before spawning GitHub. Guardian reads bypass it.
- Guardian history remains unchanged. Public UI omits Back, Re-review, run/task
  details and session links; it neither loads guardian APIs nor reads/writes the
  guardian dashboard cache. Avatars do not require the private profile endpoint.

## Platform dependency and merge order

- `web.publicPaths: ["/pr/*"]` declares only the PR-history page namespace.
  Rome admits those pages and their path-specific rendering manifests without
  opening any dashboard-side data API. Public history data still uses only
  `api.noAuth: ["/pr-history"]` and the visibility/redaction boundary above.
- Merge and deploy https://github.com/rome-os/rome/pull/1808 first, then merge/publish
  this app PR. Current deployed Rome uses a strict schema and rejects the new
  field. This PR remains draft until the platform support merges.
- Do not install this manifest on the current live runtime. No app-wide
  sharing setting changes are needed.

## Validation

- App typecheck: passed.
- App production build: passed.
- Workspace typecheck: passed. Full source suite: 59 files, 495 tests passed
  (`pnpm exec vitest run --exclude '**/.rome/**'`; exclude the generated
  install artifact so its bundled tests are not counted a second time).
- Built handler smoke with real GitHub and an in-memory DB: public 200,
  unknown repo 404, dashboard 403. No installation needed for that test.
- App tests: 16 files, 149 tests passed, including 36 new access/projection cases.
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

## Companion platform verification

- The platform worktree declares `web.publicPaths` using the existing exact and
  prefix pattern contract. Caddy gates app documents and the manifest GET/HEAD
  is admitted only for a matching requested page. Dashboard-side data APIs stay
  closed. The caller stays anonymous and app-wide access stays private.
- Local Chrome plus real Caddy, changed core, this app bundle and an in-memory
  DB: the exact history path loads anonymously, redirects to standalone, and
  shows sanitized history without guardian controls or page errors. The verify probe denies sibling
  pages with 401. Caddy returns only the generic public shell for sign-in on
  denied documents. Private rendering manifests, dashboard-side data and
  manifest POST still return 401.
- Checked desktop 1280×900, phone 390×844 and narrow 320×800 with no horizontal
  overflow. No new live install or sharing change was used for this check.
- Merge order: platform #1808, then app #39. Keep #39 draft while the strict
  deployed runtime cannot accept this manifest.
