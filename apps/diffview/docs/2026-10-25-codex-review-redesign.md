# Codex-style review workspace, Rome-native

## Brief / design authority
Reference image was inspected before editing. Preserve Rome tokens, kit controls, global language/theme, existing four-mode read-only Git behavior and URL/keyboard support. Replace the previous two toolbar rows and left tree with the pinned compact Changes-pane composition. Demo repository /home/rome/.rome/default/projects/rome is read-only test data; its fingerprint was recorded before work.

## Implementation
- Repo chip and scope/totals pill, base→target comparison popover, quiet icon cluster and overflow options; mobile keeps secondary actions in overflow.
- Right, keyboard/pointer resizable tree (220–420px, persisted), folder-chain compression, colored nonzero counters, current-file scroll-spy, dimmed viewed rows; drawer on narrow screens.
- Sticky compact file headers, file-type glyphs, muted directories / emphasized basename, viewed-and-collapse action, clipboard and file menu via kit portals in the app shadow root.
- Bounded incremental context fallback: Pierre 1.6.1 CodeView does not expose custom hunk slots and enabling full hydration on partial patches is unsafe without a loader. Style metadata separators into custom context bars and request larger git unified context, +20 lines at a time per file (both directional buttons broaden the patch symmetrically). Full-file menu requests up to 10,000 context lines, still subject to 8 MB cap. Exact tail line counts are read from bounded local git blobs, never sent as full blobs to the browser.
- 26px code rows, line gutters, token-derived success/destructive line and word tints and 3px categorical change rail. Shiki uses a custom CSS-variable theme, not a hardcoded syntax palette. Word diff is worker-backed and length-capped. Wrap toggle retained in overflow.
- Partial diff expandUnchanged remains false. No staged/index/worktree/credential writes added.

## Validation (updated after capture)
- Added unit tests for folder compression, scroll-spy offsets and incremental context limits.
- Before screenshots and demo fingerprint: projects/default/diffview-redesign/.
- First full implementation will be installed before visual inspection, followed by one batched corrective pass if needed.

## First inspection and batched corrections
- Installed 0e3d2ef (hash 18b10ff9…) and captured desktop light/dark + 375px together as round1-*.
- Corrected a shadow-boundary assumption: custom header slots actually live in the outer app ShadowRoot, so their layout now uses Rome/Tailwind utility classes directly. Per-file CSS is only for renderer-owned nested content.
- Pierre emits duplicate metadata separators in gutter/content columns: render only the up button in the gutter and text/down button in the content, preserving the narrow gutter and forming one continuous rounded bar. Matched hunk specs rather than indexing the doubled DOM list.
- Default collapse now includes untracked files above 2,000 lines; the 4,001-line demo file must not auto-load.
- P0 first redesign run: 2 workers, scroll p50 16.7 ms / p95 18 ms / max 37.6 ms, zero scrolling long tasks, zero errors. Highlight detector updated for CSS-variable tokens, and final scroll run will traverse the full taller 26px-row stream.

## Confirmation / functional follow-up
- Second desktop capture confirms continuous full-width context bars and compact 44px slotted headers match the pinned composition. All 54 demo files are listed, including the 4,001-line generated file as a deferred one-line row.
- Mobile confirmation found toolbar intrinsic sizing overflow (431px inside a 360px app canvas). Let the comparison pill shrink; secondary icon actions remain reachable from overflow.
- Updated installed runtime regression script for the new scope menu/popovers (old tab selectors are no longer valid), covering modes, split, per-file +20 context, viewed filter, resize and mobile/language/theme.

## Final local verification
- Installed runtime regression PASS: four-mode menu roundtrips (branch/uncommitted stress), split, captured per-file unified=23 requests, viewed/hide-viewed, keyboard resize, language/theme, mobile drawer; console/page errors 0. Mobile width overflow fixed by shrinking comparison pill.
- Final synthetic 200-file / 5,200-line check traverses the full 144,000px stream: 2 workers, text ~588ms before highlight ~981ms, scrolling p95 17.8ms / max 36ms, 0 long tasks, 0 errors. Evidence p0-after-repeat.json. A simultaneous cold/visual run recorded p95 21.4ms with three >50ms tasks (132/84/57ms); retain this outlier and do not claim universal zero long tasks or cold-start latency guarantees.
- Added/deleted line colors and all custom Shiki token colors derive from Rome semantic tokens. No new hardcoded palette.
- Screenshots: before-light.png / before-dark.png; after-light.png / after-dark.png; after-review-light.png / after-review-dark.png; after-mobile.png under projects/default/diffview-redesign.
- Semantics follow-up: comparison pills describe base→target for staging and PRs; keyboard hunk cursor ignores selections from another file.
- Independent clean-context verification follows this install; demo fingerprint comparison is saved with the screenshots.

## Independent findings and focused repair
- Clean-context verifier rejected the first final candidate: P1 actual code did not collapse despite aria/viewed updates; P2 a cold tree jump drifted when async patch heights replaced placeholders. All other requested structure/mode/context/theme/mobile checks passed, including real 3→23→43 context growth and generated/binary handling. Full evidence: independent-verification-report.md in screenshot directory.
- Root cause P1: Pierre 1.6.1 ignores a controlled item snapshot with unchanged explicit version. Derive the controlled version from patch version + collapsed bit, while keeping fileDiff/cache keys stable. Remove renderer-owned tail bars on collapse/unmount and update/remove tails when context changes. Regression now checks actual code-node count and 44px collapsed height, not just aria state.
- Root cause P2: a second 44px inset was incorrectly applied even though the toolbar is outside the scroll container; correct to 1px. Explicit file navigation holds a cancellable anchor across lazy patch/prefetch layout updates, and releases after the queue settles or immediately on user wheel/touch/pointer/hunk-navigation input.
- Basename-preserving truncation uses an LTR-isolated path inside a right-overflow ellipsis container.
- Verifier confirmed demo/fixture content, staged entries and refs remained unchanged after handoff. It noted its initial ordinary git status may have refreshed index stat cache metadata; no stage/revert/fetch or credential operation was performed.

- Runtime regression also preserves pre-existing viewed marks rather than assuming an unviewed fixture.

- Header/menu accessible expand/collapse labels now reflect the same controlled collapse state as CodeView, rather than the obsolete Loaded.collapsed field.

- Cold navigation corrects estimated offsets against the rendered item rectangle after layout and on queue quiet; scroll-spy likewise uses visible rendered positions so custom context footer height cannot bias it.
