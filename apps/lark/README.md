# Lark

Lark 0.4.0 connects Rome to Feishu documents, Drive, Wiki, Base, Sheets, calendars and chat history. In the command catalog, select a Rome Feishu connection to use its bot. The app checks the specific operation grant and sends each request through Core with the app identity. Open the connection inspector to query tenant scopes.

For document creation, updates and event creation, Core binds the approval to the connection, exact input and request ID. Review the request in Rome Activity. If the outcome is uncertain, inspect the target in Feishu before taking further action.

The independent official CLI supports user authorization for document search, message search and sending as the user. Select **local-cli** for these commands. Its write action requires Rome approval and reserves each request ID in the app database.

See the [agent skill](src/skills/lark/SKILL.md) for command mappings and the handling of approvals, duplicates and uncertain outcomes. Files in `docs/` record historical standalone trials.
