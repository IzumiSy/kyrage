import { mkdir, writeFile } from "fs/promises";
import { Logger } from "../logger";
import { migrationDirName, getPendingMigrations } from "../migration";
import { runApply } from "./apply";
import { DBClient } from "../client";
import { diffSchema } from "../diff";
import { SchemaDiff, SchemaSnapshot, Tables, Operation } from "../operation";
import { ConfigValue } from "../schema";
import { getIntrospector } from "../introspection/introspector";
import { postgresExtraIntrospector } from "../introspection/postgres";
import { ConstraintAttributes } from "../introspection/type";

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
  const extraIntrospector = postgresExtraIntrospector({ client });
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

  const constraintAttributes: ConstraintAttributes =
    await extraIntrospector.introspectConstraints();

  const primaryKeyConstraints = constraintAttributes
    .filter((c) => c.type === "PRIMARY KEY")
    .map((c) => ({
      table: c.table,
      name: c.name,
      columns: c.columns,
    }));

  const uniqueConstraints = constraintAttributes
    .filter((c) => c.type === "UNIQUE")
    .map((c) => ({
      table: c.table,
      name: c.name,
      columns: c.columns,
    }));

  const currentSnapshot: SchemaSnapshot = {
    tables: dbTables,
    indexes,
    primaryKeyConstraints,
    uniqueConstraints,
  };
  const idealSnapshot: SchemaSnapshot = {
    tables: configTables,
    indexes: config.indexes.map((i) => ({
      table: i.table,
      name: i.name,
      columns: i.columns,
      unique: i.unique,
    })),
    primaryKeyConstraints: config.primaryKeyConstraints || [],
    uniqueConstraints: config.uniqueConstraints || [],
  };
  const diff = diffSchema({
    current: currentSnapshot,
    ideal: idealSnapshot,
  });

  if (diff.operations.length === 0) {
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

  diff.operations.forEach((operation: Operation) => {
    switch (operation.type) {
      case "create_table":
        diffOutputs.push(`-- create_table: ${operation.table}`);
        Object.entries(operation.columns).forEach(([colName, colDef]) => {
          diffOutputs.push(
            `   -> column: ${colName} (${JSON.stringify(colDef)})`
          );
        });
        break;

      case "drop_table":
        diffOutputs.push(`-- remove_table: ${operation.table}`);
        break;

      case "add_column":
        diffOutputs.push(
          [
            `-- add_column: ${operation.table}.${operation.column}`,
            `   -> to: ${JSON.stringify(operation.attributes)}`,
          ].join("\n")
        );
        break;

      case "drop_column":
        diffOutputs.push(
          `-- remove_column: ${operation.table}.${operation.column}`
        );
        break;

      case "alter_column":
        diffOutputs.push(
          [
            `-- change_column: ${operation.table}.${operation.column}`,
            `   -> from: ${JSON.stringify(operation.before)}`,
            `   -> to:   ${JSON.stringify(operation.after)}`,
          ].join("\n")
        );
        break;

      case "create_index":
        diffOutputs.push(
          `-- create_index: ${operation.table}.${operation.name} (${operation.columns.join(", ")})${operation.unique ? " [unique]" : ""}`
        );
        break;

      case "drop_index":
        diffOutputs.push(`-- drop_index: ${operation.table}.${operation.name}`);
        break;

      default:
        break;
    }
  });

  logger.reporter.log(diffOutputs.join("\n"));
};
