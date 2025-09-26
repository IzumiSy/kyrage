---
"@izumisy/kyrage": minor
---

Add foreign key constraint merging to table creation operations with inline control option

Kyrage now automatically merges foreign key constraints into `CREATE TABLE` statements alongside existing primary key and unique constraints. This reduces SQL operations and improves migration performance. Added `inline` option to schema builder's `reference()` method for fine-grained control over constraint merging.

**Example schema with inline foreign key:**

```typescript
import { column as c, defineTable as t } from "@izumisy/kyrage";

const users = t("users", {
  id: c("uuid", { primaryKey: true }),
});

const posts = t("posts", {
  id: c("uuid", { primaryKey: true }),
  userId: c("uuid"),
}, (t) => [
  // Merged into CREATE TABLE (default: inline: true)
  t.reference("userId", users, "id"),
]);
```

**Example with separate constraint:**

```typescript
const posts = t("posts", {
  id: c("uuid", { primaryKey: true }),
  userId: c("uuid"),
}, (t) => [
  // Separate ALTER TABLE statement
  t.reference("userId", users, "id", { inline: false }),
]);
```
