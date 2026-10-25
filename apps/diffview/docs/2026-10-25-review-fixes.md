# PR #28 review corrections

Baseline: automated reviews of `7527ab4`. The ten inline findings contain one
duplicate, so this follow-up addresses nine distinct issues. This branch also
retains the separately developed conversation-scroll and flat-scope features.

## Correctness and recovery

- Views resolve a comparison once and retain its immutable Git endpoints/arguments.
  The file list, stored snapshot, deferred page and expanded single-file patch all
  consume that same resolution. Branch/PR/ref/commit/upstream movements contribute
  to the comparison fingerprint; remote fallback diff **content** contributes too.
  The old five-second replacement of a view under the same identity is removed.
- An evicted old view can be rebuilt only if the requested fingerprint still
  matches. Otherwise the API returns `409 stale_view`; the client resets the list
  and retries from a fresh view instead of labelling new patches as old content.
- PR fetches atomically update both base and head under
  `refs/diffview/pulls/<number>/{base,head}`. `--refmap=` prevents opportunistic
  remote-tracking updates; branches, index, working files and FETCH_HEAD remain
  untouched. This new namespace does not collide with the legacy single-ref
  `refs/diffview/pr/<number>`. A failed fetch uses `gh pr diff`, never a stale
  local base. An empty fallback is a valid empty diff.
- Successful PR resolutions have a sixty-second TTL; pending calls share one
  request. Rejections are not retained. The explicit Refresh command sends
  `refresh=1`, bypasses settled PR-cache entries, and requests a complete list.
- View-cache accounting handles both fulfillment and rejection on the observer
  chain and deletes only the matching failed entry. The HTTP error handler is
  not incorrectly relied on to catch a derived observer rejection.
- Both snapshot and paged paths hydrate lazy untracked patches. Actual hydrated
  patch bytes are checked against the page budget, and the cursor advances only
  over delivered files. Large single-line files cannot inflate a 150-file page.

Commit endpoints are immutable. Working-tree/index content is inherently mutable:
this is not a persistent filesystem snapshot service. Ordinary polling refreshes
those views; reliable conversation-turn snapshots remain a separate platform need.

## Cache isolation and maintenance

Small metadata (64 entries / 4 MiB estimated retained text), page/patch payloads
(32 entries / 32 MiB) and PR resolutions (6 entries / 32 MiB) use independent LRU
caches. They retain single-flight and metadata stale-while-revalidate behavior.
Both count and byte limits apply; oversized results are returned but not stored.
Text accounting includes serialized UTF-8, UTF-16 and a fixed per-entry allowance;
it is a conservative estimate, not a precise V8 heap measurement.

The React-fiber/private-host-store bridge is removed. Standalone file opening
uses the public host navigation event. In an embedded chat view the file menu
exposes an ordinary **Open in new tab** project link with `noopener noreferrer`.
It does not navigate the iframe away or mutate host state. A supported SDK method
for selecting a file in an already-open Projects widget was requested through
platform feedback; do not reintroduce private React traversal as a workaround.

Retired `p0.mjs`, `spike-server.mjs` and `smoke-fixture.mjs`: they were one-off
bench/fixture scripts, not portable tests. Existing production worker/scroll/menu
regressions supersede them. Every supported browser regression has a package
script and uses Playwright's installed Chromium or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, never a hard-coded executable.

## Regression coverage

```sh
pnpm typecheck
pnpm test --maxWorkers=2
pnpm --filter @rome/app-diffview test:browser
```

`tests/review.test.ts` uses disposable Git repositories, a local bare remote and
fixture-only fake `gh` output. It covers failed view-build rejection/retry,
base-only movement, conditional refresh, old cached/uncached pages and expanded
patches, byte-bounded lazy untracked pages, stale-view eviction, PR base refresh,
legacy-ref migration, explicit refresh, TTL polling, immediate failure recovery,
fallback versioning, and empty fallback diffs. It checks user refs/index/status
where applicable. `tests/cache.test.ts` covers LRU/count/byte limits, oversize
admission, single-flight, forced refresh, rejection retry, SWR recovery and actual
production metadata/payload isolation.

The production menu regression additionally checks safe project links in
standalone/447px iframe, client recovery from a 409 patch response, and the
server-side intent on explicit refresh. Worker isolation and conversation-scroll
regressions remain mandatory. These are deterministic fixture tests, not a
long-duration memory soak or a substitute for testing an installed artifact.

Manual refresh also cancels an in-flight list load before re-fetching, so query
invalidation cannot silently reuse a request without explicit refresh intent.
Late page/patch successes are ignored when their fingerprint no longer matches
the active list.

Validation on 2026-10-25: workspace typechecks passed; repository Vitest passed
40 files / 280 tests. Production worker tests passed standalone and iframe,
conversation-scroll regression passed, and the menu/link/stale-view/refresh
regression passed at 360/447/1100px. The initial fixture run was red on five
correctness regressions; those regressions pass with the fixes.
