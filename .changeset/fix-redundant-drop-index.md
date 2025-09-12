---
"@izumisy/kyrage": patch
---

Fix redundant DROP INDEX operations when dropping constraints

Prevents "index does not exist" errors by filtering out redundant DROP INDEX operations that would fail due to automatic index deletion when dropping unique or primary key constraints. This commonly occurs in PostgreSQL and MySQL where dropping a constraint automatically drops its backing index.

**Example:**
```sql
-- Before: This would fail with "index does not exist"
DROP CONSTRAINT uk_users_email;  -- Automatically drops the index
DROP INDEX uk_users_email;       -- ERROR: index no longer exists

-- After: Redundant DROP INDEX is automatically filtered out
DROP CONSTRAINT uk_users_email;  -- Index automatically deleted
-- DROP INDEX uk_users_email;    -- Filtered out, no error
```
