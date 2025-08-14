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

export const members = t("members", {
  id: c("uuid", { primaryKey: true }),
  email: c("text", { unique: true, notNull: true }),
  name: c("text", { unique: true }),
  age: c("integer"),
  createdAt: c("timestamptz", { defaultSql: "now()" }),
});

export const posts = t("posts", {
  id: c("uuid", { primaryKey: true }),
  author_id: c("uuid", { notNull: true }),
  title: c("text", { notNull: true }),
  content: c("text", { notNull: true }),
  published: c("boolean", { defaultSql: "false" }),
  published_at: c("timestamptz", { defaultSql: "now()" }),
});
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
   -> column: id ({"type":"uuid","primaryKey":true,"notNull":false "unique":false})
   -> column: email ({"type":"text","primaryKey":false,"notNull":true,"unique":true})
   -> column: name ({"type":"text","primaryKey":false,"notNull":false,"unique":true})
   -> column: age ({"type":"integer","primaryKey":false,"notNull":false,"unique":false})
   -> column: createdAt ({"type":"timestamptz","primaryKey":false,"notNull":false,"unique":false,"defaultSql":"now()"})
-- create_table: posts
   -> column: id ({"type":"uuid","primaryKey":true,"notNull":false,"unique":false})
   -> column: author_id ({"type":"uuid","primaryKey":false,"notNull":true,"unique":false})
   -> column: title ({"type":"text","primaryKey":false,"notNull":true,"unique":false})
   -> column: content ({"type":"text","primaryKey":false,"notNull":true,"unique":false})
   -> column: published ({"type":"boolean","primaryKey":false,"notNull":false,"unique":false,"defaultSql":"false"})
   -> column: published_at ({"type":"timestamptz","primaryKey":false,"notNull":false,"unique":false,"defaultSql":"now()"})
✔ Migration file generated: migrations/1754553798672.json
```

`generate` command will fail if there is a pending migration. Use `--ignore-pending` option in that case.

### 4. Plan Changes

You can use `apply --plan` beforehand to check SQL queries that will be executed in the next time:

```bash
$ kyrage apply --plan --pretty
create table "members" (
  "id" uuid primary key,
  "email" text not null unique,
  "name" text unique,
  "age" int4,
  "createdAt" timestamptz default now ()
)
create table "posts" (
  "id" uuid primary key,
  "author_id" uuid not null,
  "title" text,
  "content" text not null,
  "published" boolean default false,
  "published_at" timestamptz default now ()
)
```

### 5. Apply

If everything looks good, execute the generated migrations:

```bash
$ kyrage apply
✔ Migration applied: 1754372124127
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

```typescript
import { column as c, defineTable as t } from "@izumisy/kyrage";

export default {
  database: {
    dialect: "postgres",           // Database dialect
    connectionString: string,      // Database connection string
  },
  tables: [                        // Array of table definitions
    t("tableName", {               // Use defineTable function
      columnName: c("type", {      // Use column function
        primaryKey?: boolean,      // PRIMARY KEY constraint
        unique?: boolean,          // UNIQUE constraint
        notNull?: boolean,         // NOT NULL constraint 
        defaultSql?: string,       // Default SQL expression
      })
    }),
    // ... more tables
  ]
}
```

## 🗄️ Supported Databases

* PostgreSQL
* CockroachDB

## 🏗️ Examples

Check out the [examples/basic](./examples/basic) directory for a complete working example with:
- Configuration setup
- Schema definitions
- Generated migrations
- Applied database changes

## 💡 Best Practices

### Schema Management
- **Version Control**: Always commit your `kyrage.config.ts` and schema files
- **Migration Files**: Keep generated migration files in version control
- **Team Coordination**: Coordinate with your team when generating new migrations

### Development Workflow
1. Update your schema definitions in TypeScript
2. Run `kyrage generate` to create migration files
3. Review the generated migrations before applying
4. Run `kyrage apply` to update your database
5. Commit both schema changes and migration files

### Production Deployments
- Test migrations thoroughly in staging environments
- Run migrations as part of your deployment pipeline
- Always backup your database before running migrations in production

## 🔧 Troubleshooting

### Common Issues

**Migration Generation Fails**
- Verify database connection string and credentials
- Ensure database server is running and accessible
- Check that your schema definitions are valid TypeScript

**Migration Application Fails**
- Review the generated migration file for correctness
- Ensure no conflicting migrations exist
- Check database permissions for DDL operations

**Schema Conflicts**
- Resolve any pending migrations before generating new ones
- Coordinate with team members to avoid concurrent schema changes
- Use database transactions where possible

### Getting Help

- Check the [examples](./examples/) directory for reference implementations
- Review error messages carefully - they often contain helpful details
- Ensure your `migrations/` directory exists and is writable

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.
