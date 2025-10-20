# @izumisy/kyrage

## 1.5.3

### Patch Changes

- [#159](https://github.com/IzumiSy/kyrage/pull/159) [`7026f08`](https://github.com/IzumiSy/kyrage/commit/7026f08976801f90263febd28e61b4134b19c49a) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump c12 from 3.3.0 to 3.3.1

- [#160](https://github.com/IzumiSy/kyrage/pull/160) [`5779a2d`](https://github.com/IzumiSy/kyrage/commit/5779a2d4aef619ef18b9d96b230ec32ce3c59800) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump ramda from 0.31.3 to 0.32.0

## 1.5.2

### Patch Changes

- [#147](https://github.com/IzumiSy/kyrage/pull/147) [`1d8161f`](https://github.com/IzumiSy/kyrage/commit/1d8161f2d24d84f939ec77183953f6727811eedb) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump zod from 4.1.11 to 4.1.12

- [#150](https://github.com/IzumiSy/kyrage/pull/150) [`e8b416f`](https://github.com/IzumiSy/kyrage/commit/e8b416f9b462fa51cda523ef408e64cf99346fa2) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump memfs from 4.48.1 to 4.49.0

- [#151](https://github.com/IzumiSy/kyrage/pull/151) [`d995dc0`](https://github.com/IzumiSy/kyrage/commit/d995dc0575a8ba13819de8b96c074bc7cf805eb6) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump mysql2 from 3.15.1 to 3.15.2

- [#148](https://github.com/IzumiSy/kyrage/pull/148) [`233c6e7`](https://github.com/IzumiSy/kyrage/commit/233c6e7151410b42f38e468d090295b2c4223d8b) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump kysely from 0.28.7 to 0.28.8

- [#149](https://github.com/IzumiSy/kyrage/pull/149) [`e9b5a3e`](https://github.com/IzumiSy/kyrage/commit/e9b5a3ee1feac8ce58aa6e9acb55836473e2af47) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump @types/node from 24.6.2 to 24.7.2

## 1.5.1

### Patch Changes

- [#137](https://github.com/IzumiSy/kyrage/pull/137) [`2922cb8`](https://github.com/IzumiSy/kyrage/commit/2922cb847e5e53cb6e90f4a0c03cc7abea1b1556) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Update dependencies

## 1.5.0

### Minor Changes

- [#131](https://github.com/IzumiSy/kyrage/pull/131) [`23e21eb`](https://github.com/IzumiSy/kyrage/commit/23e21ebb259d895b7546383ba9e2c2a6e480e23c) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Add foreign key constraint merging to table creation operations with inline control option

  Kyrage now automatically merges foreign key constraints into `CREATE TABLE` statements alongside existing primary key and unique constraints. This reduces SQL operations and improves migration performance. Added `inline` option to schema builder's `reference()` method for fine-grained control over constraint merging.

  **Example schema with inline foreign key:**

  ```typescript
  import { column as c, defineTable as t } from "@izumisy/kyrage";

  const users = t("users", {
    id: c("uuid", { primaryKey: true }),
  });

  const posts = t(
    "posts",
    {
      id: c("uuid", { primaryKey: true }),
      userId: c("uuid"),
    },
    (t) => [
      // Merged into CREATE TABLE (default: inline: true)
      t.reference("userId", users, "id"),
    ]
  );
  ```

  **Example with separate constraint:**

  ```typescript
  const posts = t(
    "posts",
    {
      id: c("uuid", { primaryKey: true }),
      userId: c("uuid"),
    },
    (t) => [
      // Separate ALTER TABLE statement
      t.reference("userId", users, "id", { inline: false }),
    ]
  );
  ```

### Patch Changes

- [#131](https://github.com/IzumiSy/kyrage/pull/131) [`23e21eb`](https://github.com/IzumiSy/kyrage/commit/23e21ebb259d895b7546383ba9e2c2a6e480e23c) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Table operations are now sorted to always respect foreign key and other dependency relationships. Independent tables are ordered alphabetically, ensuring stable and predictable output for migrations and SQL generation.

  **Example:**

  ```typescript
  import { column as c, defineTable as t } from "@izumisy/kyrage";

  const users = t("users", {
    id: c("uuid", { primaryKey: true }),
    name: c("varchar"),
  });

  const posts = t(
    "posts",
    {
      id: c("uuid", { primaryKey: true }),
      userId: c("uuid"),
      content: c("text"),
    },
    (t) => [
      t.reference("userId", users, "id"), // posts depends on users
    ]
  );

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

## 1.4.0

### Minor Changes

- [#128](https://github.com/IzumiSy/kyrage/pull/128) [`81034d5`](https://github.com/IzumiSy/kyrage/commit/81034d5e6fb4ca5f6950bacdd5da184f6faf6f89) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Optimize table creation by merging constraints into `CREATE TABLE` statements

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

## 1.3.1

### Patch Changes

- [#119](https://github.com/IzumiSy/kyrage/pull/119) [`55b769a`](https://github.com/IzumiSy/kyrage/commit/55b769a0cacdc3cb12458271f704b95877c65a24) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix CockroachDB dialect to filter out system-generated `rowid` column during introspection

  CockroachDB automatically generates a `rowid` column for tables without an explicit primary key. This system-generated column was being included in introspection results, causing unwanted diffs between the actual database schema and user-defined configuration. The CockroachDB dialect now filters out the `rowid` column to match user expectations and prevent false positives in schema comparisons.

- [#121](https://github.com/IzumiSy/kyrage/pull/121) [`5fcfb5b`](https://github.com/IzumiSy/kyrage/commit/5fcfb5bd5160e31308eb655f6963b985ef20e41a) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix container detection for dev database commands by properly matching multiple Docker labels. This resolves the issue where users would see "No running dev containers found" even when containers were actually running.

  The `kyrage dev status`, `kyrage dev clean`, and `kyrage dev get-url` commands were unable to detect running containers due to incomplete label matching in the container detection logic.

- [#116](https://github.com/IzumiSy/kyrage/pull/116) [`75fca73`](https://github.com/IzumiSy/kyrage/commit/75fca730d71a131a122ae3c69365fd0cdc56bb1e) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix migration provider to use the acquired DB connection by Kysely migrator

  Resolves issue where migration provider was not using the acquired DB connection passed to the Migration interface's up method, which is required for databases with connection limits like SQLite.

## 1.3.0

### Minor Changes

- [#102](https://github.com/IzumiSy/kyrage/pull/102) [`862401d`](https://github.com/IzumiSy/kyrage/commit/862401d8f1fa7fecc73bf8f79400269a5ef49d9e) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Remove `connectionString` support from Dev Database configuration

### Patch Changes

- [#111](https://github.com/IzumiSy/kyrage/pull/111) [`c3cae2b`](https://github.com/IzumiSy/kyrage/commit/c3cae2b45d3364fedf2af5071d07aa9c7c4eed70) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Update dependecies

## 1.2.3

### Patch Changes

- [#98](https://github.com/IzumiSy/kyrage/pull/98) [`2880b70`](https://github.com/IzumiSy/kyrage/commit/2880b709fce022ea16337b8484f545873ad3cd87) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix redundant DROP INDEX operations when dropping constraints

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

- [#100](https://github.com/IzumiSy/kyrage/pull/100) [`825f90e`](https://github.com/IzumiSy/kyrage/commit/825f90e0cece66ddbe763cbe2543057192fb208c) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix redundant operations for tables being dropped

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

## 1.2.2

### Patch Changes

- [#92](https://github.com/IzumiSy/kyrage/pull/92) [`4f5050f`](https://github.com/IzumiSy/kyrage/commit/4f5050f621bfee351b75ec9427e18abf2cc161d5) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix CockroachDB dialect

  The changes that fix CockroachDB dialect includes the update for internal introspection mechanism that filters out auto-generated indexes and uinque constraints, which leads to unwanted diff between the database and user-defined configuration.

## 1.2.1

### Patch Changes

- [#84](https://github.com/IzumiSy/kyrage/pull/84) [`60062ea`](https://github.com/IzumiSy/kyrage/commit/60062ea8e30264202eb2b8f735e9b7e6c322d176) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Update dependencies

## 1.2.0

### Minor Changes

- [#62](https://github.com/IzumiSy/kyrage/pull/62) [`ce5a307`](https://github.com/IzumiSy/kyrage/commit/ce5a3075633f9e1709bffa86e43d55e28efda8fe) Thanks [@copilot-swe-agent](https://github.com/apps/copilot-swe-agent)! - Add migration squashing feature #49

- [#76](https://github.com/IzumiSy/kyrage/pull/76) [`c125b88`](https://github.com/IzumiSy/kyrage/commit/c125b8809fc433cc27f64db7d2e447c4d3ac241c) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Drop `--apply` option from generate command

- [#77](https://github.com/IzumiSy/kyrage/pull/77) [`ecb519a`](https://github.com/IzumiSy/kyrage/commit/ecb519ae1eed5449ff0f69ebca65477b4d646ced) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Replace configuration-based container reuse with smart runtime detection. The `generate --dev` command now automatically detects and reuses containers started by `dev start`, falling back to one-off containers when none are running.

  **New behavior:**

  - Removed `reuse: true` configuration option from dev container config
  - Added `kyrage dev start` command to start persistent containers with migration baseline
  - `kyrage generate --dev` automatically detects running dev-start containers
  - Smart fallback to temporary one-off containers when dev-start not available

  **Example workflow:**

  ```bash
  # Start persistent dev container
  kyrage dev start

  # Generate migrations - automatically reuses dev container. Without dev start, creates temporary container
  kyrage generate --dev
  ```

### Patch Changes

- [#69](https://github.com/IzumiSy/kyrage/pull/69) [`465d7c2`](https://github.com/IzumiSy/kyrage/commit/465d7c2a7b8802ac22035aaf63bd167259c9778a) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Allow pending migrations in dev mode for consistent migration generation. When using `--dev` flag, pending migrations are now ignored and automatically applied as baseline, ensuring dev database consistency with production behavior.

## 1.1.0

### Minor Changes

- [#58](https://github.com/IzumiSy/kyrage/pull/58) [`2890e7c`](https://github.com/IzumiSy/kyrage/commit/2890e7cb44a0ad15e9e319033ed66c5950222ac8) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Add reuse API #52

### Patch Changes

- [#60](https://github.com/IzumiSy/kyrage/pull/60) [`5fefb21`](https://github.com/IzumiSy/kyrage/commit/5fefb21cafc6a1e958fcd74f816c4a5134348087) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix implicit non-null marks by composite primary key #48

## 1.0.0

### Major Changes

- [#47](https://github.com/IzumiSy/kyrage/pull/47) [`b2e220a`](https://github.com/IzumiSy/kyrage/commit/b2e220a0dd21228f287a8ea61253039878638e5f) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Dev database support #46

### Minor Changes

- [#44](https://github.com/IzumiSy/kyrage/pull/44) [`5783c95`](https://github.com/IzumiSy/kyrage/commit/5783c951d33c66f7ad1364525557b65195db53a0) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support foreign key support #34

- [#13](https://github.com/IzumiSy/kyrage/pull/13) [`b6f7b25`](https://github.com/IzumiSy/kyrage/commit/b6f7b258d78d20d8b669719cd62a0cfac097b010) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support index #17

- [#37](https://github.com/IzumiSy/kyrage/pull/37) [`4149692`](https://github.com/IzumiSy/kyrage/commit/4149692a92c9bb03b606f9d953b7d80af9841194) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support constraints: composite primary key and composite unique #33

## 0.7.0

### Minor Changes

- [#25](https://github.com/IzumiSy/kyrage/pull/25) [`2755a84`](https://github.com/IzumiSy/kyrage/commit/2755a848f5214e9e4e3864228731c1d7f9753d9a) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support dropping primary key and unique constraint

### Patch Changes

- [#31](https://github.com/IzumiSy/kyrage/pull/31) [`6081b45`](https://github.com/IzumiSy/kyrage/commit/6081b45ada19c7aadb8d83c8d1a4718342671faa) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix #26

## 0.6.0

### Minor Changes

- 7c7b0c6: Add pretty option in plan mode

## 0.5.0

### Minor Changes

- d221705: Implement custom SQL introspector to get extra column information that kysely's builtin one does not help.

  To keep the initial implementation focused, decided to drop `checkSql` support and narrowed dialect support to PostgreSQL for now.

- bba7eaa: Fix type error in defineConfig function

## 0.4.0

### Minor Changes

- 6049629: Support default/check for columns

## 0.3.0

### Minor Changes

- 96e8647: Support plan option

## 0.2.0

### Minor Changes

- Support more dialects: cockroachdb, mysql, sqlite
- Add defineConfig helper

## 0.1.1

### Patch Changes

- Update README

## 0.1.0

### Minor Changes

- 6baebcf: Initial release
