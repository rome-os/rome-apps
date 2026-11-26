# Core-managed Docx reads, candidate 0.3.0

The managed path now uses Runtime SDK 0.11.3 and ctx.connections instead of the private Feishu HTTP broker. It supports docs.fetch as bot, with scope full, and returns bounded plain text. Docx links normalize to IDs before the Core resource check. Other managed operations, user identity and managed writes fail closed. Provider scope inventory is explicitly unknown.

Core owns the Feishu connection, operation execution, per-App grants, resource constraints and sanitized audit. App connection discovery uses paginated SDK lists; the guardian manages grants in Core settings. Managed reads do not call the independent CLI or store document content in the App database. SDK error detail is validated structurally because host and App can load separate SDK copies.

The unused delegated CLI runner and auth-proxy injection have been removed from the managed execution path. The independent CLI mode retains its existing reviewed operations and approvals, but is not a fallback. Historical v0.2.0 synthetic acceptance remains historical evidence, not a description of this candidate.

This iteration is source/build/test only. No live profile install, provider authorization, real document access, write or public release has occurred. Full installation and real-account acceptance remain separate steps.
