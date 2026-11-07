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

## Public payload: published text, not agent output

Public responses are explicit field projections (no DB/provider row spreads).
After the fresh public-visibility check, the reader fetches the PR-scoped GitHub
reviews, inline comments and issue comments. It matches only validated same-PR
GitHub result URLs stored on completed runs/tasks. It **never** falls back to
local text. This also restores old assistant/summary replies whose local results
stored only a URL. Missing/deleted content stays absent; superseded reviews show
GitHub's current superseded notice, not an unverified historical local copy.

| Field / source | Visitor decision and publication evidence |
| --- | --- |
| Review body/summary/verdict | Current submitted GitHub review body, or legacy issue-comment body, matched by the stored result URL. `pr-review/postInlineReview` publishes a cleaned summary, verdict/reason, findings table and footer. Pending GitHub drafts are excluded. |
| Inline findings | GitHub inline comments associated with that submitted review: explicit path, current/original line, body (including posted severity/category/title) and validated GitHub URL. Deleted/unposted inline comments never appear. |
| Bot conversation reply | Current GitHub issue/inline comment body matched to a completed task's result URL. Inline replies must belong to a submitted review. `pr-assistant` posts `### Assistant` + reply; `pr-summary` posts `renderComment(output, meta)`. |
| Memory-update acknowledgement | Only the GitHub comment (`note`) from `update-project-memory`. Its local `resultRef.body` appends **unpublished project memory**; that body, `editId` and other result keys are never copied. |
| Local `reviewComment` / `resultRef.body` | Never copied. `buildWebUIComment` can retain raw fallback output and unposted finding bodies; failed reviews store errors in the same column. A completed status or valid-looking link alone is not publication proof. Failed/local/unpublished runs show status only. |
| Request text / requester / PR title / author / head SHA | Continue to omit historical stored values (could originate from manual/local calls). No arbitrary local request text is exposed. |
| Status, intent, lens, timestamps | Existing fixed status/intent enums, built-in lens labels and run timestamps; custom names/instructions remain hidden. |
| Prompts/instructions, memory, guidance/settings, raw transcript, session refs, errors/logs/stacks | Always omitted/null. Never returned via fallback or generic error responses. |
| Internal review/task/edit/trigger IDs and bearer tokens | Never returned; review/task keys are page-local (`review-N`, `mention-N`). Published GitHub anchors are public links, not internal action capabilities. |

All GitHub subprocesses, including content pagination, share the existing
**30/minute, two-concurrent** budget. Reads are sequential; every page reacquires
the budget. Saturation returns 429 + Retry-After, not partial content. Pages use
100 entries, a 10-page cap per collection, 10-second timeout and 4 MiB output
limit per subprocess; malformed/incomplete/oversized provider reads fail closed.
Unexpected public errors are generic and responses are `Cache-Control: no-store`.
Guardian API payloads remain unchanged. Both callers use the same timeline,
markdown, expansion and All/Reviews/Comments tabs with counts from returned rows;
visitors have no owner actions or detail/session/settings navigation.

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

## Follow-up validation (published review details)

- App typecheck and build passed. Source app tests: **18 files / 164 tests**;
  includes public projection bodies/findings/replies, unpublished/local/failed
  output, pending drafts, unsafe/off-PR links, pagination and shared content-page
  budget saturation. The exact requested Vitest command also tests generated
  `.rome` copies; source-only count excludes those artifacts.
- Chrome + isolated core/Caddy/fixture GitHub reader, using this worktree's fresh
  bundle: anonymous and visitor render full published markdown, inline path/line/
  severity and bot replies; All 2 / Reviews 1 / Comments 1 tabs filter correctly;
  individual and bulk expand/collapse work. No owner controls, private fixture
  text or obsolete GitHub-only note. Desktop, 390px and 320px have no horizontal
  overflow or page errors; sibling pages stay private and owner APIs return 403.
- This follow-up does not install, publish, merge or change live app access.

## Original boundary validation

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
