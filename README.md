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
    t.reference("author_id", members, "id", {
      onDelete: "cascade",
      name: "posts_author_fk"
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
-- create_foreign_key_constraint: posts.posts_author_fk (author_id) -> members (id) ON DELETE CASCADE
✔ Migration file generated: migrations/1755525514175.json
```

`generate` command will fail if there is a pending migration. Use `--ignore-pending` option in that case.

**PROTIPS:** 

* Kyrage has built-in mechanism to spin up ephemeral database for development as Docker container that can be used as `kyrage generate --dev` command. See [Dev Database](#dev-database) for more detail.
* If you iterate multiple schema changes during feature development and want to organize them before applying, kyrage can squash migrations by `kyrage generate --squash`. See [Squash Migrations](#squash-migrations) for more detail.

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
alter table "posts" add constraint "posts_author_fk" foreign key ("author_id") references "members" ("id") on delete cascade
```

### 5. Apply

If everything looks good, execute the generated migrations:

```bash
$ kyrage apply
✔ Migration applied: 1755525514175
```

## Dev Database

kyrage supports generating migrations against ephemeral development databases using Docker containers that is pretty much similar to the concept of [Atlas's Dev Database](https://atlasgo.io/concepts/dev-database).

The dev database will:

1. Start a fresh container with your specified database image (or reuse existing one)
2. Apply all existing migrations to establish the current baseline
3. Compare your schema against this clean state
4. Generate the migration file
5. Optionally maintain the container for subsequent operations (with `reuse: true`)

```bash
# Generate migration against a clean dev database
$ kyrage generate --dev
🚀 Starting dev database for migration generation...
✔ Dev database started: postgres
-- create_table: users
   -> column: id ({"type":"uuid","primaryKey":true,"notNull":true})
   -> column: email ({"type":"text","notNull":true,"unique":true})
✔ Migration file generated: migrations/1755525514175.json
✔ Dev database stopped
```

This is useful when you want to generate migrations without affecting your production database state.

#### Container Reuse Feature

kyrage automatically detects and reuses development database containers based on their runtime state, eliminating the need for configuration flags:

```typescript
// kyrage.config.ts
export default defineConfig({
  dev: {
    container: {
      image: "postgres:17",
      name: "kyrage-dev-db"  // Optional custom container name
    }
  },
  // ... other config
});
```

**Smart Container Detection:**

```bash
# Without dev start container running
$ kyrage generate --dev
🚀 Starting temporary dev database...
🔄 Applying 2 pending migrations...
✔ Applied 2 migrations
✔ Migration file generated: migrations/1755525514175.json
✔ Temporary dev database stopped

# After starting dev database
$ kyrage dev start
🚀 Starting dev database...
✔ Applied 2 migrations  
✨ Dev database ready: postgresql://postgres:password@localhost:32768/test

# Subsequent generate --dev automatically reuses dev start container
$ kyrage generate --dev  
🔄 Reusing existing dev start container...
🔄 Applying 1 pending migration to dev start container...
✔ Applied 1 migration
✔ Migration file generated: migrations/1755525514176.json
✨ Dev start container remains running
```

This feature is expected to be used in steamlined development cycle to make multiple schema changes with the populated data on your database kept, which will help debug or test your latest schema with the developing app that uses the database.

#### Development Database Management

kyrage also provides handy commands to manage your development database containers without Docker CLI:

```bash
# Start persistent dev database with migrations applied
$ kyrage dev start
🚀 Starting dev database...
✔ Applied 2 migrations
✨ Dev database ready: postgresql://postgres:password@localhost:32768/test

# Check status of dev containers
$ kyrage dev status
Running: abc123def456 (postgres:17)

# Get connection URL for running dev container
$ kyrage dev get-url
postgresql://postgres:password@localhost:32768/test

# Connect directly to dev database using psql
$ psql $(kyrage dev get-url)
psql (17.0)
Type "help" for help.

test=# \dt
          List of relations
 Schema |  Name   | Type  |  Owner   
--------+---------+-------+----------
 public | members | table | postgres
 public | posts   | table | postgres
(2 rows)

# Clean up all kyrage dev containers
$ kyrage dev clean
✔ Cleaned up dev containers
```

## Squash Migrations

During feature development, you may generate multiple pending migration files. Use the `--squash` option to consolidate them into a single migration:

```bash
# Before squashing
$ ls migrations/
1755525514175.json  # ✅ applied
1755525514180.json  # ⏳ pending  
1755525514185.json  # ⏳ pending
1755525514190.json  # ⏳ pending

$ kyrage generate --squash
Found 3 pending migrations to squash:
  - 1755525514180.json
  - 1755525514185.json
  - 1755525514190.json
🗑️  Removed 3 pending migration files
-- create_table: users
   -> column: id ({"type": "uuid", "primaryKey": true, "notNull": true})
   -> column: email ({"type": "text", "notNull": true, "unique": true})
   -> column: name ({"type": "text", "notNull": false})
✔️  Generated squashed migration: migrations/1755525514200.json

# After squashing  
$ ls migrations/
1755525514175.json  # ✅ applied (preserved)
1755525514200.json  # ⏳ pending (squashed)
```

This consolidates multiple pending migrations into a single migration representing the final desired state. Applied migrations are never touched.

### Typical Development Workflow

A common pattern is to use dev databases for iterative development, then squash migrations before deploying to staging/production:

```bash
# Development phase - multiple iterations with dev database
$ kyrage generate --dev  # 1st iteration - adds users table
$ kyrage generate --dev  # 2nd iteration - adds posts table
$ kyrage generate --dev  # 3rd iteration - adds indexes

# Development complete - consolidate pending migrations
$ kyrage generate --squash  # Squash all pending migrations into one

# Deploy to staging/production
$ kyrage apply  # Apply the single squashed migration
```

In this workflow:
- **Dev database** acts like a feature branch - rapid iteration with immediate application
- **Squashing** consolidates the development history into a clean, single migration
- **Production deployment** applies one cohesive migration instead of multiple incremental changes

This approach keeps your production migration history clean while allowing flexible development iterations.

## 📚 API Reference

### Commands

| Command | Description |
|---------|-------------|
| `kyrage generate` | Compare schema with database and generate migration file |
| `kyrage generate --squash` | Consolidate pending migrations into a single migration file |
| `kyrage generate --dev` | Generate migration using development database (auto-detects container reuse) |
| `kyrage apply` | Apply all pending migrations to the database |
| `kyrage dev start` | Start persistent development database with migrations applied |
| `kyrage dev status` | Show status of running development database containers |
| `kyrage dev get-url` | Print connection URL for running development database (use with `psql $(kyrage dev get-url)`) |
| `kyrage dev clean` | Remove all kyrage-managed development database containers |

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
  // Optional: Development database configuration
  dev: {
    // Option 1: Use Docker container (requires Docker)
    container: {
      image: "postgres:17",
      name: "kyrage-dev-db"  // Optional custom container name
    },
    // Option 2: Use existing database connection
    connectionString: "postgres://..."
  },
  tables: [
    // table definitions
  ],
});
```

Kyrage internally employes [unjs/c12](https://github.com/unjs/c12) that helps users define environment specific configurations that can be switched with `NODE_ENV`.

```typescript
import { defineConfig } from "@izumisy/kyrage";

export default defineConfig({
  // Using different databases by environment
  $development: {
    database: {
      dialect: "postgres",
      connectionString: "psql://dev:pass@localhost/myapp_dev"
    },
    // Use containerized dev database for clean migration generation
    dev: {
      container: {
        image: "postgres:17",
        reuse: true  // Keep container running between operations
      }
    }
  },
  $production: {
    database: {
      dialect: "cockroachdb",
      connectionString: "psql://user:pass@prod-db.com/myapp_prod?ssl=true"
    },
    // Use existing staging database for dev migrations
    dev: {
      connectionString: "psql://staging:pass@staging-db.com/myapp_staging"
    }
  },

  // Tables are common in all environment
  tables: [
    /* ... */
  ]
});
```

#### Table Definition

Use the `defineTable` function to define your database tables:

```typescript
import { column, defineTable } from "@izumisy/kyrage";

const tableName = defineTable(
  "table_name",                            // Table name 
  { columnName: column("type", options) }, // Column definitions (record)
  (t) => [                                 // Optional: table constraints
    t.primaryKey(["col1", "col2"]),
    t.index(["col1", "col2"], { unique: true }),
    t.unique(["col1", "col2"], { name: "custom_name" }),
    t.reference("col1", anotherTable, "id")
  ]
);
```

#### Column Definition

The `column` function accepts the following options:

```typescript
column("dataType", {
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
column("uuid", { primaryKey: true })

// Composite primary key
t.primaryKey(["id", "tenant_id"])

// Custom constraint name
t.primaryKey(["id", "tenant_id"], { name: "pk_custom_name" })
```

##### Unique Constraints
```typescript
// Single column unique
column("email", { unique: true })

// Composite unique constraint
t.unique(["tenant_id", "slug"])

// Custom constraint name
t.unique(["tenant_id", "slug"], { name: "unique_tenant_slug" })
```

##### Foreign Key Constraints
```typescript
// Single column foreign key
t.reference("user_id", usersTable, "id")

// Multiple column foreign key
t.reference(["tenant_id", "user_id"], usersTable, ["tenant_id", "id"])

// With referential actions and custom name
t.reference("author_id", usersTable, "id", {
  onDelete: "cascade",
  onUpdate: "restrict", 
  name: "posts_author_fk"
})
```

#### Constraint Naming Convention

kyrage automatically generates constraint names following these patterns:

- **Primary Key**: `{table}_{column}_primary_key` (single) or `pk_{table}_{columns}` (composite)
- **Unique Constraint**: `{table}_{column}_unique` (single) or `uq_{table}_{columns}` (composite)  
- **Index**: `idx_{table}_{columns}`

You can override these by providing a custom `name` option.

### 💬 Known Limitations

#### Constraint Creation Strategy

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
