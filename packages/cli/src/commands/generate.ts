import { defineCommand } from "citty";
import { createCommonDependencies, type CommonDependencies } from "./common";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { type Logger } from "../logger";
import {
  migrationDirName,
  getPendingMigrations,
  SchemaDiff,
} from "../migration";
import { diffSchema } from "../diff";
import { Tables, Operation } from "../operation";
import { getIntrospector } from "../introspector";
import { type DBClient } from "../client";
import { type ConfigValue } from "../config/loader";
import { startDevDatabase } from "../dev/database";
import { executeApply } from "./apply";

export interface GenerateOptions {
  ignorePending: boolean;
  dev: boolean;
  squash?: boolean;
}

export async function executeGenerate(
  dependencies: CommonDependencies,
  options: GenerateOptions
) {
  const { logger, config } = dependencies;
  const { reporter } = logger;

  // Handle squash mode - do squash-specific work then continue with normal flow
  // Squashing is just removing all pending migrations and creating a new one that combines their changes.
  if (options.squash) {
    await removePendingMigrations(dependencies);
  }

  // Create the appropriate client (dev or production)
  const { client: targetClient, cleanup } = options.dev
    ? await startDevDatabase(dependencies, {
        mode: "generate-dev",
        logger,
      })
    : {
        client: dependencies.client,
        cleanup: async () => void 0,
      };

  try {
    // Check for pending migrations against the target database
    if (!options.ignorePending) {
      const pm = await getPendingMigrations(targetClient);
      if (pm.length > 0) {
        if (options.dev) {
          // In dev mode, show info but continue processing since migrations will be auto-applied
          reporter.info(
            `Dev database has ${pm.length} pending migrations. These will be applied automatically as baseline.`
          );
        } else {
          // In production mode, warn and stop processing
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

    const successMessage = options.squash
      ? `Generated squashed migration: ${migrationFilePath}`
      : `Migration file generated: ${migrationFilePath}`;
    reporter.success(successMessage);

    // Apply the migration immediately if in dev mode
    if (options.dev) {
      await executeApply(
        {
          ...dependencies,
          client: targetClient,
        },
        {
          plan: false,
          pretty: false,
        }
      );
    }
  } finally {
    await cleanup();
  }
}

/**
 * Remove all pending migrations from the migration directory.
 */
const removePendingMigrations = async (dependencies: CommonDependencies) => {
  const { client, logger } = dependencies;
  const { reporter } = logger;

  // Get pending migrations
  const pendingMigrations = await getPendingMigrations(client);
  if (pendingMigrations.length === 0) {
    reporter.info("No pending migrations found, nothing to squash.");
    return;
  }

  reporter.info(
    `Found ${pendingMigrations.length} pending migrations to squash:`
  );
  pendingMigrations.forEach((migration) => {
    reporter.info(`  - ${migration.id}.json`);
  });

  // Remove all pending migration files
  const filesToRemove = pendingMigrations.map((migration) =>
    join(migrationDirName, `${migration.id}.json`)
  );

  try {
    await Promise.all(filesToRemove.map((filePath) => unlink(filePath)));
    reporter.success(
      `🗑️  Removed ${filesToRemove.length} pending migration files`
    );
  } catch (error) {
    throw new Error(`Failed to remove pending migration files: ${error}`);
  }
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

  let modifiedRemoteUnique = constraintAttributes.unique;

  const dbTables: Tables = tables.map((table) => ({
    name: table.name,
    columns: Object.fromEntries(
      Object.entries(table.columns).map(([colName, colDef]) => {
        const hasColumnConstraint = columnConstraintPredicate(
          table.name,
          colName
        );
        const primaryKey = hasColumnConstraint(constraintAttributes.primaryKey);
        const unique = hasColumnConstraint(constraintAttributes.unique);

        // console.log(`column (${table.name}.${colName}) unique: ${unique}`);
        if (unique) {
          // Filter out the unique constraint that is automatically created from remote uniques
          modifiedRemoteUnique = modifiedRemoteUnique.filter(
            (uq) =>
              !(
                uq.table === table.name &&
                uq.columns.length === 1 &&
                uq.columns[0] === colName
              )
          );
        }

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
            defaultSql: colDef.default ?? undefined,
            primaryKey,
            unique,
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

  // Remove an implicit index that is automatically created for unique constraints from `constraintAttributes.unique`
  // The index is the same name as the unique constraint, so we can filter it out.
  const modifiedRemoteIndexes = indexes.filter(
    (idx) =>
      !constraintAttributes.unique.some(
        (uq) => uq.table === idx.table && uq.name === idx.name
      )
  );

  /*
  // DEBUGGING -- START
  console.log("config", {
    unique: config.uniqueConstraints,
    indexes: config.indexes,
  });
  console.log("-----");
  console.log("remote", {
    unique: modifiedRemoteUnique,
    indexes: modifiedRemoteIndexes,
  });
  // DEBUGGING -- END
  */

  const diff = diffSchema({
    current: {
      tables: dbTables,
      indexes: modifiedRemoteIndexes,
      uniqueConstraints: modifiedRemoteUnique,
      primaryKeyConstraints: constraintAttributes.primaryKey,
      foreignKeyConstraints: constraintAttributes.foreignKey,
    },
    ideal: {
      ...config,
      tables: configTables,
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
      description:
        "Consolidate pending migrations into a single migration file",
      default: false,
    },
  },
  run: async (ctx) => {
    try {
      const dependencies = await createCommonDependencies();
      await executeGenerate(dependencies, {
        ignorePending: ctx.args["ignore-pending"],
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
