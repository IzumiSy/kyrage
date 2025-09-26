---
"@izumisy/kyrage": patch
---

Table operations are now sorted to always respect foreign key and other dependency relationships. Independent tables are ordered alphabetically, ensuring stable and predictable output for migrations and SQL generation.

**Example:**

```typescript
import { column as c, defineTable as t } from "@izumisy/kyrage";

const users = t("users", {
  id: c("uuid", { primaryKey: true }),
  name: c("varchar"),
});

const posts = t("posts", {
  id: c("uuid", { primaryKey: true }),
  userId: c("uuid"),
  content: c("text"),
}, (t) => [
  t.reference("userId", users, "id"), // posts depends on users
]);

const categories = t("categories", {
  id: c("uuid", { primaryKey: true }),
  label: c("varchar"),
});
```

The generated SQL will always be:

```sql
CREATE TABLE categories (
  id uuid PRIMARY KEY,
  label varchar
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  name varchar
);

CREATE TABLE posts (
  id uuid PRIMARY KEY,
  userId uuid,
  content text,
  CONSTRAINT posts_userId_fkey FOREIGN KEY (userId) REFERENCES users(id)
);
```
