# Worker error feedback loop (2026-10-25)

## Symptom and reproduction

Opening Diff in a chat sidebar can produce an unbounded stream of
`Worker error: Error: Unknown request type: error`, continuing after the app
closes. The guardian's stack points at `worker~0.js:1:35152` and `:1:35386`.
A browser test against the original production bundle reproduced those exact
positions. One Window message seeded 21 reflected error messages before the
harness's safety cap intervened, and another message still triggered the
handler after unmount.

## Cause

The modular `@pierre/diffs/worker/worker.js` entry was also emitted as a shared
chunk exporting utility symbols. UI chunks imported that worker entry (e.g.
`b~0.js` imported its `__webpack_require__`), executing the worker's top-level
`self.addEventListener('message', ...)` in Window. A host message was treated as
a worker request, failed, and posted an error response back to Window. The same
listener consumed its own response and repeated forever. This is a message and
logging feedback loop, not merely slow GC or a cache leak.

The real worker pool does terminate correctly on unmount. Its cleanup cannot
remove the unrelated top-level Window listener, which explains why closing the
app did not stop logging. The old five-minute standalone memory experiment did
not exercise an incoming host message and could not rule out this failure.

## Fix

Use Pierre's self-contained `worker-portable.js` entry. Its dependency code is
already bundled and cannot be hoisted into a UI-to-worker-entry shared import
by Rslib. Keep highlighting on two real workers; do not filter console errors
or disable highlighting. No additional manual pool cleanup was needed.

Existing pages must be fully reloaded after deployment: replacing/unmounting
the app cannot unregister the old anonymous Window listener.

## Regression

`pnpm test:worker` builds the production bundle then runs Playwright against a
local static server. Install a Playwright Chromium, or supply an existing binary
with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome`.

The test covers a standalone mount and a 447x660 iframe/sidebar-shaped mount,
normal Window messages, real worker initialization/highlight success, unmount,
post-unmount messages, and three repeated mount/unmount cycles. An intentional
error-response cap makes a regression fail rather than OOM the test runner.
Before: 21 error responses from one host message and further responses after
close. After: zero console errors, zero reflected error responses, two active
workers with highlight replies, zero workers after close in both contexts.
The 58 existing tests and TypeScript check also pass.

This isolates the reported error-loop mechanism. It is not a claim that all
possible memory or scrolling issues in a long real chat have been eliminated.

## Installed-runtime check

Reinstalled via `system:app_management` (bundle hash prefix `d1715d3f`). In a
separate local test browser, the actual `/apps/diffview?p0=1` page initialized
and highlighted with two workers, accepted a host global-params message without
reflection, and released both workers on soft navigation to `/apps`. Two
successive 447x660 iframes loading the actual `/full/apps/diffview?p0=1` endpoint
also highlighted correctly with zero reflected errors. Console/page errors: 0.
This is a controlled runtime check, not the guardian's original long chat.
The SDK module-graph isolation issue was reported via `system:send_feedback`.
