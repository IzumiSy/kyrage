---
"@izumisy/kyrage": minor
---

Implement custom SQL introspector to get extra column information that kysely's builtin one does not help.

To keep the initial implementation focused, decided to drop `checkSql` support and narrowed dialect support to PostgreSQL for now.
