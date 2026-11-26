# Lark app database

Rome applies the migrations in this directory when it installs the app. The database stores app preferences, local CLI invocation metadata and setup job state. CLI writes reserve the request ID and parameter fingerprint before calling the provider. Core maintains the execution and approval records for managed operations.

Run `pnpm db:generate` from the app directory after changing the Drizzle schema. Add a migration for each schema change so existing installations can upgrade.
