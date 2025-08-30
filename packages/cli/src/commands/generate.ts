import { defineCommand } from "citty";
import { createCommonDependencies, type CommonDependencies } from "./common";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { nullLogger, type Logger } from "../logger";
import {
  migrationDirName,
  getPendingMigrations,
  SchemaDiff,
} from "../migration";
import { executeApply } from "./apply";
import { diffSchema } from "../diff";
import { Tables, Operation } from "../operation";
import { getIntrospector } from "../introspection/introspector";
import { getClient, type DBClient } from "../client";
import { createDevDatabaseManager } from "../dev/container";
import { type ConfigValue } from "../config/loader";

export interface GenerateOptions {
  ignorePending: boolean;
  apply: boolean;
  plan: boolean;
  dev: boolean;
  squash?: boolean;
}

export async function executeGenerate(
  dependencies: CommonDependencies,
  options: GenerateOptions
) {
  const { client, logger, config } = dependencies;
  const { reporter } = logger;

  // Create the appropriate client (dev or production)
  const { client: targetClient, cleanup } = await setupDatabaseClient(
    dependencies,
    options
  );

  try {
    // Handle squash mode
    if (options.squash) {
      return await handleSquashMode(dependencies, options);
    }

    // Always check against production for pending migrations if not in dev mode
    if (!options.dev && !options.ignorePending) {
      const pm = await getPendingMigrations(client);
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
      config,
    });

    if (!newMigration) {
      reporter.info("No changes detected, no migration needed.");
      return;
    }

    printPrettyDiff(logger, newMigration.diff);

    const migrationFilePath = `${migrationDirName}/${newMigration.id}.json`;
    await mkdir(migrationDirName, { recursive: true });
    await writeFile(migrationFilePath, JSON.stringify(newMigration, null, 2));

    reporter.success(`Migration file generated: ${migrationFilePath}`);

    if (options.apply) {
      if (options.dev) {
        reporter.warn(
          "--apply flag is ignored when using --dev. Use 'kyrage apply' to apply to production database."
        );
      } else {
        await executeApply(dependencies, {
          plan: options.plan,
          pretty: false,
        });
      }
    }
  } finally {
    await cleanup();
  }
}

const handleSquashMode = async (
  dependencies: CommonDependencies,
  options: GenerateOptions
) => {
  const { client, logger } = dependencies;
  const { reporter } = logger;

  // Validation: --squash cannot be used with --ignore-pending
  if (options.ignorePending) {
    throw new Error("--squash and --ignore-pending cannot be used together. Use --squash to consolidate pending migrations.");
  }

  // Get pending migrations
  const pendingMigrations = await getPendingMigrations(client);
  
  if (pendingMigrations.length === 0) {
    reporter.info("No pending migrations found, nothing to squash.");
    return;
  }

  reporter.info(`Found ${pendingMigrations.length} pending migrations to squash:`);
  pendingMigrations.forEach((migration) => {
    reporter.info(`  - ${migration.id}.json`);
  });

  // Remove all pending migration files
  const filesToRemove = pendingMigrations.map((migration) => 
    join(migrationDirName, `${migration.id}.json`)
  );

  try {
    await Promise.all(filesToRemove.map((filePath) => unlink(filePath)));
    reporter.success(`🗑️  Removed ${filesToRemove.length} pending migration files`);
  } catch (error) {
    throw new Error(`Failed to remove pending migration files: ${error}`);
  }

  // Now generate a single consolidated migration using the normal flow
  const { client: targetClient, cleanup } = await setupDatabaseClient(
    dependencies,
    options
  );

  try {
    const newMigration = await generateMigrationFromIntrospection({
      client: targetClient,
      config: dependencies.config,
    });

    if (!newMigration) {
      reporter.info("No changes detected after squashing, no migration needed.");
      return;
    }

    printPrettyDiff(logger, newMigration.diff);

    const migrationFilePath = `${migrationDirName}/${newMigration.id}.json`;
    await mkdir(migrationDirName, { recursive: true });
    await writeFile(migrationFilePath, JSON.stringify(newMigration, null, 2));

    reporter.success(`✔️  Generated squashed migration: ${migrationFilePath}`);

    if (options.apply) {
      if (options.dev) {
        reporter.warn(
          "--apply flag is ignored when using --dev. Use 'kyrage apply' to apply to production database."
        );
      } else {
        await executeApply(dependencies, {
          plan: options.plan,
          pretty: false,
        });
      }
    }
  } finally {
    await cleanup();
  }
};

