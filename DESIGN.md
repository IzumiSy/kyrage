# DESIGN.md

## Overview

This document describes the internal design and architecture of `kyrage`. It is intended for contributors and maintainers.

`kyrage` is a declarative database schema migration tool that uses **Operation-based Architecture** to represent all schema changes as a unified array of operations, enabling better composability, testability, and maintainability.

## Core Architecture: Operation-based Design

### Philosophy

Traditional migration tools often use object-based diff structures (e.g., `{ addedTables: [], removedTables: [], changedTables: [] }`), which leads to:
- Code duplication across console output, SQL generation, and testing
- Complex iteration patterns for different operation types
- Difficulty in controlling operation order and dependencies

**kyrage** adopts an **Operation-based Architecture** where all schema changes are represented as a unified array of operation objects:

```typescript
type Operation = 
  | { type: "create_table"; table: string; columns: Record<string, TableColumnAttributes> }
  | { type: "create_table_with_constraints"; table: string; columns: Record<string, TableColumnAttributes>; constraints?: ConstraintDef }
  | { type: "drop_table"; table: string }
  | { type: "add_column"; table: string; column: string; attributes: TableColumnAttributes }
  | { type: "drop_column"; table: string; column: string; attributes: TableColumnAttributes }
  | { type: "alter_column"; table: string; column: string; before: TableColumnAttributes; after: TableColumnAttributes }
  | { type: "create_index"; table: string; name: string; columns: ReadonlyArray<string>; unique: boolean }
  | { type: "drop_index"; table: string; name: string }
  | { type: "create_primary_key_constraint"; table: string; name: string; columns: ReadonlyArray<string> }
  | { type: "drop_primary_key_constraint"; table: string; name: string }
  | { type: "create_unique_constraint"; table: string; name: string; columns: ReadonlyArray<string> }
  | { type: "drop_unique_constraint"; table: string; name: string }
  | { type: "create_foreign_key_constraint"; table: string; name: string; columns: ReadonlyArray<string>; referencedTable: string; referencedColumns: ReadonlyArray<string> }
  | { type: "drop_foreign_key_constraint"; table: string; name: string };

type SchemaDiff = {
  operations: Operation[];
};
```

### Dialect Architecture

**kyrage** uses a **Dialect-based Architecture** to provide unified database support through a clean abstraction layer:

```typescript
export type KyrageDialect = {
  getName: () => string;
  createKyselyDialect: (connectionString: string) => Dialect;
  createIntrospectionDriver: (client: DBClient) => IntrospectorDriver;
  createSchemaAdapter: () => SchemaAdapter;
  createDevDatabaseProvider: () => DevDatabaseProvider;
  parseDevDatabaseConfig: (config: unknown) => DevDatabaseConfig;
  hasReusableDevDatabase: () => Promise<boolean>;
};

// Factory pattern for dialect management
export const getDialect = (dialectName: DialectEnum): KyrageDialect => {
  const dialect = dialects[dialectName];
  if (!dialect) {
    throw new Error(`Unsupported dialect: ${dialectName}`);
  }
  return dialect;
};
```

**Supported Dialects**:
- **PostgreSQL**: Full support with native introspection
- **CockroachDB**: Built on PostgreSQL compatibility with custom adapter
- **MySQL**: Kysely's MySQL dialect with `information_schema` introspection and container-backed development databases
- **MariaDB**: Reuses MySQL introspection and SQL handling with a MariaDB development container
- **SQLite**: File-backed development databases with SQLite-specific introspection

**Dialect Benefits**:
1. **Unified Interface**: All database-specific logic encapsulated in dialect implementations
2. **Extensibility**: New databases can be added by implementing the `KyrageDialect` interface
3. **Maintainability**: Database-specific code is isolated and centralized
4. **Type Safety**: Factory pattern ensures only supported dialects are used

#### Schema Adapters

Each dialect supplies a `SchemaAdapter` through `createSchemaAdapter()`. `DBClient.getSchemaAdapter()` resolves this behavior at the database configuration boundary:

- `prepareSchemaComparison`: Normalizes current/ideal snapshots before the generic diff engine compares them.
- `operationExecutors`: A typed, partial map of operation overrides; omitted operations use their registered standard executor.

PostgreSQL, CockroachDB, and SQLite use the default adapter. MySQL and MariaDB share `mysqlSchemaAdapter`, which owns their comparison rules and nonstandard DDL. Core diffing, commands, migration execution, and operation implementations do not inspect dialect names or native Kysely adapter classes.

### Benefits

