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
  db: Kysely<any>;
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
          up: async () => {
            await buildMigrationFromDiff(props.db, migration.diff);
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
  // Sort operations by dependency to ensure correct execution order
  const sortedOperations = sortOperationsByDependency(diff.operations);

  for (const operation of sortedOperations) {
    await executeOperation(db, operation);
  }
}

async function executeOperation(db: Kysely<any>, operation: Operation) {
  switch (operation.type) {
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

  // 3. Create tables and columns
  create_table: 6,
  add_column: 7,

  // 4. Alter columns
  alter_column: 8,

  // 5. Create indexes and constraints last (lowest priority)
  create_index: 9,
  create_primary_key_constraint: 10,
  create_unique_constraint: 11,
  create_foreign_key_constraint: 12, // Foreign keys must be created last
} as const;

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
