import {
  ColumnDataType,
  DEFAULT_MIGRATION_TABLE,
  CreateTableBuilder,
  isColumnDataType,
  Kysely,
  Migration,
  sql,
} from "kysely";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { DBClient } from "./client";
import z from "zod";
import { Operation, operationSchema } from "./operation";
import * as R from "ramda";

export const migrationDirName = "migrations";
export const schemaDiffSchema = z.object({
  operations: z.array(operationSchema).readonly(),
});
export type SchemaDiff = z.infer<typeof schemaDiffSchema>;
export const migrationSchema = z.object({
  id: z.string(),
  version: z.string(),
  diff: schemaDiffSchema,
});

export const getAllMigrations = async () => {
  try {
    const files = await readdir(migrationDirName);
    const migrationJSONFiles = files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) =>
        migrationSchema.parse(
          JSON.parse(await readFile(join(migrationDirName, file), "utf-8"))
        )
      );
    return await Promise.all(migrationJSONFiles);
  } catch (error) {
    if (error instanceof Object && "code" in error && error.code === "ENOENT") {
      // Migration directory does not exist, return an empty array
      return [];
    }
    throw error;
  }
};

export const getPendingMigrations = async (client: DBClient) => {
  await using db = client.getDB();
  const migrationFiles = await getAllMigrations();

  // If no migration table exists, it should be the initial time to apply migrations
  // All migrations are marked as pending
  const tables = (
    await db.introspection.getTables({
      withInternalKyselyTables: true,
    })
  ).map((t) => t.name);
  if (!tables.includes(DEFAULT_MIGRATION_TABLE)) {
    return migrationFiles;
  }

  const executedMigrations = await db
    .selectFrom(DEFAULT_MIGRATION_TABLE)
    .select(["name", "timestamp"])
    .$narrowType<{ name: string; timestamp: string }>()
    .execute();

  return migrationFiles.filter(
    (file) => !executedMigrations.some((m) => m.name === file.id)
  );
};

type CreateMigrationProviderProps = {
  migrationsResolver: () => Promise<
    ReadonlyArray<z.infer<typeof migrationSchema>>
  >;
  options: {
    plan: boolean;
  };
};

export const createMigrationProvider = (
  props: CreateMigrationProviderProps
) => {
  return {
    getMigrations: async () => {
      const migrationFiles = await props.migrationsResolver();
      const migrations: Record<string, Migration> = {};
      migrationFiles.forEach((migration) => {
        migrations[migration.id] = {
          up: async (db) => {
            await buildMigrationFromDiff(db, migration.diff);
          },
        };
      });

      return migrations;
    },
  };
};

export async function buildMigrationFromDiff(
  db: Kysely<any>,
  diff: SchemaDiff
) {
  const buildOperations = R.pipe(
    // Filter out operations for tables that will be dropped
    filterOperationsForDroppedTables,
    // Merge table creation with constraints ← 追加
    mergeTableCreationWithConstraints,
    // Filter out redundant DROP INDEX operations that would fail due to
    // automatic index deletion when dropping constraints
    filterRedundantDropIndexOperations,
    // Sort operations by dependency to ensure correct execution order
    sortOperationsByDependency
  );

  for (const operation of buildOperations(diff.operations)) {
    await executeOperation(db, operation);
  }
}

async function executeOperation(db: Kysely<any>, operation: Operation) {
  switch (operation.type) {
    case "create_table_with_constraints":
      return executeCreateTableWithConstraints(db, operation);
    case "create_table":
      return executeCreateTable(db, operation);
    case "drop_table":
      return executeDropTable(db, operation);
    case "add_column":
      return executeAddColumn(db, operation);
    case "drop_column":
      return executeDropColumn(db, operation);
    case "alter_column":
      return executeAlterColumn(db, operation);
    case "create_index":
      return executeCreateIndex(db, operation);
    case "drop_index":
      return executeDropIndex(db, operation);
    case "create_primary_key_constraint":
      return executeCreatePrimaryKeyConstraint(db, operation);
    case "drop_primary_key_constraint":
      return executeDropPrimaryKeyConstraint(db, operation);
    case "create_unique_constraint":
      return executeCreateUniqueConstraint(db, operation);
    case "drop_unique_constraint":
      return executeDropUniqueConstraint(db, operation);
    case "create_foreign_key_constraint":
      return executeCreateForeignKeyConstraint(db, operation);
    case "drop_foreign_key_constraint":
      return executeDropForeignKeyConstraint(db, operation);
    default:
      throw new Error(`Unknown operation type: ${(operation as any).type}`);
  }
}

