# TikHub app database

Persistence is **enabled and required** by this app's existing `db:` manifest block.
The runtime owns the app connection and applies the migrations on installation.
Do not disable the schema or manually copy settings while moving the source tree.

## App-owned tables

- `tikhub__settings`: the app's API Key, base URL and request tuning. The Key is
  stored as plaintext locally; masked output is not encryption. Use the app's
  Settings UI rather than reading or migrating credential values through an agent.
- `tikhub__cache`: cached public OpenAPI and pricing documents, plus bounded
  request-slot/concurrency coordination state.
- `tikhub__calls`: data-call attempts and local rejection/preview records,
  structured errors, bounded redacted previews and estimated/unknown fees.
  Anonymous metadata, account and usage queries are not included in this ledger.

These are instance-level app tables, not a multi-user credential or quota store.

## Existing migrations

- `0000_mature_gabe_jones.sql`: initial settings/cache/call schema and indexes.
- `0001_fat_wallop.sql`: adds `error_json` for language-neutral error rendering.

The import does not add another migration or rewrite existing data. Legacy call
previews are safely projected on read; that is not physical erasure of old rows.

## Development

Edit `schema.ts`, then run `pnpm db:generate` for a future schema change. Review
generated SQL and add a new migration; never rewrite an already-applied migration.
Run migrations only through the supported app lifecycle, not by editing a live
database. Offline tests create an isolated Node SQLite database using this schema;
they never inspect production settings, account data or credentials.
