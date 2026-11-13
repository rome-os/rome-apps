# Agent comparison surfaces

Diffview remains a read-only Git browser. Actions never checkout, stage, reset, fetch, move a conversation between projects, or change an agent process's working directory.

## Actions

All three actions accept an absolute local repository/worktree root in `repo`, within the existing Rome projects access boundary. They canonicalize and validate both repository and Git-directory paths. No caller-supplied chat identifier is accepted: the action uses trusted guardian invocation context.

```json
{"repo":"/absolute/rome/projects/example","kind":"workspace","filter":"all"}
```

Workspace `filter` is `all` (default), `staged`, or `unstaged`. For arbitrary local commit-ish refs:

```json
{"repo":"/absolute/rome/projects/example","kind":"refs","base":"main","target":"release/v2","dots":"three"}
```

`dots: "two"` directly compares the resolved commits; `"three"` compares their merge base to the resolved target. Input refs resolve to fixed SHAs. No fetch is performed. Missing refs or disallowed paths return structured errors.

- **select_view** updates only the current trusted conversation, including a sidebar that is already open and a sidebar opened later. Returns the conversation id, persisted revision, comparison state, and `focusChanged: false`. It does not force-open a surface.
- **inspect** returns sampled metadata without changing selection or showing a card. It also works when no conversation UI exists.
- **show_card** persists a summary and returns the registered `comparison-card` message component plus the same metadata for non-UI consumers. Sending a card does not alter selection. Opening it selects the server-owned comparison in its original conversation, or opens a standalone view when no conversation was bound.

## State ownership and races

App-owned SQLite stores per-conversation selection and monotonic revisions. An Agent selection uses compare-and-swap against the revision captured before async repository/ref resolution. Manual UI changes are serialized. The browser rejects polls made before newer manual intent, obsolete revisions, and responses belonging to a previously bound conversation. Repository, comparison and scroll remain conversation-specific; display preferences remain global.

The app API is guardian-only. A card-open request cannot replace the stored target/chat by injecting a POST body. Failed selection synchronization is visible; a failed manual write is not silently overwritten by a later poll.

## Cards and data semantics

The compact card has four rows: repository/open affordance, branch or comparison identity, file/addition/deletion summary with proportional rail, and nonzero workspace status/sample time/details. The whole card opens the review; its separate details button does not. It inherits Rome theme and language. Long names truncate rather than wrap; large counters compact on the face while exact values remain in details.

Historical-ref cards pin commit SHAs, including the actual merge-base SHA where applicable. Workspace cards are **sampled records, not immutable snapshots**: opening reads the live workspace. Added/deleted line totals exclude untracked contents. Status reports the full workspace (counts can overlap), while the aggregate follows the selected filter. Sample time and sampling instability/conflicts remain inspectable. Zero counts do not consume default-face rows.

Bulk Git computation stays in the backend with existing size caps/paging; no per-file frontend request fan-out is introduced. Existing HEAD/index/worktree/unpushed/branch/PR behavior is retained when the explicit `toRef` historical target is absent.

## Verification

- Unit coverage includes context/path/ref validation, symlink/worktree boundaries, arbitrary ref comparison and merge-base semantics, multi-worker persistence/CAS, stale poll/manual races, and compact-card presentation.
- `pnpm test:agent-browser` builds and exercises the registered component/sidebar against temporary Git repositories and isolated SQLite. It covers Default cross-directory selection, two conversations, open/closed sidebars, host-context rebind, manual races, ref pinning, card navigation/details, narrow widths, locale/theme, huge counters, warning/error/loading and keyboard behavior.
- The test-only Ember fixture supplies inherited host tokens; the production App does not import or override that fixture.
- The published runtime SDK currently lacks a `show_widget` result type supported by the host. `agentAction.ts` keeps a narrow explicit compatibility envelope rather than pretending a card is a suspendable user-input interaction.
