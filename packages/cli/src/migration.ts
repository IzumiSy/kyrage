import {
  ColumnDataType,
  DEFAULT_MIGRATION_TABLE,
  isColumnDataType,
  Kysely,
  Migration,
  sql,
} from "kysely";
import { TableDiff } from "./diff";
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
  diff: TableDiff
): Promise<void> {
  // 1. 追加テーブル
  for (const added of diff.addedTables) {
    let builder = db.schema.createTable(added.table);
    for (const [colName, colDef] of Object.entries(added.columns)) {
      const dataType = colDef.type;
      assertDataType(dataType);
      builder = builder.addColumn(colName, dataType, (col) => {
        let c = col;
        if (colDef.notNull) c = c.notNull();
        if (colDef.primaryKey) c = c.primaryKey();
        if (colDef.unique) c = c.unique();
        if (colDef.defaultSql)
          c = c.defaultTo(sql.raw(colDef.defaultSql as string));
        return c;
      });
    }
    await builder.execute();
  }

  // 2. 削除テーブル
  for (const removed of diff.removedTables) {
    await db.schema.dropTable(removed).execute();
  }

  // 3. 変更テーブル
  for (const changed of diff.changedTables) {
    // 追加カラム
    for (const addCol of changed.addedColumns) {
      const dataType = addCol.attributes.type;
      assertDataType(dataType);
      await db.schema
        .alterTable(changed.table)
        .addColumn(addCol.column, dataType, (col) => {
          let c = col;
          if (addCol.attributes.notNull) c = c.notNull();
          if (addCol.attributes.primaryKey) c = c.primaryKey();
          if (addCol.attributes.unique) c = c.unique();
          if (addCol.attributes.defaultSql) {
            c = c.defaultTo(sql.raw(addCol.attributes.defaultSql as string));
          }
          return c;
        })
        .execute();
    }
    // 削除カラム
    for (const remCol of changed.removedColumns) {
      await db.schema
        .alterTable(changed.table)
        .dropColumn(remCol.column)
        .execute();
    }
    // 型変更カラム
    for (const chCol of changed.changedColumns) {
      // dataTypeの変更
      if (chCol.before.type !== chCol.after.type) {
        const dataType = chCol.after.type;
        assertDataType(dataType);
        await db.schema
          .alterTable(changed.table)
          .alterColumn(chCol.column, (col) => col.setDataType(dataType))
          .execute();
      }

      // notNull/nullableの変更
      if (chCol.after.notNull !== chCol.before.notNull) {
        if (chCol.after.notNull) {
          await db.schema
            .alterTable(changed.table)
            .alterColumn(chCol.column, (col) => col.setNotNull())
            .execute();
        } else {
          await db.schema
            .alterTable(changed.table)
            .alterColumn(chCol.column, (col) => col.dropNotNull())
            .execute();
        }
      }
    }
  }
}

const assertDataType: (
  dataType: string
) => asserts dataType is ColumnDataType = (dataType) => {
  if (!isColumnDataType(dataType)) {
    throw new Error(`Unsupported data type: ${dataType}`);
  }
};
