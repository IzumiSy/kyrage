---
"@izumisy/kyrage": patch
---

Fix migration provider to use the acquired DB connection by Kysely migrator

Resolves issue where migration provider was not using the acquired DB connection passed to the Migration interface's up method, which is required for databases with connection limits like SQLite.
