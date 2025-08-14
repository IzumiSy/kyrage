# DESIGN.md

## Overview

This document describes the internal design and architecture of `kyrage`. It is intended for contributors and maintainers.

`kyrage` is a declarative database schema migration tool that uses **Operation-based Architecture** to represent all schema changes as a unified array of operations, enabling better composability, testability, and maintainability.

---

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
  | { type: "drop_table"; table: string }
  | { type: "add_column"; table: string; column: string; attributes: TableColumnAttributes }
  | { type: "drop_column"; table: string; column: string; attributes: TableColumnAttributes }
  | { type: "alter_column"; table: string; column: string; before: TableColumnAttributes; after: TableColumnAttributes }
  | { type: "create_index"; table: string; name: string; columns: string[]; unique: boolean }
  | { type: "drop_index"; table: string; name: string };

type SchemaDiff = {
  operations: Operation[];
};
```

### Benefits

1. **Unified Processing**: Single loop handles all operations consistently
2. **Order Control**: Operations execute in array order, enabling dependency management
3. **Testability**: Complete diff can be asserted as a single data structure
4. **Extensibility**: New operation types integrate seamlessly
5. **Maintainability**: No code duplication between console output, SQL generation, and testing

---

## Key Modules

### 1. Schema Definition (`schema.ts`)

Handles table and column definitions with strong typing.

```typescript
const schema = {
  users: {
    id: { type: "serial", primary: true },
    name: { type: "varchar", length: 255, notNull: true },
    email: { type: "varchar", length: 255, unique: true }
  }
};
```

### 2. Schema Introspection (`introspection/`)

**Purpose**: Extract current database schema for comparison

**Architecture**:
- `introspector.ts`: Core interface and coordination
- `postgres.ts`: PostgreSQL-specific implementation  
- `type.ts`: Schema representation types

**Key Function**: `introspectSchema()` returns standardized schema structure regardless of database dialect.

### 3. Diff Calculation (`diff.ts`)

**Purpose**: Generate Operation arrays representing schema changes

**Core Function**:
```typescript
function diffSchema(expected: Schema, actual: Schema): SchemaDiff {
  const operations: Operation[] = [];
  // Generate operations for table/column/index differences
  return { operations };
}
```

**Strategy**:
- Compare expected vs actual schemas using functional utilities (Ramda `eqBy`)
- Generate operations in dependency-safe order
- Return unified operation array for consistent processing

**Operation Types**:
- Table operations: `create_table`, `drop_table`
- Column operations: `add_column`, `drop_column`, `alter_column`  
- Index operations: `create_index`, `drop_index`

### 4. Migration Execution (`migration.ts`)

**Purpose**: Execute Operation arrays against database

**Architecture**:
```typescript
function buildMigrationFromDiff(diff: SchemaDiff, db: Kysely<any>): Promise<void> {
  for (const operation of diff.operations) {
    await executeOperation(operation, db);
  }
}

function executeOperation(operation: Operation, db: Kysely<any>): Promise<void> {
  switch (operation.type) {
    case "create_table": return executeCreateTable(operation, db);
    case "drop_table": return executeDropTable(operation, db);
    case "add_column": return executeAddColumn(operation, db);
    // ... handle all operation types
  }
}
```

**Benefits**: 
- Single execution path for all operations
- Type-safe operation handling with exhaustive switch
- Consistent error handling and transaction management

### 5. Console Output (`generate.ts`)

**Purpose**: Human-readable diff presentation

**Implementation**:
```typescript
function printPrettyDiff(diff: SchemaDiff): void {
  for (const operation of diff.operations) {
    switch (operation.type) {
      case "create_table":
        console.log(`+ CREATE TABLE ${operation.table}`);
        break;
      case "add_column":
        console.log(`+ ADD COLUMN ${operation.table}.${operation.column}`);
        break;
      // ... format all operation types
    }
  }
}
```

**Benefits**:
- Consistent formatting across all operation types
- Unified processing with migration execution
- Easy to extend for new operation types

---

## Package Structure

- `packages/cli/`  
  Main CLI implementation and entry point.

- `packages/cli/src/`  
  - `main.ts`: CLI entry point, command definitions, and execution flow.
  - `operation.ts`: Operation type definitions and schema validation for array-based architecture.
  - `diff.ts`: Calculates Operation arrays representing schema differences.
  - `introspection/`: Database schema introspection modules.
  - `migration.ts`: Executes Operation arrays against the database.
  - `generate.ts`: Formats Operation arrays for console output and file generation.
  - `schema.ts`: Schema validation and config typing.
  - `tests/`: Unit tests for core logic including comprehensive Operation array validation.

- `examples/basic/`  
  Example project and configuration.

---

## Main Flow

1. **Configuration Loading**  
   Loads and validates `kyrage.config.ts` using Zod schema.

2. **Database Introspection**  
   Connects to the target database and introspects the current schema.

3. **Diff Calculation**  
   Uses `diffSchema` to compute Operation arrays representing differences between current and desired schema.

4. **Migration Planning & Execution**  
   - Generates migration files as JSON containing Operation arrays in the `migrations/` directory.
   - `generate` command creates migration files from schema diff operations.
   - `apply` command executes operations against the database.
   - `--dry-run` option for `apply` outputs SQL without executing.

5. **Operation Processing**  
   All modules (console output, SQL generation, testing) process the same Operation arrays using unified patterns, ensuring consistency and maintainability.

---

## Design Considerations

- **Declarative Schema**: Users define the desired schema in TypeScript, enabling type safety and flexibility.
- **Operation-based Architecture**: All schema changes represented as unified Operation arrays for better maintainability.
- **Functional Programming**: Uses Ramda utilities like `eqBy` for immutable schema comparison.
- **Diff-based Migration**: Only the necessary changes are applied, minimizing risk and manual intervention.
- **Dry-run Support**: The `--dry-run` option for `apply` allows users to preview SQL before execution.
- **Extensibility**: The modular Operation-based architecture makes it easy to add support for new databases and features.

### Operation-based Architecture Benefits

The core design uses a unified Operation array approach:

```typescript
type Operation = CreateTable | DropTable | AddColumn | DropColumn | AlterColumn | CreateIndex | DropIndex;
type SchemaDiff = { operations: Operation[] };
```

**Key Advantages**:
- **Unified Processing**: Single `for...of` loop handles all operations consistently
- **Order Control**: Operations execute in array order for dependency management
- **Testability**: Complete diff assertable as single data structure using `toEqual()`
- **Maintainability**: No code duplication between console output, SQL generation, and testing
- **Extensibility**: New operation types integrate seamlessly

---

## Future Work

- Support for MySQL, SQLite, MSSQL.
- More advanced diffing (constraints, triggers, etc.).
- Enhanced Operation types for complex schema changes.
- Improved error handling and reporting.
- Richer config validation and editor integration.
