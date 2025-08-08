import { mkdir, writeFile } from "fs/promises";
import { Kysely } from "kysely";
import { logger } from "../logger";
import { readMigrationFiles, migrationDirName } from "../migration";
import { runApply } from "./apply";
import { DBClient } from "../client";
import { Tables, TableColumnAttributes, diffTables, TableDiff } from "../diff";
import { ConfigValue } from "../schema";

export const runGenerate = async (props: {
  client: DBClient;
  config: ConfigValue;
  options: {
    ignorePending: boolean;
    apply: boolean;
    plan: boolean;
  };
}) => {
  await using db = props.client.getDB();
  const loadedConfig = props.config;

  if (!props.options.ignorePending) {
    const pm = await getPendingMigrations(db);
    if (pm.length > 0) {
      logger.warn(
        [
          `There are pending migrations: ${pm.map((m) => m.id).join(", ")}`,
          "Please apply them first before generating a new migration.",
          "Otherwise, use --ignore-pending to skip this check.",
        ].join("\n")
      );
      return;
    }
  }

  const newMigration = await generateMigrationFromIntrospection({
    db,
    config: loadedConfig,
  });

  if (!newMigration) {
    logger.info("No changes detected, no migration needed.");
    return;
  }

  printPrettyDiff(newMigration.diff);

  const migrationFilePath = `${migrationDirName}/${newMigration.id}.json`;
  await mkdir(migrationDirName, { recursive: true });
  await writeFile(migrationFilePath, JSON.stringify(newMigration, null, 2));

  logger.success(`Migration file generated: ${migrationFilePath}`);

  if (props.options.apply) {
    await runApply({
      client: props.client,
      options: {
        plan: props.options.plan,
      },
    });
  }
};

const getPendingMigrations = async (db: Kysely<any>) => {
  const executedMigrations = await db
    .selectFrom("kysely_migration")
    .select(["name", "timestamp"])
    .$narrowType<{ name: string; timestamp: string }>()
    .execute()
    .catch(() => {
      return [];
    });

  if (executedMigrations.length === 0) {
    return [];
  }

  const migrationFiles = await readMigrationFiles();
  const pendingMigrations = migrationFiles.filter(
    (file) => !executedMigrations.some((m) => m.name === file.id)
  );

  return pendingMigrations;
};

const generateMigrationFromIntrospection = async (props: {
  db: Kysely<unknown>;
  config: ConfigValue;
}) => {
  const { db, config } = props;
  const tables = await db.introspection.getTables();
  const dbTables: Tables = tables.map((table) => ({
    name: table.name,
    columns: (table.columns ?? []).reduce(
      (cols, col) => {
        cols[col.name] = {
          type: col.dataType,
          notNull: !col.isNullable,
        };
        return cols;
      },
      {} as Record<string, TableColumnAttributes>
    ),
  }));

  const configTables: Tables = config.tables.map((table) => ({
    name: table.tableName,
    columns: Object.fromEntries(
      Object.entries(table.columns).map(([colName, colDef]) => [
        colName,
        colDef,
      ])
    ),
  }));

  const diff = diffTables({
    current: dbTables,
    ideal: configTables,
  });

  if (
    diff.addedTables.length === 0 &&
    diff.removedTables.length === 0 &&
    diff.changedTables.length === 0
  ) {
    return null;
  }

  const migrationID = Date.now();
  return {
    version: "1",
    id: migrationID + "",
    diff,
  };
};

const printPrettyDiff = (diff: TableDiff) => {
  // Show changes one by one like (added_table, changed_column, etc.)
  if (diff.addedTables.length > 0) {
    diff.addedTables.forEach((table) => {
      logger.log(`-- create_table: ${table.table}`);
      Object.entries(table.columns).forEach(([colName, colDef]) => {
        logger.log(`   -> column: ${colName} (${JSON.stringify(colDef)})`);
      });
    });
  }
  if (diff.removedTables.length > 0) {
    diff.removedTables.forEach((table) => {
      logger.log(`-- remove_table: ${table}`);
    });
  }
  if (diff.changedTables.length > 0) {
    diff.changedTables.forEach((table) => {
      table.addedColumns.forEach((col) => {
        logger.log(
          [
            `-- add_column: ${table.table}.${col.column}`,
            `   -> to: ${JSON.stringify(col.attributes)}`,
          ].join("\n")
        );
      });
      table.removedColumns.forEach((col) => {
        logger.log(`-- remove_column: ${table.table}.${col.column})`);
      });
      table.changedColumns.forEach((col) => {
        logger.log(
          [
            `-- change_column: ${table.table}.${col.column}`,
            `   -> from: ${JSON.stringify(col.before)}`,
            `   -> to:   ${JSON.stringify(col.after)}`,
          ].join("\n")
        );
      });
    });
  }
};