1. **Unified Processing**: Single `for...of` loop handles all operations consistently
2. **Order Control**: Operations execute in array order, enabling dependency management
3. **Testability**: Complete diff can be asserted as a single data structure using `toEqual()`
4. **Extensibility**: New operation types integrate seamlessly, making it easy to add support for new databases and features
5. **Maintainability**: No code duplication between console output, SQL generation, and testing
6. **Database Abstraction**: Dialect architecture provides clean separation between core logic and database-specific implementations

## Key Modules

### 1. Schema Definition (`schema.ts`)

Handles table and column definitions with strong typing using the `defineTable` and `column` functions.

```typescript
import { column as c, defineTable as t } from "@izumisy/kyrage";

export const members = t("members", {
  id: c("uuid", { primaryKey: true }),
  email: c("text", { unique: true, notNull: true }),
  name: c("text", { unique: true }),
  age: c("integer"),
  createdAt: c("timestamptz", { defaultSql: "now()" }),
});
```

### 2. Schema Introspection (`introspection/` → `dialect/`)

**Purpose**: Extract current database schema for comparison

**Architecture**:
- `introspector.ts`: Core interface and coordination using dialect factory
- `dialect/postgres.ts`: PostgreSQL-specific implementation with introspection driver
- `dialect/cockroachdb.ts`: CockroachDB implementation reusing PostgreSQL introspection
- `dialect/mysql.ts`: MySQL catalog introspection and normalization of implicitly generated foreign-key indexes
- `dialect/mariadb.ts`: MariaDB implementation reusing MySQL introspection
- `dialect/types.ts`: Dialect interface and schema representation types
- `dialect/factory.ts`: Centralized dialect management and instantiation

**Key Function**: `getIntrospector(client)` returns an introspector object with methods to extract database schema:
- `getTables()`: Returns table and column information
- `getIndexes()`: Returns index information

**Dialect Integration**:
```typescript
export const getIntrospector = (client: DBClient) => {
  const dialectName = client.getDialect();
  const kyrageDialect = getDialect(dialectName);
  const extIntrospectorDriver = kyrageDialect.createIntrospectionDriver(client);
  // ... unified processing
};
```

The introspector provides a standardized interface regardless of database dialect, with all database-specific logic encapsulated in dialect implementations. Extended column metadata can supply an optional full `dataType` so MySQL length, precision, and scale are preserved rather than relying only on Kysely's base type names. MySQL foreign-key supporting indexes that are implicitly generated are normalized against the configuration to avoid unwanted index-drop migrations.

### 3. Diff Calculation (`diff.ts`)

**Purpose**: Generate Operation arrays representing schema changes

**Core Function**:
```typescript
function diffSchema(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): SchemaDiff {
  const tableOperations = diffTables(props);
  const indexOperations = diffIndexes(props);
  return { operations: [...tableOperations, ...indexOperations] };
}
```

**Strategy**:
- Compare current vs ideal schema snapshots using functional utilities (Ramda)
- Generate operations in dependency-safe order
- Compare snapshots prepared by the selected schema adapter; the diff engine itself has no dialect-specific options or branches
- MySQL/MariaDB adapters align primary-key names, omitted type parameters, and equivalent default foreign-key actions before comparison
- Return unified operation array for consistent processing

**Operation Types**:
- Table operations: `create_table`, `create_table_with_constraints`, `drop_table`
- Column operations: `add_column`, `drop_column`, `alter_column`  
- Index operations: `create_index`, `drop_index`
- Constraint operations: `create_primary_key_constraint`, `drop_primary_key_constraint`, `create_unique_constraint`, `drop_unique_constraint`, `create_foreign_key_constraint`, `drop_foreign_key_constraint`

### 4. Operation Reconciliation (`operations/reconciler.ts`)

**Purpose**: Optimize and reorganize operations for efficient execution

**Core Pipeline**:
```typescript
export const buildReconciledOperations = R.pipe(
  filterOperationsForDroppedTables,
  mergeTableCreationWithConstraints,
  filterRedundantDropIndexOperations,
  sortOperationsByDependency
);
```

**Optimization Strategies**:

1. **Table Creation Merging**: Combines `create_table` operations with `create_primary_key_constraint` and `create_unique_constraint` operations into a single `create_table_with_constraints` operation for better SQL efficiency.

2. **Dependency Ordering**: Sorts operations by priority to ensure safe execution:
   - Drop operations (foreign keys → unique → primary key → indexes → columns → tables)
   - Create operations (tables → columns → indexes → constraints)

3. **Redundant Operation Filtering**: Removes unnecessary operations (e.g., dropping indexes when constraint drops will automatically drop them).

