# kyrage

[![Test](https://github.com/izumisy/kyrage/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/izumisy/kyrage/actions/workflows/test.yaml)
[![NPM Version](https://img.shields.io/npm/v/%40izumisy%2Fkyrage)](https://www.npmjs.com/package/@izumisy/kyrage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.x-brightgreen.svg)](https://nodejs.org/)

> A minimal, schema-based declarative migration tool for Node.js ecosystem 

**kyrage (kirāju)** automatically generates and applies database migrations by comparing your TypeScript schema definitions with your actual database state. No more writing migration files by hand!

## Why kyrage?

Traditional database migrations require manually writing up/down migration files every time you change your schema. This is error-prone and time-consuming.

**kyrage** takes a different approach:
1. ✍️ Define your desired schema in TypeScript
2. 🔍 kyrage compares it with your actual database
3. 🚀 Automatically generates the necessary migrations
4. ✅ Apply migrations with a single command

This is a style of managing database schema that is called as [Versioned Migration Authoring](https://atlasgo.io/blog/2022/08/11/announcing-versioned-migration-authoring) by Atlas. 

## 📦 Installation

```bash
# Install globally
npm install -g @izumisy/kyrage

# Or use with npx
npx @izumisy/kyrage --help
```

## 🚀 Quick Start

### 1. Create Configuration File

Create a `kyrage.config.ts` file in your project root:

```typescript
import { defineConfig } from "@izumisy/kyrage";

export default defineConfig({
  database: {
    dialect: "postgres",
    connectionString: "postgres://postgres:password@localhost:5432/mydb",
  },
});
```

### 2. Define Your Schema

Create your table definitions (e.g., in `schema.ts`):

```typescript
import { column as c, defineTable as t } from "@izumisy/kyrage";

export const members = t(
  "members",
  {
    id: c("uuid", { primaryKey: true }),
    email: c("text", { unique: true, notNull: true }),
    name: c("text", { unique: true }),
    age: c("integer"),
    createdAt: c("timestamptz", { defaultSql: "now()" }),
  },
  (t) => [
    t.index(["name", "email"], {
      unique: true,
    }),
  ]
);

export const posts = t(
  "posts",
  {
    id: c("uuid"),
    author_id: c("uuid"),
    slug: c("text", { notNull: true }),
    title: c("text"),
    content: c("text", { notNull: true }),
  },
  (t) => [
    t.primaryKey(["id", "author_id"]),
    t.unique(["author_id", "slug"], {
      name: "unique_author_slug",
    }),
  ]
);
```

Add your schema to the configuration:

```diff
import { defineConfig } from "@izumisy/kyrage";
+import { members, posts } from "./schema";

export default defineConfig({
  database: {
    dialect: "postgres",
    connectionString: "postgres://postgres:password@localhost:5432/mydb",
  },
+ tables: [members, posts],
});
```

### 3. Generate Migration

Compare your schema with the database and generate a migration:

```bash
$ kyrage generate
-- create_table: members
   -> column: id ({"type":"uuid","primaryKey":true,"notNull":true,"unique":false})
   -> column: email ({"type":"text","primaryKey":false,"notNull":true,"unique":true})
   -> column: name ({"type":"text","primaryKey":false,"notNull":false,"unique":true})
   -> column: age ({"type":"integer","primaryKey":false,"notNull":false,"unique":false})
   -> column: createdAt ({"type":"timestamptz","primaryKey":false,"notNull":false,"unique":false,"defaultSql":"now()"})
-- create_table: posts
   -> column: id ({"type":"uuid","primaryKey":false,"notNull":false,"unique":false})
   -> column: author_id ({"type":"uuid","primaryKey":false,"notNull":false,"unique":false})
   -> column: slug ({"type":"text","primaryKey":false,"notNull":true,"unique":false})
   -> column: title ({"type":"text","primaryKey":false,"notNull":false,"unique":false})
   -> column: content ({"type":"text","primaryKey":false,"notNull":true,"unique":false})
-- create_index: members.idx_members_name_email (name, email) [unique]
-- create_primary_key_constraint: members.members_id_primary_key (id)
-- create_primary_key_constraint: posts.pk_posts_id_author_id (id, author_id)
-- create_unique_constraint: members.members_email_unique (email)
-- create_unique_constraint: members.members_name_unique (name)
-- create_unique_constraint: posts.unique_author_slug (author_id, slug)
✔ Migration file generated: migrations/1755525514175.json
```

`generate` command will fail if there is a pending migration. Use `--ignore-pending` option in that case.

### 4. Plan Changes

You can use `apply --plan` beforehand to check SQL queries that will be executed in the next time:

```bash
$ kyrage apply --plan --pretty
create table "members" (
  "id" uuid not null,
  "email" text not null,
  "name" text,
  "age" integer,
  "createdAt" timestamptz default now ()
)
create table "posts" (
  "id" uuid,
  "author_id" uuid,
  "slug" text not null,
  "title" text,
  "content" text not null
)
create unique index "idx_members_name_email" on "members" ("name", "email")
alter table "members" add constraint "members_id_primary_key" primary key ("id")
alter table "posts" add constraint "pk_posts_id_author_id" primary key ("id", "author_id")
alter table "members" add constraint "members_email_unique" unique ("email")
alter table "members" add constraint "members_name_unique" unique ("name")
alter table "posts" add constraint "unique_author_slug" unique ("author_id", "slug")
```

### 5. Apply

If everything looks good, execute the generated migrations:

```bash
$ kyrage apply
✔ Migration applied: 1755525514175
```

**PROTIP**: You can also apply the changes immediately on generating migration: `kyrage generate --apply`

## 📚 API Reference

### Commands

| Command | Description |
|---------|-------------|
| `kyrage generate` | Compare schema with database and generate migration file |
| `kyrage apply` | Apply all pending migrations to the database |

### Configuration

Your `kyrage.config.ts` file supports the following options:

#### Database Configuration

```typescript
import { defineConfig } from "@izumisy/kyrage";

export default defineConfig({
  database: {
    dialect: "postgres" | "cockroachdb",  // Database dialect
    connectionString: string,             // Database connection string
  },
  tables: [/* table definitions */],
});
```

#### Table Definition

Use the `defineTable` function to define your database tables:

```typescript
import { column as c, defineTable as t } from "@izumisy/kyrage";

const tableName = t(
  "table_name",           // Table name
  {                       // Column definitions
    columnName: c("type", options),
    // ... more columns
  },
  (t) => [                // Optional: table constraints
    t.index(["col1", "col2"], { unique: true }),
    t.primaryKey(["col1", "col2"]),
    t.unique(["col1", "col2"], { name: "custom_name" }),
  ]
);
```

#### Column Definition

The `column` function accepts the following options:

```typescript
c("dataType", {
  primaryKey?: boolean,   // Creates a PRIMARY KEY constraint
  unique?: boolean,       // Creates a UNIQUE constraint  
  notNull?: boolean,      // NOT NULL constraint
  defaultSql?: string,    // Default SQL expression (e.g., "now()", "gen_random_uuid()")
})
```

#### Table Constraints

##### Indexes
```typescript
// Create a regular index
t.index(["column1", "column2"])

// Create a unique index  
t.index(["column1", "column2"], { unique: true })

// Create an index with custom name
t.index(["column1"], { name: "custom_idx_name" })
```

##### Primary Key Constraints
```typescript
// Single column primary key
c("uuid", { primaryKey: true })

// Composite primary key
t.primaryKey(["id", "tenant_id"])

// Custom constraint name
t.primaryKey(["id", "tenant_id"], { name: "pk_custom_name" })
```

##### Unique Constraints
```typescript
// Single column unique
c("email", { unique: true })

// Composite unique constraint
t.unique(["tenant_id", "slug"])

// Custom constraint name
t.unique(["tenant_id", "slug"], { name: "unique_tenant_slug" })
```

#### Constraint Naming Convention

kyrage automatically generates constraint names following these patterns:

- **Primary Key**: `{table}_{column}_primary_key` (single) or `pk_{table}_{columns}` (composite)
- **Unique Constraint**: `{table}_{column}_unique` (single) or `uq_{table}_{columns}` (composite)  
- **Index**: `idx_{table}_{columns}`

You can override these by providing a custom `name` option.

### Known Limitations

### Constraint Creation Strategy

Due to kyrage's internal diff detection design, **PRIMARY KEY and UNIQUE constraints are always created as separate `ALTER TABLE` statements**, not inline within `CREATE TABLE` statements.

**Example behavior:**
```sql
-- kyrage generates this:
CREATE TABLE "users" (
  "id" uuid NOT NULL,
  "email" text NOT NULL
);
ALTER TABLE "users" ADD CONSTRAINT "users_id_primary_key" PRIMARY KEY ("id");
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");

-- Instead of the more common:
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY,
  "email" text UNIQUE NOT NULL
);
```

## 🏗️ Examples

Check out the [examples/basic](./examples/basic) directory for a complete working example with:
- Configuration setup
- Schema definitions
- Generated migrations
- Applied database changes

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.
