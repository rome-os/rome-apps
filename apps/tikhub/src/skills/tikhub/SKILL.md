---
name: tikhub
description: Use TikHub app actions for public social-media data, endpoint discovery, prices, account status or single-video parsing. Requires a host-verified guardian private context; private credentials and mutating operations are unsupported.
tools: []
---

# TikHub

Use only the app actions. Never ask for, print or move the guardian's API key, cookies, passwords or other authentication values. The existing app setting injects the key server-side.

## Workflow

1. Find an endpoint with `tikhub:tikhub_search_endpoints`, using platform and English keywords. Public catalog lookup is free.
2. Read its contract and **current base price** using `tikhub:tikhub_inspect_endpoint`. Prices vary; $0.01 is not a cap (some documented batch endpoints are $0.25). Discounts and actual settled spend may differ.
3. Call `tikhub:tikhub_call` only for supported public GET/POST reads. A frozen local policy prevents refresh from enabling new provider operations automatically. Unknown paths/methods, stale contracts, missing current prices, deprecated operations, private credentials and account mutations are refused. `confirm` is a deprecated ignored flag, not approval. Do not retry a blocked call by setting it.
4. Use `dryRun: true` to validate and preview without a data request. Do not put authentication values into inputs; even rejected action arguments can be recorded by the host before app code runs.
5. Obtain explicit authorization for paid calls, including the endpoint, quantity and current estimated budget, before sending them. Stay within that scope; no call-count threshold grants a spending allowance. Paginate deliberately using returned cursors, only within the authorized quantity and budget. No automatic pagination is performed.
6. Report the endpoint, attempts, base estimate, unknown cost count and truncation. The call log is a bounded redacted preview, not a full response backup.

Actions reject visitor/group/unattributed contexts. If the host or a delegation chain cannot supply a verified guardian actor, explain that the action is unavailable; do not bypass identity through loopback or another tool. Autonomous tasks without that attribution are not enabled by this version.

## Errors and retries

- Data and account requests are sent once, including HTTP 429/5xx. A timeout, lost response, size limit or refused redirect may mean `outcomeUnknown: true`: check usage before asking whether to send again. Never silently replay an unknown outcome.
- Only the fixed anonymous metadata GETs may retry, within bounds and respecting Retry-After. No credentials/body are forwarded through redirects.
- 401: key status problem; 402: insufficient balance; 403: scope/account restriction; 422: provider validation rejection. Do not request key contents in chat.
- Missing key: direct the guardian to [Settings](/apps/tikhub/settings), without assuming an already-configured key is missing merely because a call failed.

## Shortcuts

- `tikhub:tikhub_parse_video`: one Douyin/TikTok share link, currently about $0.001, not a free preview.
- `tikhub:tikhub_account`: balance/status/usage metadata, currently zero-price; user/key metadata is projected to necessary fields, daily usage is size-bounded, and local spend is estimated. Account-info and daily-usage paths are refused by generic `tikhub_call`; always use this dedicated action.

Use `https://api.tikhub.io`. The `.dev` host is legacy compatibility, not the recommended mainland-China route.
