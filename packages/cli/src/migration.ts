import {
  ColumnDataType,
  DEFAULT_MIGRATION_TABLE,
  CreateTableBuilder,
  isColumnDataType,
  Kysely,
  Migration,
  sql,
} from "kysely";
import { SchemaDiff, Operation } from "./operation";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { migrationSchema, MigrationValue } from "./schema";
import { DBClient } from "./client";

export const migrationDirName = "migrations";

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
  migrationsResolver: () => Promise<Array<MigrationValue>>;
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
): Promise<void> {
  for (const operation of diff.operations) {
    await executeOperation(db, operation);
  }
}

async function executeOperation(
  db: Kysely<any>,
  operation: Operation
): Promise<void> {
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
    default:
      throw new Error(`Unknown operation type: ${(operation as any).type}`);
  }
}

async function executeCreateTable(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_table" }>
): Promise<void> {
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

    if (colDef.primaryKey) {
      builder = builder.addPrimaryKeyConstraint(
        `${operation.table}_${colName}_primary_key`,
        [colName]
      );
    }

    if (colDef.unique) {
      builder = builder.addUniqueConstraint(
        `${operation.table}_${colName}_unique`,
        [colName]
      );
    }
  }

  await builder.execute();
}

async function executeDropTable(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_table" }>
): Promise<void> {
  await db.schema.dropTable(operation.table).execute();
}

async function executeAddColumn(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "add_column" }>
): Promise<void> {
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

  if (operation.attributes.primaryKey) {
    await db.schema
      .alterTable(operation.table)
      .addPrimaryKeyConstraint(
        `${operation.table}_${operation.column}_primary_key`,
        [operation.column]
      )
      .execute();
  }

  if (operation.attributes.unique) {
    await db.schema
      .alterTable(operation.table)
      .addUniqueConstraint(`${operation.table}_${operation.column}_unique`, [
        operation.column,
      ])
      .execute();
  }
}

async function executeDropColumn(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_column" }>
): Promise<void> {
  await db.schema
    .alterTable(operation.table)
    .dropColumn(operation.column)
    .execute();
}

async function executeAlterColumn(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "alter_column" }>
): Promise<void> {
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

  // primaryKey
  if (after.primaryKey !== before.primaryKey) {
    if (after.primaryKey) {
      await db.schema
        .alterTable(table)
        .addPrimaryKeyConstraint(`${table}_${column}_primary_key`, [column])
        .execute();
    } else {
      await db.schema
        .alterTable(table)
        .dropConstraint(`${table}_${column}_primary_key`)
        .execute();
    }
  }

  // unique
  if (after.unique !== before.unique) {
    if (after.unique) {
      await db.schema
        .alterTable(table)
        .addUniqueConstraint(`${table}_${column}_unique`, [column])
        .execute();
    } else {
      await db.schema
        .alterTable(table)
        .dropConstraint(`${table}_${column}_unique`)
        .execute();
    }
  }
}

async function executeCreateIndex(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_index" }>
): Promise<void> {
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
): Promise<void> {
  await db.schema.dropIndex(operation.name).execute();
}

async function executeCreatePrimaryKeyConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_primary_key_constraint" }>
): Promise<void> {
  await db.schema
    .alterTable(operation.table)
    .addPrimaryKeyConstraint(operation.name, operation.columns)
    .execute();
}

async function executeDropPrimaryKeyConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_primary_key_constraint" }>
): Promise<void> {
  await db.schema
    .alterTable(operation.table)
    .dropConstraint(operation.name)
    .execute();
}

async function executeCreateUniqueConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "create_unique_constraint" }>
): Promise<void> {
  await db.schema
    .alterTable(operation.table)
    .addUniqueConstraint(operation.name, operation.columns)
    .execute();
}

async function executeDropUniqueConstraint(
  db: Kysely<any>,
  operation: Extract<Operation, { type: "drop_unique_constraint" }>
): Promise<void> {
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