**Benefits**:
- Reduces number of SQL statements executed
- Ensures dependency-safe operation ordering
- Eliminates redundant database operations
- Atomic table creation with constraints

### 5. Operation Definition Pattern (`operations/shared/operation.ts`)

**Purpose**: Standardized operation implementation with type safety and schema validation

**Core Pattern**:
```typescript
export const defineOperation = <const T extends string, S extends z.ZodType>(
  props: DefineOperationProps<T, S>
) => props;

// Example operation definition
export const createTableOp = defineOperation({
  typeName: "create_table",
  schema: z.object({
    type: z.literal("create_table"),
    table: z.string(),
    columns: z.record(z.string(), tableColumnAttributesSchema),
  }),
  execute: async (db, operation) => {
    let builder = db.schema.createTable(operation.table);
    builder = addColumnsToTableBuilder(builder, operation.columns);
    await builder.execute();
  },
});
```

**Architecture Benefits**:
- **Type Safety**: Operation schemas are validated at runtime using Zod
- **Consistent Structure**: All operations follow the same `typeName`, `schema`, `execute` pattern  
- **Automatic Registration**: Operations are automatically registered in the executor through the `operations` array
- **Modular Implementation**: Each operation is self-contained with its own validation and execution logic
- **Developer Experience**: IntelliSense support for operation parameters through schema inference

**Operation Components**:
- `typeName`: Unique identifier matching the operation type discriminant
- `schema`: Zod schema for runtime validation and TypeScript type inference
- `execute`: Async function that performs the actual database operation using Kysely

### 6. Migration Execution (`migration.ts`)

**Purpose**: Execute reconciled Operation arrays against database

**Architecture**:
```typescript
const adapter = client.getSchemaAdapter();
const comparison = adapter.prepareSchemaComparison({ current, ideal });
const diff = diffSchema(comparison);

const provider = createMigrationProvider({
  migrationsResolver,
  options: { plan },
  operationExecutors: adapter.operationExecutors,
});

// The provider captures the injected executors, including for transactional Kysely instances.
const up = async (db: Kysely<any>) => {
  for (const operation of buildReconciledOperations(diff.operations)) {
    await executeOperation(db, operation, adapter.operationExecutors);
  }
};

// Dispatch prefers the injected override and falls back to the registered standard executor.
const execute = executors[operation.type] ?? registeredOperation.execute;
```

**Benefits**: 
- Single execution path for all operations
- Type-safe operation handling with dynamic dispatch
- Modular operation implementations through `defineOperation` pattern
- Consistent error handling and transaction management
- Automatic operation registration and schema validation

Generic column, constraint, and index operations contain only standard SQL. The MySQL/MariaDB schema adapter supplies overrides for `MODIFY COLUMN`, `DROP PRIMARY KEY`, `DROP FOREIGN KEY`, unique-constraint index drops, and table-qualified index drops. Primary-key creation overrides omit the reserved catalog name `PRIMARY` from both `ALTER TABLE` and inline `CREATE TABLE` declarations, since MariaDB rejects it as an explicit index name. The migration provider receives these executors explicitly, so plan mode and real or transactional execution use the same behavior without inspecting database identity. Catalog defaults are reconstructed as SQL literals or parenthesized expressions. Full-definition column alterations are rejected during generation and execution when catalog metadata identifies unsupported attributes that would otherwise be lost (for example, auto-increment or custom collation). MySQL and MariaDB DDL is nontransactional, so a migration failure can leave preceding operations applied.

### 7. Development Database Management (`dev/container.ts`)

**Purpose**: Container-based development database lifecycle management

**Features**:
- Automatic container creation with dialect-specific configurations
- Smart container reuse and detection for `generate --dev`
- Baseline migration application to ensure accurate schema comparison
- Container cleanup and status management
- Support for PostgreSQL, CockroachDB, MySQL, and MariaDB containers

**Architecture**: Integrates with dialect factory to provide database-specific container configurations while maintaining a unified interface.

### 8. Development Commands (`commands/dev.ts`)

**Purpose**: CLI commands for development database management

**Commands**:
- `kyrage dev start`: Start persistent development database
- `kyrage dev status`: Show running container status
- `kyrage dev get-url`: Print connection URL for external tools
- `kyrage dev clean`: Remove all kyrage containers

**Integration**: Works seamlessly with `generate --dev` for automatic container reuse.

### 9. Console Output (`generate.ts`)

**Purpose**: Human-readable diff presentation

**Implementation**:
The `printPrettyDiff` function in `commands/generate.ts` formats Operation arrays for console output:

