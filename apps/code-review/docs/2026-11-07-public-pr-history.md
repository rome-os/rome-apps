# Public PR history boundary (0.43.0)

## Standard public-app model

Code Review uses Rome's existing app access mode, **Public**, not platform
per-page access. There is no manifest declaration for default access: the strict
manifest schema has no sharing/access field, and new instances default to Private.
No `web.publicPaths`, `api.noAuth`, relay webhook or separate public API transport
is needed. The SPA uses the SDK's normal `/api/apps/code-review` transport.

The API's first dispatch gate trusts only the host's `request.caller.kind`:
non-guardians can call **only exact `GET pr-history`**. All other routes/methods,
including future endpoints, return 403 before database reads, CLI calls, actions
or guardian-only startup reconciliation. Visitor sign-in is not owner access;
`requireVisitor` would be insufficient for these owner-only operations.

History authorization reuses the dashboard's visibility helper but forces a fresh
GitHub lookup. Only `visibility === "public"` allows the read; private, internal,
unknown and failed lookups all return 404 before reading history. Public lookups
share a 30/minute, two-concurrent subprocess budget (429 when saturated).

Public responses are explicit metadata projections with page-local IDs, fixed
statuses/lens labels/verdicts and same-PR GitHub links. They omit arbitrary stored
review/reply bodies, historical titles/requesters, errors, prompts, memory,
session references and task IDs (which can be bearer capabilities). Even local
completed review text need not match what was published to GitHub: follow the
verified GitHub links for full text. Unexpected public read errors are generic,
and responses use `Cache-Control: no-store`. Guardian history is unchanged.

The SPA reads `useCaller()` from the web SDK. Non-guardians on history pages get
no owner navigation, re-review, detail or session controls. Every other app page
shows **This page is private to the owner**, plus the SDK's `CallerBadge` sign-in /
visitor identity control. Public pages do not mount owner pages, fetch owner data
or read/write the dashboard cache. Visitor sign-in does not unlock owner pages.

## HTTP / webhook audit

`src/api/index.ts` is the app's sole HTTP handler. The manifest declares no HTTP
webhook, no `api.noAuth` paths, relay webhook, hooks or WebSocket handler. Both
host API transports reach the same structural gate; guessed `/webhook`,
`/webhook/github` and `/pr-webhook` paths are denied to anonymous/visitor callers.
App action artifacts are not HTTP routes and are not exposed by Public access.

GitHub deliveries enter **the connector app**, not Code Review:
`/api/app-api/connector/webhook` -> authenticated event bus -> routine ->
`code-review_pr-webhook` action. The connector's `handleGithubWebhook` rejects a
missing configured secret or invalid/missing `X-Hub-Signature-256` with 401,
verifies the raw body using Octokit's HMAC verifier, and deduplicates delivery
IDs before publishing. Code Review's action then applies repository/trigger
filtering. No new unsigned webhook exception is introduced here. Webhook
subscription/repair settings in this app remain behind the guardian gate.

## Safe deployment / owner step

1. Merge and install **0.43.0 or later** with the gates above. Keep access Private
   through installation and verification. There is no platform PR dependency.
2. Only afterwards, in Rome **Apps -> Code Review -> Access -> Public**.
   This is a one-time instance setting, not a per-repository opt-in. Public
   GitHub repositories then work by default; other repositories fail closed.
3. Share the existing GitHub footer link, e.g.
   `https://yunfan.romeos.cc/apps/code-review/pr/rome-os/rome/1804` (Rome can
   redirect to its standalone `/full/apps/...` view).

**Never make live 0.42.0 Public:** it lacks this route gate and would expose owner
APIs. No live sharing changes, publication or merge were made for this PR.
The superseded platform proposal is closed: rome-os/rome#1808.

## Validation

- App typecheck and production build; workspace typecheck and full source tests.
- App suite: 17 files / 151 tests. Full source suite: 60 files / 497 tests
  (`pnpm exec vitest run --exclude '**/.rome/**'` excludes install artifacts).
- Access tests enumerate every handler route, parameterized branch and root;
  all seven common HTTP methods are denied for anonymous and visitor callers
  except history GET. Includes unknown/retired/webhook/encoded paths and forged
  identity headers, with no database, CLI or action access.
- History tests cover case-insensitive repo matching, fresh visibility changes,
  unknown/private/internal/failure, invalid inputs, guardian payload preservation,
  generic errors, capability/secret projection and unsafe result links.
- Real-SDK private-screen render tests cover anonymous/visitor controls. React
  and ReactDOM are aligned to 19.2.6 with the SDK to avoid duplicate-React hook
  failures (caught during the local browser check).
- Local Chrome + real Caddy + unchanged deployed core + this app bundle + an
  isolated Public-mode fixture DB: exact history URL renders without login;
  anonymous/visitor sibling pages show the private screen, standard SDK sign-in
  degrades cleanly when unavailable, data APIs on both transports return 403,
  and history has no owner controls or private text. Desktop, 390px and 320px
  layouts checked. Bootstrap/health are fixture responses; actual Cloud OAuth
  was not exercised. No platform deployment or live sharing change was needed.
