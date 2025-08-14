import {
  ColumnDataType,
  DEFAULT_MIGRATION_TABLE,
  CreateTableBuilder,
  isColumnDataType,
  Kysely,
  Migration,
  sql,
} from "kysely";
import { SchemaDiff } from "./diff";
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
  // 1. 追加テーブル
  for (const added of diff.addedTables) {
    let builder: CreateTableBuilder<string, any> = db.schema.createTable(
      added.table
    );
    for (const [colName, colDef] of Object.entries(added.columns)) {
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
          `${added.table}_${colName}_primary_key`,
          [colName]
        );
      }
      if (colDef.unique) {
        builder = builder.addUniqueConstraint(
          `${added.table}_${colName}_unique`,
          [colName]
        );
      }
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
          if (typeof addCol.attributes.defaultSql === "string") {
            c = c.defaultTo(sql.raw(addCol.attributes.defaultSql));
          }
          return c;
        })
        .execute();
      if (addCol.attributes.primaryKey) {
        await db.schema
          .alterTable(changed.table)
          .addPrimaryKeyConstraint(
            `${changed.table}_${addCol.column}_primary_key`,
            [addCol.column]
          )
          .execute();
      }
      if (addCol.attributes.unique) {
        await db.schema
          .alterTable(changed.table)
          .addUniqueConstraint(`${changed.table}_${addCol.column}_unique`, [
            addCol.column,
          ])
          .execute();
      }
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
      // dataType
      if (chCol.before.type !== chCol.after.type) {
        const dataType = chCol.after.type;
        assertDataType(dataType);
        await db.schema
          .alterTable(changed.table)
          .alterColumn(chCol.column, (col) => col.setDataType(dataType))
          .execute();
      }

      // notNull
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

      // primaryKey
      if (chCol.after.primaryKey !== chCol.before.primaryKey) {
        if (chCol.after.primaryKey) {
          await db.schema
            .alterTable(changed.table)
            .addPrimaryKeyConstraint(
              `${changed.table}_${chCol.column}_primary_key`,
              [chCol.column]
            )
            .execute();
        } else {
          await db.schema
            .alterTable(changed.table)
            .dropConstraint(`${changed.table}_${chCol.column}_primary_key`)
            .execute();
        }
      }

      // unique
      if (chCol.after.unique !== chCol.before.unique) {
        if (chCol.after.unique) {
          await db.schema
            .alterTable(changed.table)
            .addUniqueConstraint(`${changed.table}_${chCol.column}_unique`, [
              chCol.column,
            ])
            .execute();
        } else {
          await db.schema
            .alterTable(changed.table)
            .dropConstraint(`${changed.table}_${chCol.column}_unique`)
            .execute();
        }
      }
    }
  }
  // 4. Index operations (drop/create based on diff)
  await applyIndexDiff(db, diff);
}

// Index actions expansion (drop/create for changed, etc.)
type IndexAction =
  | { kind: "drop"; table: string; name: string }
  | {
      kind: "create";
      table: string;
      name: string;
      columns: string[];
      unique: boolean;
    };

function expandIndexActions(diff: SchemaDiff): IndexAction[] {
  const actions: IndexAction[] = [];
  // changed => drop then create
  for (const ch of diff.changedIndexes) {
    actions.push({ kind: "drop", table: ch.table, name: ch.name });
    actions.push({
      kind: "create",
      table: ch.table,
      name: ch.name,
      columns: ch.after.columns,
      unique: ch.after.unique,
    });
  }
  // removed (exclude ones already dropped by changed)
  const changedKey = new Set(
    diff.changedIndexes.map((c) => `${c.table}:${c.name}`)
  );
  for (const r of diff.removedIndexes) {
    const key = `${r.table}:${r.name}`;
    if (!changedKey.has(key)) {
      actions.push({ kind: "drop", table: r.table, name: r.name });
    }
  }
  // added (exclude ones already added by changed)
  for (const a of diff.addedIndexes) {
    const key = `${a.table}:${a.name}`;
    if (!changedKey.has(key)) {
      actions.push({
        kind: "create",
        table: a.table,
        name: a.name,
        columns: a.columns,
        unique: a.unique,
      });
    }
  }
  return actions;
}

export async function applyIndexDiff(db: Kysely<any>, diff: SchemaDiff) {
  const actions = expandIndexActions(diff);
  for (const action of actions) {
    if (action.kind === "drop") {
      await db.schema.dropIndex(action.name).on(action.table).execute();
    } else {
      let b = db.schema.createIndex(action.name).on(action.table);
      action.columns.forEach((c) => {
        b = b.column(c);
      });
      if (action.unique) b = b.unique();
      await b.execute();
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
