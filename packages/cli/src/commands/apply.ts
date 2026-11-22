import { defineCommand } from "citty";
import { createCommonDependencies, type CommonDependencies } from "./common";
import { Migrator } from "kysely";
import {
  createMigrationProvider,
  getAllMigrations,
  getPendingMigrations,
} from "../migration";
import { format } from "sql-formatter";
import { defaultConsolaLogger } from "../logger";

/** Controls execution/preview and internal baseline migration selection. */
export type ApplyOptions = {
  plan: boolean;
  pretty: boolean;
  excludedMigrationIds?: ReadonlyArray<string>;
};

export async function executeApply(
  deps: CommonDependencies,
  options: ApplyOptions
) {
  const { client, logger } = deps;
  const { reporter } = logger;

  await using db = client.getDB({
    plan: options.plan,
  });

  await using validationDB = options.plan ? client.getDB() : null;
  const provider = createMigrationProvider({
    schemaAdapter: client.getSchemaAdapter(),
    validationDB: validationDB ?? undefined,
    migrationsResolver: async () => {
      const migrations = options.plan
        ? await getPendingMigrations(deps)
        : await getAllMigrations(deps);
      return migrations.filter(
        (migration) => !options.excludedMigrationIds?.includes(migration.id)
      );
    },
    options: {
      plan: options.plan,
    },
  });
  const migrator = new Migrator({
    db,
    provider,
  });

  const { results: migrationResults, error: migrationError } =
    await migrator.migrateToLatest();

  // A failed later migration must not turn partial plan output into success.
  if (migrationError) {
    migrationResults
      ?.filter((result) => result.status === "Error")
      .forEach((result) =>
        reporter.error(`Migration failed: ${result.migrationName}`)
      );
    throw migrationError instanceof Error
      ? migrationError
      : new Error(`Migration error: ${migrationError}`);
  }

  const plannedQueries = db.getPlannedQueries();
  if (plannedQueries.length > 0) {
    plannedQueries.forEach((query) => {
      logger.stdout(options.pretty ? format(query.sql) : query.sql);
    });
    return;
  }

  if (migrationResults && migrationResults.length > 0) {
    migrationResults.forEach((result) => {
      if (result.status === "Error") {
        reporter.error(`Migration failed: ${result.migrationName}`);
      } else if (result.status === "Success") {
        reporter.success(`Migration applied: ${result.migrationName}`);
      }
    });
  } else {
    reporter.info("No migrations to run");
  }
}

export const applyCmd = defineCommand({
  meta: {
    name: "apply",
    description: "Run migrations to sync database schema",
  },
  args: {
    plan: {
      type: "boolean",
      description: "Plan the migration without applying it",
      default: false,
    },
    pretty: {
      type: "boolean",
      description: "Pretty print the migration SQL (only for --plan)",
      default: false,
    },
  },
  run: async (ctx) => {
    try {
      const dependencies = await createCommonDependencies();
      await executeApply(dependencies, {
        plan: ctx.args.plan,
        pretty: ctx.args.pretty,
      });
    } catch (error) {
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});