async function executeCreateTable(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_table" }>
) {
  let builder: CreateTableBuilder<string, any> = db.schema.createTable(
    operation.table
  );

  for (const [colName, colDef] of Object.entries(operation.columns)) {
    const dataType = colDef.type;
    assertDataType(dataType);
    builder = builder.addColumn(colName, dataType, (col) => {
      let c = col;
      if (colDef.notNull) c = c.notNull();
      if (typeof colDef.defaultSql === "string") {
        c = c.defaultTo(sql.raw(colDef.defaultSql));
      }
      return c;
    });
  }

  await builder.execute();
}

async function executeCreateTableWithConstraints(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_table_with_constraints" }>
) {
  let builder: CreateTableBuilder<string, any> = db.schema.createTable(
    operation.table
  );

  // カラム追加
  for (const [colName, colDef] of Object.entries(operation.columns)) {
    const dataType = colDef.type;
    assertDataType(dataType);
    builder = builder.addColumn(colName, dataType, (col) => {
      let c = col;
      if (colDef.notNull) c = c.notNull();
      if (typeof colDef.defaultSql === "string") {
        c = c.defaultTo(sql.raw(colDef.defaultSql));
      }
      return c;
    });
  }

  // Primary KeyとUnique制約のみをInlineで追加
  if (operation.constraints) {
    const { primaryKey, unique } = operation.constraints;

    // Primary Key制約
    if (primaryKey) {
      builder = builder.addPrimaryKeyConstraint(
        primaryKey.name,
        primaryKey.columns as Array<string>
      );
    }

    // Unique制約
    if (unique) {
      for (const uq of unique) {
        builder = builder.addUniqueConstraint(
          uq.name,
          uq.columns as Array<string>
        );
      }
    }
  }

  await builder.execute();
}

async function executeDropTable(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_table" }>
) {
  await db.schema.dropTable(operation.table).execute();
}

async function executeAddColumn(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "add_column" }>
) {
  const dataType = operation.attributes.type;
  assertDataType(dataType);

  await db.schema
    .alterTable(operation.table)
    .addColumn(operation.column, dataType, (col) => {
      let c = col;
      if (operation.attributes.notNull) c = c.notNull();
      if (typeof operation.attributes.defaultSql === "string") {
        c = c.defaultTo(sql.raw(operation.attributes.defaultSql));
      }
      return c;
    })
    .execute();
}

async function executeDropColumn(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_column" }>
) {
  await db.schema
    .alterTable(operation.table)
    .dropColumn(operation.column)
    .execute();
}

async function executeAlterColumn(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "alter_column" }>
) {
  const { table, column, before, after } = operation;

  // dataType
  if (before.type !== after.type) {
    const dataType = after.type;
    assertDataType(dataType);
    await db.schema
      .alterTable(table)
      .alterColumn(column, (col) => col.setDataType(dataType))
      .execute();
  }

  // notNull
  if (after.notNull !== before.notNull) {
    if (after.notNull) {
      await db.schema
        .alterTable(table)
        .alterColumn(column, (col) => col.setNotNull())
        .execute();
    } else {
      await db.schema
        .alterTable(table)
        .alterColumn(column, (col) => col.dropNotNull())
        .execute();
    }
  }
}

async function executeCreateIndex(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_index" }>
) {
  let builder = db.schema.createIndex(operation.name).on(operation.table);

  for (const column of operation.columns) {
    builder = builder.column(column);
  }

  if (operation.unique) {
    builder = builder.unique();
  }

  await builder.execute();
}