```typescript
diff.operations.forEach((operation: Operation) => {
  switch (operation.type) {
    case "create_table":
      logger.log(`-- create_table: ${operation.table}`);
      // ... format table columns
      break;
    case "create_table_with_constraints":
      logger.log(`-- create_table_with_constraints: ${operation.table}`);
      // ... format table columns and inline constraints
      break;
    case "add_column":
      logger.log(`-- add_column: ${operation.table}.${operation.column}`);
      break;
    // ... format all operation types including constraints
  }
});
```

**Benefits**:
- Consistent formatting across all operation types
- Unified processing with migration execution
- Easy to extend for new operation types

### 10. Command Architecture (`commands/`)

**Purpose**: Unified command implementation with dependency injection

**Architecture**:
```typescript
// Common dependencies shared across all commands
export type CommonDependencies = {
  client: KyselyDatabaseClient;
  logger: Logger;
  config: Config;
};

export function createCommonDependencies(
  client: KyselyDatabaseClient,
  logger: Logger,
  config: Config
): CommonDependencies {
  return { client, logger, config };
}
```

**Command Implementations**:
- `commands/apply.ts`: `executeApply(dependencies, options)` - Migration execution
- `commands/generate.ts`: `executeGenerate(dependencies, options)` - Migration generation with smart dev database reuse and migration squashing capability
- `commands/dev.ts`: `executeDevStart`, `executeDevStatus`, `executeDevGetUrl`, `executeDevClean` - Development database management
- `commands/common.ts`: Shared dependency injection infrastructure

**Benefits**:
- Consistent architecture across all commands
- Testable with dependency injection
- Clear separation of concerns
- Unified error handling and logging

## Package Structure

- `packages/cli/`  
  Main CLI implementation and entry point.

- `packages/cli/src/`  
  - `main.ts`: CLI entry point and command registration. Uses dependency injection to coordinate commands.
  - `operation.ts`: Operation type definitions and schema validation for array-based architecture.
  - `diff.ts`: Calculates Operation arrays representing schema differences.
  - `operations/`: Modular operation implementations and reconciliation logic.
    - `executor.ts`: Central operation execution with type-safe dispatch.
    - `reconciler.ts`: Operation optimization and dependency ordering (`buildReconciledOperations`).
    - `table/`: Table operations including `createTable`, `createTableWithConstraints`, `dropTable`.
    - `column/`: Column operations (`addColumn`, `dropColumn`, `alterColumn`).
    - `index/`: Index operations (`createIndex`, `dropIndex`).
    - `constraint/`: Constraint operations for primary keys, unique constraints, and foreign keys.
    - `shared/`: Shared types, utilities, and operation definition helpers.
  - `dialect/`: Centralized database dialect management and abstractions.
    - `types.ts`: Dialect interface definitions and schema representation types (`KyrageDialect`, `ColumnExtraAttribute`, `ConstraintAttributes`).
    - `factory.ts`: Centralized dialect instantiation and management (`getDialect`, `getSupportedDialects`).
    - `schema-adapter.ts`: Schema adapter contract, typed executor overrides, and default behavior.
    - `mysql-schema-adapter.ts`: MySQL/MariaDB comparison policies and operation executor overrides.
    - `postgres.ts`: PostgreSQL dialect implementation with introspection driver (`PostgresKyrageDialect`, `postgresExtraIntrospectorDriver`).
    - `cockroachdb.ts`: CockroachDB dialect implementation extending PostgreSQL compatibility (`CockroachDBKyrageDialect`).
    - `mysql.ts`: MySQL dialect implementation with catalog introspection (`MysqlKyrageDialect`).
    - `mariadb.ts`: MariaDB dialect implementation reusing MySQL behavior (`MariadbKyrageDialect`).
    - `sqlite.ts`: SQLite dialect implementation with file-backed development databases.
  - `introspector.ts`: Database schema introspection coordination using dialect factory (moved from `introspection/`).
  - `migration.ts`: Executes Operation arrays against the database.
  - `client.ts`: Database connection and client management using dialect factory.
  - `logger.ts`: Logging utilities and console output formatting.
  - `commands/`: Unified command implementations with dependency injection.
    - `common.ts`: Shared dependency injection infrastructure (`CommonDependencies`, `createCommonDependencies`).
    - `apply.ts`: Migration application command (`executeApply`).
    - `generate.ts`: Migration generation command with dev database support and migration squashing (`executeGenerate`, `handleSquashMode`, `printPrettyDiff`).
    - `dev.ts`: Development database container management commands (`executeDevStart`, `executeDevStatus`, `executeDevGetUrl`, `executeDevClean`).
  - `config/`: Configuration loading and validation with dialect enum restriction.
  - `dev/container.ts`: Development database container lifecycle management with dialect factory integration.
  - `tests/`: Unit tests for core logic including comprehensive Operation array validation.

