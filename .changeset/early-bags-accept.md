---
"@izumisy/kyrage": patch
---

Fix CockroachDB dialect

The changes that fix CockroachDB dialect includes the update for internal introspection mechanism that filters out auto-generated indexes and uinque constraints, which leads to unwanted diff between the database and user-defined configuration.
