# Replay

Upload `trace.json` files downloaded from a chat turn and replay them
block-by-block in chat — reproducing the recorded assistant text, thinking, tool
calls and results, looking just like the original conversation.

Replay is **inert**: no model is ever called, no action is re-executed, nothing
touches the network or your data. A `tool_use` / `tool_result` is replayed as
recorded data, not run for real.

## How it works

1. **Upload** one or more `trace.json` files (the kind you download from a chat
   turn's trace drawer). The app parses each, extracts the original user prompt
   and a short summary, and stores it in your library.
2. **Order** the traces — add them to the replay queue and drag to set the
   order you want them to play in. Pick a playback **speed** (0.5×–10×) and a
   per-turn **typing cap**; once a turn has spent the cap on typing, the rest
   of it appears instantly.
3. **Replay in chat** — the app opens a fresh chat with the `replay` agent and
   plays each trace as its own turn. Every user bubble shows the real recorded
   prompt; the assistant side is re-emitted block by block with a typewriter
   feel.

Each downloaded `trace.json` is a single turn, so one trace = one replayed turn,
and multiple traces play as multiple turns in the order you set.

> A replay session is itself recorded as a new trace (it flows through the same
> pipeline a model turn does). Sub-agent grouping from the original is flattened
> onto the `replay` agent in this version.

## Recording a video

For a clean screen recording, turn on **Presentation mode** under Settings →
Advanced before starting the replay. While it is on, every chat renders with
the main assistant's identity — no "Replay" agent avatar, label, or composer
chip — so the playback is indistinguishable from a normal conversation. The
mode is cosmetic and per-browser; turn it off from the same page when you're
done. One caveat: don't open a turn's trace drawer while recording — it
truthfully shows the replay internals.

## Development

Replay is maintained in `rome-os/rome-apps` as an independently installed app.
The app ID (`replay`), agent ID (`replay:replay`), database table prefix, and
migration history match the bundled app in [Rome](https://github.com/rome-os/rome).

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @rome/app-replay typecheck
pnpm test -- apps/replay/
pnpm --filter @rome/app-replay build
pnpm --filter @rome/app-replay exec rome publish . --dry-run
```

The **Rome Publish** workflow offers `replay` in its app selector.

## Installation

Install Replay after upgrading to a Rome release that does not bundle it.
Rome protects bundled apps from replacement. When an upgrade removes a bundled
app, Rome retains its data. Installing this app with the same `replay` ID and
table prefix reuses that data. See Rome's
[app lifecycle contract](https://github.com/rome-os/rome/blob/main/docs/architecture/app-lifecycle.md#boot-convergence).