const setupDatabaseClient = async (
  dependencies: CommonDependencies,
  options: GenerateOptions
) => {
  const { client, logger, config } = dependencies;
  const { reporter } = logger;

  if (!options.dev) {
    return {
      client,
      cleanup: async () => void 0,
    };
  }

  if (!config.dev) {
    throw new Error(
      "Dev database configuration is required when using --dev flag"
    );
  }

  // Create dev database manager
  const dialect = config.database.dialect;
  const devManager = createDevDatabaseManager(config.dev, dialect);

  // Check if reuse is enabled and container is already running
  const isReuse = "container" in config.dev && config.dev.container.reuse;
  if (isReuse && (await devManager.exists())) {
    reporter.info("🔄 Reusing existing dev database...");
  } else {
    reporter.info("🚀 Starting dev database for migration generation...");
  }

  await devManager.start();
  reporter.success(`Dev database started: ${dialect}`);

  const connectionString = devManager.getConnectionString();
  if (!connectionString) {
    throw new Error("Failed to get connection string for dev database");
  }

  // Create client for dev database
  const devClient = getClient({
    database: {
      dialect,
      connectionString,
    },
  });

  // Apply baseline migrations to dev database
  await executeApply(
    {
      client: devClient,
      logger: nullLogger,
      config,
    },
    {
      plan: false,
      pretty: false,
    }
  );

  return {
    client: devClient,
    cleanup: async () => {
      if (!isReuse) {
        await devManager.stop();
        reporter.success("Dev database stopped");
      } else {
        reporter.success("✨ Persistent dev database ready: " + dialect);
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

        // このカラムが複合主キーに含まれているかチェック
        const isInCompositePrimaryKey = constraintAttributes.primaryKey.some(
          (pk) =>
            pk.table === table.name &&
            pk.columns.length > 1 &&
            pk.columns.includes(colName)
        );

        // 複合主キーに含まれるカラムの場合、データベースの NOT NULL 状態を無視し、
        // configと同じ論理を適用（複合主キーのカラムは暗黙的にNOT NULL）
        const effectiveNotNull = isInCompositePrimaryKey
          ? true // 複合主キーに含まれるカラムは暗黙的にNOT NULL
          : colDef.notNull;

        return [
          colName,
          {
            type: colDef.dataType,
            notNull: effectiveNotNull,
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
      Object.entries(table.columns).map(([colName, colDef]) => {
        // 複合主キー制約に含まれるカラムかチェック
        const isInCompositePrimaryKey = (
          config.primaryKeyConstraints ?? []
        ).some(
          (pk) => pk.table === table.tableName && pk.columns.includes(colName)
        );

        // 単一カラムの主キーまたは明示的な notNull、または複合主キーに含まれる場合
        const effectiveNotNull =
          colDef.primaryKey || colDef.notNull || isInCompositePrimaryKey;

        return [
          colName,
          {
            ...colDef,
            notNull: effectiveNotNull,
          },
        ];
      })
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

export const generateCmd = defineCommand({
  meta: {
    name: "generate",
    description: "Generate migration files based on the current schema",
  },
  args: {
    apply: {
      type: "boolean",
      description: "Apply the migration after generating it",
      default: false,
    },
    plan: {
      type: "boolean",
      description: "Plan the migration without applying it (only for --apply)",
      default: false,
    },
    "ignore-pending": {
      type: "boolean",
      description: "Ignore pending migrations and generate a new one",
      default: false,
    },
    dev: {
      type: "boolean",
      description: "Use dev database for safe migration generation",
      default: false,
    },
    squash: {
      type: "boolean", 
      description: "Consolidate pending migrations into a single migration file",
      default: false,
    },
  },
  run: async (ctx) => {
    try {
      const dependencies = await createCommonDependencies();
      await executeGenerate(dependencies, {
        ignorePending: ctx.args["ignore-pending"],
        apply: ctx.args.apply,
        plan: ctx.args.plan,
        dev: ctx.args.dev,
        squash: ctx.args.squash,
      });
    } catch (error) {
      const { defaultConsolaLogger } = await import("../logger");
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});
