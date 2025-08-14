import { mkdir, writeFile } from "fs/promises";
import { Logger } from "../logger";
import { migrationDirName, getPendingMigrations } from "../migration";
import { runApply } from "./apply";
import { DBClient } from "../client";
import { Tables, diffSchema, SchemaDiff, SchemaSnapshot } from "../diff";
import { ConfigValue } from "../schema";
import { getIntrospector } from "../introspection/introspector";

export const runGenerate = async (props: {
  client: DBClient;
  logger: Logger;
  config: ConfigValue;
  options: {
    ignorePending: boolean;
    apply: boolean;
    plan: boolean;
  };
}) => {
  const { reporter } = props.logger;
  const loadedConfig = props.config;
  if (!props.options.ignorePending) {
    const pm = await getPendingMigrations(props.client);
    if (pm.length > 0) {
      reporter.warn(
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
    client: props.client,
    config: loadedConfig,
  });

  if (!newMigration) {
    reporter.info("No changes detected, no migration needed.");
    return;
  }

  printPrettyDiff(props.logger, newMigration.diff);

  const migrationFilePath = `${migrationDirName}/${newMigration.id}.json`;
  await mkdir(migrationDirName, { recursive: true });
  await writeFile(migrationFilePath, JSON.stringify(newMigration, null, 2));

  reporter.success(`Migration file generated: ${migrationFilePath}`);

  if (props.options.apply) {
    await runApply({
      client: props.client,
      logger: props.logger,
      options: {
        plan: props.options.plan,
        pretty: false,
      },
    });
  }
};

const generateMigrationFromIntrospection = async (props: {
  client: DBClient;
  config: ConfigValue;
}) => {
  const { client, config } = props;
  const introspector = getIntrospector(client);
  const tables = await introspector.getTables();
  const indexes = await introspector.getIndexes();

  const dbTables: Tables = tables.map((table) => ({
    name: table.name,
    columns: Object.fromEntries(
      Object.entries(table.columns).map(([colName, colDef]) => {
        return [
          colName,
          {
            type: colDef.dataType,
            notNull: colDef.notNull,
            primaryKey: !!colDef.constraints.find(
              (c) => c.type === "PRIMARY KEY"
            ),
            unique: !!colDef.constraints.find((c) => c.type === "UNIQUE"),
            defaultSql: colDef.default ?? undefined,
          },
        ];
      })
    ),
  }));

  const configTables: Tables = config.tables.map((table) => ({
    name: table.tableName,
    columns: Object.fromEntries(
      Object.entries(table.columns).map(([colName, colDef]) => [
        colName,
        {
          ...colDef,
          notNull: colDef.primaryKey || colDef.notNull,
        },
      ])
    ),
  }));

  const currentSnapshot: SchemaSnapshot = {
    tables: dbTables,
    indexes,
  };
  const idealSnapshot: SchemaSnapshot = {
    tables: configTables,
    indexes: config.indexes.map((i) => ({
      table: i.table,
      name: i.name,
      columns: i.columns,
      unique: i.unique,
      systemGenerated: false,
    })),
  };
  const diff = diffSchema({
    current: currentSnapshot,
    ideal: idealSnapshot,
  });

  if (
    diff.addedTables.length === 0 &&
    diff.removedTables.length === 0 &&
    diff.changedTables.length === 0 &&
    diff.addedIndexes.length === 0 &&
    diff.removedIndexes.length === 0 &&
    diff.changedIndexes.length === 0
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

const printPrettyDiff = (logger: Logger, diff: SchemaDiff) => {
  const diffOutputs: string[] = [];

  // Show changes one by one like (added_table, changed_column, etc.)
  if (diff.addedTables.length > 0) {
    diff.addedTables.forEach((table) => {
      diffOutputs.push(`-- create_table: ${table.table}`);
      Object.entries(table.columns).forEach(([colName, colDef]) => {
        diffOutputs.push(
          `   -> column: ${colName} (${JSON.stringify(colDef)})`
        );
      });
    });
  }
  if (diff.removedTables.length > 0) {
    diff.removedTables.forEach((table) => {
      diffOutputs.push(`-- remove_table: ${table}`);
    });
  }
  if (diff.changedTables.length > 0) {
    diff.changedTables.forEach((table) => {
      table.addedColumns.forEach((col) => {
        diffOutputs.push(
          [
            `-- add_column: ${table.table}.${col.column}`,
            `   -> to: ${JSON.stringify(col.attributes)}`,
          ].join("\n")
        );
      });
      table.removedColumns.forEach((col) => {
        diffOutputs.push(`-- remove_column: ${table.table}.${col.column}`);
      });
      table.changedColumns.forEach((col) => {
        diffOutputs.push(
          [
            `-- change_column: ${table.table}.${col.column}`,
            `   -> from: ${JSON.stringify(col.before)}`,
            `   -> to:   ${JSON.stringify(col.after)}`,
          ].join("\n")
        );
      });
    });
  }

  if (diff.changedIndexes.length > 0) {
    diff.changedIndexes.forEach((ix) => {
      diffOutputs.push(
        [
          `-- change_index: ${ix.table}.${ix.name}`,
          `   -> from: ${ix.before.columns.join(", ")}${ix.before.unique ? " [unique]" : ""}`,
          `   -> to:   ${ix.after.columns.join(", ")}${ix.after.unique ? " [unique]" : ""}`,
          `   -> actions: drop_index + create_index`,
        ].join("\n")
      );
    });
  }
  if (diff.addedIndexes.length > 0) {
    diff.addedIndexes.forEach((ix) => {
      diffOutputs.push(
        `-- create_index: ${ix.table}.${ix.name} (${ix.columns.join(", ")})${ix.unique ? " [unique]" : ""}`
      );
    });
  }
  if (diff.removedIndexes.length > 0) {
    diff.removedIndexes.forEach((ix) => {
      diffOutputs.push(`-- drop_index: ${ix.table}.${ix.name}`);
    });
  }

  logger.reporter.log(diffOutputs.join("\n"));
};
