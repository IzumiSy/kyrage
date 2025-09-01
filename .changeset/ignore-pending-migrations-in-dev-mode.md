---
"@izumisy/kyrage": patch
---

Allow pending migrations in dev mode for consistent migration generation. When using `--dev` flag, pending migrations are now ignored and automatically applied as baseline, ensuring dev database consistency with production behavior.
