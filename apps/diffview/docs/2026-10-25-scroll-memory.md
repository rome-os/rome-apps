# Conversation-scoped scroll memory (0.2.0)

Diff remembers the review pane's vertical reading position in this browser.
Each conversation has separate positions for each repository/comparison
(all/staged/unstaged, PR, or ref/target/dot mode). A standalone page and an
unbound iframe use separate fallback scopes. This is local browser persistence,
not cross-device synchronization or a new server/database record.

A position stores the visible file path, offset below its header, and logical
scrollTop. Restoring a file-relative anchor avoids relying on the heights of
previous lazy-loaded files. If that file no longer exists, restoration falls
back to the top rather than navigating to an unrelated file.

Restoration waits for a real viewer instance and a file list. It uses the same
navigation intent as file selection, preserves it while patches and reveal
batches settle, and leaves enough trailing headers to avoid a false end-of-list
scroll clamp. Wheel, touch and pointer input cancel alignment. A viewer remount
(e.g. locale/context changes) can restore from the latest position again.

Scroll samples are buffered with a 250ms write throttle. Pending samples flush
on unmount, pagehide and backgrounding. Initial scroll events from a new viewer
cannot overwrite the saved anchor before restoration; delayed events from a
previous instance cannot update the next instance's journal. Each conversation
retains at most 12 comparison positions. Storage contains only small numeric/
path anchors, never DOM objects or diff contents. Corrupt or blocked storage is
ignored without breaking the review UI.

## Checks

- Unit tests cover conversation/repo/comparison isolation, canonical comparison
  keys, zero positions, bounded history, invalid data and unavailable storage.
- `pnpm --filter @rome/app-diffview test:scroll` builds the production bundle and
  runs a controlled browser regression with delayed file lists and lazy pages.
  It covers reload, close before throttle expiry, session switching without an
  iframe reload, distant-file anchors, comparison roundtrips and deleted files.
- The separate Worker production regressions remain enabled via `test:worker`.
