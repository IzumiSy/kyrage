import { mkdir, writeFile } from "fs/promises";
import { Logger, nullLogger } from "../logger";
import {
  migrationDirName,
  getPendingMigrations,
  SchemaDiff,
} from "../migration";
import { runApply } from "./apply";
import { DBClient } from "../client";
import { diffSchema } from "../diff";
import { Tables, Operation } from "../operation";
import { getIntrospector } from "../introspection/introspector";
import { ConfigValue } from "../config/loader";
import { getClient } from "../client";
import { createDevDatabaseManager } from "../dev/container";

type RunGenerateProps = {
  client: DBClient;
  logger: Logger;
  config: ConfigValue;
  options: {
    ignorePending: boolean;
    apply: boolean;
    plan: boolean;
    dev?: boolean;
  };
};

export const runGenerate = async (props: RunGenerateProps) => {
  const { reporter } = props.logger;

  // Create the appropriate client (dev or production)
  const { client: targetClient, cleanup } = await setupDatabaseClient(props);

  try {
    // Always check against production for pending migrations if not in dev mode
    if (!props.options.dev && !props.options.ignorePending) {
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
      client: targetClient,
      config: props.config,
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
      if (props.options.dev) {
        reporter.warn(
          "--apply flag is ignored when using --dev. Use 'kyrage apply' to apply to production database."
        );
      } else {
        await runApply({
          client: props.client,
          logger: props.logger,
          options: {
            plan: props.options.plan,
            pretty: false,
          },
        });
      }
    }
  } finally {
    await cleanup();
  }
};

const setupDatabaseClient = async (props: RunGenerateProps) => {
  const { reporter } = props.logger;

  if (!props.options.dev) {
    return {
      client: props.client,
      cleanup: async () => void 0,
    };
  }

  if (!props.config.dev) {
    throw new Error(
      "Dev database configuration is required when using --dev flag"
    );
  }

  // Create dev database manager
  const devManager = createDevDatabaseManager(
    props.config.dev,
    props.config.database.dialect
  );

  // Check if reuse is enabled and container is already running
  const isReuse =
    "container" in props.config.dev && props.config.dev.container.reuse;
  const isRunning = await devManager.isRunning();

  if (isReuse && isRunning) {
    reporter.info("🔄 Reusing existing dev database...");
    const connectionString = await devManager.getConnectionString();
    if (connectionString) {
      const devDatabase = {
        dialect: props.config.database.dialect,
        connectionString,
      };
      const devClient = getClient({ database: devDatabase });

      return {
        client: devClient,
        cleanup: async () => {
          reporter.success(
            "✨ Persistent dev database ready: " + devDatabase.dialect
          );
        },
      };
    }
  }

  // Start new dev database (existing logic)
  reporter.info("🚀 Starting dev database for migration generation...");

  const devDatabase = await devManager.start();
  reporter.success(`Dev database started: ${devDatabase.dialect}`);

  // Create client for dev database
  const devClient = getClient({ database: devDatabase });

  // Apply baseline migrations to dev database
  await runApply({
    client: devClient,
    logger: nullLogger,
    options: {
      plan: false,
      pretty: false,
    },
  });

  return {
    client: devClient,
    cleanup: async () => {
      if (!isReuse) {
        await devManager.stop();
        reporter.success("Dev database stopped");
      } else {
        reporter.success(
          "✨ Persistent dev database ready: " + devDatabase.dialect
        );
      }
    },
  };
};

const generateMigrationFromIntrospection = async (props: {
  client: DBClient;
  config: ConfigValue;
}) => {
  const { client, config } = props;
  const introspector = getIntrospector(client);
  const tables = await introspector.getTables();
  const constraintAttributes = await introspector.getConstraints();

  // カラム制約の判定
  const columnConstraintPredicate =
    (tableName: string, colName: string) =>
    (
      constraints: ReadonlyArray<{
        table: string;
        columns: ReadonlyArray<string>;
      }>
    ) =>
      constraints.some(
        (constraint) =>
          constraint.table === tableName &&
          constraint.columns.length === 1 &&
          constraint.columns[0] === colName
      );

  const dbTables: Tables = tables.map((table) => ({
    name: table.name,
    columns: Object.fromEntries(
      Object.entries(table.columns).map(([colName, colDef]) => {
        const hasColumnConstraint = columnConstraintPredicate(
          table.name,
          colName
        );

        return [
          colName,
          {
            type: colDef.dataType,
            notNull: colDef.notNull,
            primaryKey: hasColumnConstraint(constraintAttributes.primaryKey),
            unique: hasColumnConstraint(constraintAttributes.unique),
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

  const indexes = await introspector.getIndexes();

  const diff = diffSchema({
    current: {
      tables: dbTables,
      indexes,
      primaryKeyConstraints: constraintAttributes.primaryKey,
      uniqueConstraints: constraintAttributes.unique,
      foreignKeyConstraints: constraintAttributes.foreignKey,
    },
    ideal: {
      tables: configTables,
      indexes: config.indexes.map((i) => ({
        table: i.table,
        name: i.name,
        columns: i.columns,
        unique: i.unique,
      })),
      primaryKeyConstraints: config.primaryKeyConstraints || [],
      uniqueConstraints: config.uniqueConstraints || [],
      foreignKeyConstraints: config.foreignKeyConstraints || [],
    },
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
  const diffOutputs: Array<string> = [];

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

      case "create_primary_key_constraint":
        diffOutputs.push(
          `-- create_primary_key_constraint: ${operation.table}.${operation.name} (${operation.columns.join(", ")})`
        );
        break;

      case "drop_primary_key_constraint":
        diffOutputs.push(
          `-- drop_primary_key_constraint: ${operation.table}.${operation.name}`
        );
        break;

      case "create_unique_constraint":
        diffOutputs.push(
          `-- create_unique_constraint: ${operation.table}.${operation.name} (${operation.columns.join(", ")})`
        );
        break;

      case "drop_unique_constraint":
        diffOutputs.push(
          `-- drop_unique_constraint: ${operation.table}.${operation.name}`
        );
        break;

      case "create_foreign_key_constraint":
        diffOutputs.push(
          `-- create_foreign_key_constraint: ${operation.table}.${operation.name} (${operation.columns.join(", ")}) -> ${operation.referencedTable} (${operation.referencedColumns.join(", ")})${operation.onDelete ? ` ON DELETE ${operation.onDelete.toUpperCase()}` : ""}${operation.onUpdate ? ` ON UPDATE ${operation.onUpdate.toUpperCase()}` : ""}`
        );
        break;

      case "drop_foreign_key_constraint":
        diffOutputs.push(
          `-- drop_foreign_key_constraint: ${operation.table}.${operation.name}`
        );
        break;

      default:
        break;
    }
  });

  logger.reporter.log(diffOutputs.join("\n"));
};
