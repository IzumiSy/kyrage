---
"@izumisy/kyrage": patch
---

Fix pending migrations check to use the same database client as migration generation.
This resolves logical inconsistency between dev and production modes.
