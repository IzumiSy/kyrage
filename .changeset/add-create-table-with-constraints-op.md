---
"@izumisy/kyrage": minor
---

Optimize table creation by merging constraints into `CREATE TABLE` statements

Kyrage now automatically combines table creation with primary key and unique constraints into a single `CREATE TABLE` statement, reducing the number of SQL operations and improving migration performance.

**Before:**
```sql
CREATE TABLE "users" ("id" integer, "email" varchar);
ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
```

**After:**
```sql
CREATE TABLE "users" (
  "id" integer,
  "email" varchar,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_unique" UNIQUE ("email")
);
```

This optimization happens automatically when generating migrations - no changes to your schema definitions are required.
