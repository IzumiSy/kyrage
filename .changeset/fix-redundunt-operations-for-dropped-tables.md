---
"@izumisy/kyrage": patch
---

Fix redundant operations for tables being dropped

Prevents unnecessary operations and potential errors when tables are dropped by filtering out all operations that affect tables marked for deletion. When a table is dropped, all related operations (ALTER TABLE, DROP INDEX, constraint modifications) become redundant since the table deletion automatically removes all associated objects.

**Example:**
```sql
-- Before: These operations would be unnecessary or cause errors
ALTER TABLE users ADD COLUMN email VARCHAR(255);  -- Unnecessary
DROP INDEX idx_users_name;                        -- Unnecessary
DROP TABLE users;                                 -- The actual operation needed

-- After: Only the essential operation is performed
DROP TABLE users;
```