async function executeDropIndex(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_index" }>
) {
  await db.schema.dropIndex(operation.name).execute();
}

async function executeCreatePrimaryKeyConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_primary_key_constraint" }>
) {
  await db.schema
    .alterTable(operation.table)
    .addPrimaryKeyConstraint(operation.name, operation.columns as Array<string>)
    .execute();
}

async function executeDropPrimaryKeyConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_primary_key_constraint" }>
) {
  await db.schema
    .alterTable(operation.table)
    .dropConstraint(operation.name)
    .execute();
}

async function executeCreateUniqueConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_unique_constraint" }>
) {
  await db.schema
    .alterTable(operation.table)
    .addUniqueConstraint(operation.name, operation.columns as Array<string>)
    .execute();
}

async function executeDropUniqueConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_unique_constraint" }>
) {
  await db.schema
    .alterTable(operation.table)
    .dropConstraint(operation.name)
    .execute();
}

async function executeCreateForeignKeyConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_foreign_key_constraint" }>
) {
  let builder = db.schema
    .alterTable(operation.table)
    .addForeignKeyConstraint(
      operation.name,
      operation.columns as Array<string>,
      operation.referencedTable,
      operation.referencedColumns as Array<string>
    );

  if (operation.onDelete) {
    builder = builder.onDelete(operation.onDelete);
  }
  if (operation.onUpdate) {
    builder = builder.onUpdate(operation.onUpdate);
  }

  await builder.execute();
}

async function executeDropForeignKeyConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_foreign_key_constraint" }>
) {
  await db.schema
    .alterTable(operation.table)
    .dropConstraint(operation.name)
    .execute();
}

const assertDataType: (
  dataType: string
) => asserts dataType is ColumnDataType = (dataType) => {
  if (!isColumnDataType(dataType)) {
    throw new Error(`Unsupported data type: ${dataType}`);
  }
};

// Operation priority for dependency sorting
// Lower numbers have higher priority (executed first)
const OPERATION_PRIORITY = {
  // 1. Drop constraints and indexes first (highest priority)
  drop_foreign_key_constraint: 0, // Foreign keys must be dropped first
  drop_unique_constraint: 1,
  drop_primary_key_constraint: 2,
  drop_index: 3,

  // 2. Drop columns and tables
  drop_column: 4,
  drop_table: 5,

  // 3. Create tables and columns (統合版が優先)
  create_table_with_constraints: 6,
  create_table: 7,
  add_column: 8,

  // 4. Alter columns
  alter_column: 9,

  // 5. Create indexes and constraints last (lowest priority)
  create_index: 10,
  create_primary_key_constraint: 11,
  create_unique_constraint: 12,
  create_foreign_key_constraint: 13, // Foreign keys must be created last
} as const;

/**
 * Filter out redundant operations for tables that are being dropped.
 * When a table is dropped, all operations affecting that table become redundant.
 *
 * This prevents unnecessary operations and potential errors when attempting
 * to alter or modify tables that will be dropped anyway.
 */
export const filterOperationsForDroppedTables = (
  operations: ReadonlyArray<Operation>
): ReadonlyArray<Operation> => {
  // Identify tables that are being dropped
  const droppedTables = new Set<string>();
  operations.forEach((operation) => {
    if (operation.type === "drop_table") {
      droppedTables.add(operation.table);
    }
  });

  // If no tables are being dropped, return all operations unchanged
  if (droppedTables.size === 0) {
    return operations;
  }

  // Filter out operations that affect dropped tables
  return operations.filter((operation) => {
    if (operation.type === "drop_table") {
      return true; // Keep drop_table operations
    }

    // Skip operations on tables that will be dropped
    if (droppedTables.has(operation.table)) {
      return false;
    }

    return true;
  });
};

/**
 * Filter out redundant DROP INDEX operations that would fail due to
 * automatic index deletion when dropping unique/primary key constraints.
 *
 * This prevents "index does not exist" errors in databases like PostgreSQL
 * and MySQL where dropping a constraint automatically drops its backing index.
 */