- `packages/cli/tests/`
  Integration tests for migration generation, application, introspection, and development databases.
  - `fixtures.ts`: Vitest `test.extend()` context with lazy file-scoped database setup and teardown.
  - `helper.ts`: Independent dialect expectation profiles and shared migration helpers.

- `examples/basic/`  
  Example project and configuration.

## Integration Test Context

The CI matrix selects one dialect per invocation through `TEST_DIALECT`. Integration tests receive `{ testDB, expectations }` from `databaseTest`, rather than starting databases during module collection. The file-scoped fixture keeps one isolated database per file and registers cleanup through Vitest; tests that deliberately share state must remain sequential.

`testForDialects(...)` declares dialect-specific coverage with Vitest's `runIf`, so unsupported tests do not start a database. Catalog names and SQL spellings come from an independent test profile, not the production schema adapter. Common indexed string fixtures use `varchar(255)` across dialects, eliminating conditional column types without weakening exact SQL assertions.

## Main Flow

1. **Configuration Loading**  
   Loads and validates `kyrage.config.ts` using Zod schema.

2. **Command Execution with Dependency Injection**  
   - `main.ts` creates common dependencies (`client`, `logger`, `config`) and passes them to command functions.
   - Each command (`apply`, `generate`, `dev`) receives dependencies as the first parameter and command-specific options as the second.
   - Unified architecture ensures consistent error handling, logging, and database connection management.

3. **Database Introspection** (for `generate` command)  
   Connects to the target or development database and introspects the current schema.

4. **Diff Calculation** (for `generate` command)  
   Uses `diffSchema` to compute Operation arrays representing differences between current and ideal schema snapshots.

5. **Migration Planning & Execution**  
   - `executeGenerate` creates migration files as JSON containing Operation arrays in the `migrations/` directory.
   - `executeApply` executes operations against the database with support for dry-run mode.
   - `--dry-run` option for `apply` outputs SQL without executing.
   - `--dev` option for `generate` uses containerized development databases for clean migration generation.

6. **Development Database Management**
   - `executeDevStart` starts persistent development database containers with automatic baseline migration.
   - `executeGenerate --dev` automatically detects and reuses `dev start` containers, falling back to one-off containers when needed.
   - Smart container detection eliminates configuration complexity while optimizing performance.
   - `executeDevStatus`, `executeDevGetUrl`, `executeDevClean` provide container lifecycle management.
   - Automatic baseline migration application to development databases ensures accurate diffs.

7. **Operation Processing**  
   All modules (console output, SQL generation, testing) process the same Operation arrays using unified patterns, ensuring consistency and maintainability.

## Design Considerations

- **Declarative Schema**: Users define the desired schema in TypeScript, enabling type safety and flexibility.
- **Operation-based Architecture**: Unified Operation arrays enable consistent processing across all modules (console output, SQL generation, testing).
- **Operation Reconciliation**: Automatic optimization of operation sequences through constraint merging, dependency ordering, and redundancy elimination.
- **Dialect-based Architecture**: Clean abstraction layer for database-specific functionality with centralized management through factory pattern.
- **Dependency Injection**: Commands use dependency injection pattern for better testability and maintainability.
- **Functional Programming**: Uses Ramda utilities like `eqBy` for immutable schema comparison.
- **Diff-based Migration**: Only the necessary changes are applied, minimizing risk and manual intervention.
- **Dry-run Support**: The `--dry-run` option for `apply` allows users to preview SQL without execution.
- **Development Database Isolation**: Container-based development databases provide clean environments for migration generation.
- **Smart Container Reuse**: Dynamic detection of running containers eliminates configuration complexity while optimizing performance.
- **Label-based Container Management**: Docker labels enable safe identification and cleanup of kyrage-managed containers.
- **Unified Command Architecture**: All commands follow consistent patterns with shared infrastructure for error handling and logging.
- **Type Safety**: Dialect factory ensures compile-time validation of supported database types.

## Future Work

- Support for MSSQL through dialect interface implementation.
- More advanced diffing (constraints, triggers, etc.).
- Enhanced Operation types for complex schema changes.
- Improved error handling and reporting.
- Richer config validation and editor integration.
- Advanced container orchestration features (health checks, resource limits).
- Integration with CI/CD pipelines for automated migration testing.
- Dialect plugin system for third-party database support.