export const filterRedundantDropIndexOperations = (
  operations: ReadonlyArray<Operation>
): ReadonlyArray<Operation> => {
  // Build a map of constraints being dropped and their potential index names
  const droppedConstraintIndexes = new Set<string>();

  // First pass: identify constraints being dropped
  operations.forEach((operation) => {
    if (
      operation.type === "drop_unique_constraint" ||
      operation.type === "drop_primary_key_constraint"
    ) {
      // In most databases, constraint name often matches index name
      // Store as table.indexName for uniqueness
      droppedConstraintIndexes.add(`${operation.table}.${operation.name}`);
    }
  });

  // Second pass: filter out redundant drop_index operations
  return operations.filter((operation) => {
    if (operation.type === "drop_index") {
      const indexKey = `${operation.table}.${operation.name}`;

      // Skip this drop_index if there's a corresponding constraint drop
      if (droppedConstraintIndexes.has(indexKey)) {
        return false;
      }
    }

    return true;
  });
};

/**
 * Sort operations by dependency to ensure correct execution order.
 * This prevents issues like trying to alter a dropped table or
 * creating constraints before the required tables exist.
 */
export const sortOperationsByDependency = (
  operations: ReadonlyArray<Operation>
) =>
  operations.slice().sort((a, b) => {
    const priorityA = OPERATION_PRIORITY[a.type];
    const priorityB = OPERATION_PRIORITY[b.type];

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    return a.table.localeCompare(b.table);
  });

/**
 * create_tableとprimary key/unique制約を統合する
 * foreign key制約は依存関係が複雑なため除外し、従来通り別オペレーションとして処理
 */
export const mergeTableCreationWithConstraints = (
  operations: ReadonlyArray<Operation>
): ReadonlyArray<Operation> => {
  // 第1パス: create_tableオペレーションを特定
  const createTableTables = new Set<string>();
  operations.forEach((op) => {
    if (op.type === "create_table") {
      createTableTables.add(op.table);
    }
  });

  // create_tableがない場合は何もしない
  if (createTableTables.size === 0) {
    return operations;
  }

  // 第2パス: オペレーションを分類
  const createTableOps = new Map<
    string,
    Extract<Operation, { type: "create_table" }>
  >();
  const constraintOpsForTables = new Map<string, Array<Operation>>();
  const remainingOps: Array<Operation> = [];

  operations.forEach((op) => {
    if (op.type === "create_table") {
      createTableOps.set(op.table, op);
    } else if (
      // foreign key制約は除外し、primary keyとunique制約のみ統合対象とする
      (op.type === "create_primary_key_constraint" ||
        op.type === "create_unique_constraint") &&
      createTableTables.has(op.table)
    ) {
      const existing = constraintOpsForTables.get(op.table) || [];
      constraintOpsForTables.set(op.table, [...existing, op]);
    } else {
      // foreign key制約や他のオペレーションは残りのオペレーションとして処理
      remainingOps.push(op);
    }
  });

  // create_table_with_constraintsを生成
  const mergedOps: Array<Operation> = [];

  createTableOps.forEach((createTableOp, tableName) => {
    const tableConstraints = constraintOpsForTables.get(tableName) || [];

    if (tableConstraints.length === 0) {
      // constraintがない場合は通常のcreate_table
      mergedOps.push(createTableOp);
    } else {
      // primary keyとunique制約がある場合はcreate_table_with_constraintsに変換
      const constraints: any = {};

      tableConstraints.forEach((constraint) => {
        if (constraint.type === "create_primary_key_constraint") {
          constraints.primaryKey = {
            name: constraint.name,
            columns: constraint.columns,
          };
        } else if (constraint.type === "create_unique_constraint") {
          if (!constraints.unique) constraints.unique = [];
          constraints.unique.push({
            name: constraint.name,
            columns: constraint.columns,
          });
        }
      });

      mergedOps.push({
        type: "create_table_with_constraints" as const,
        table: createTableOp.table,
        columns: createTableOp.columns,
        constraints,
      });
    }
  });

  return [...mergedOps, ...remainingOps];
};
