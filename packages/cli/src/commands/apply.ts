import { defineCommand } from "citty";
import { createCommonDependencies, type CommonDependencies } from "./common";
import { Migrator } from "kysely";
import {
  createMigrationProvider,
  getAllMigrations,
  getPendingMigrations,
} from "../migration";
import { format } from "sql-formatter";

export interface ApplyOptions {
  plan: boolean;
  pretty: boolean;
}

export async function executeApply(
  dependencies: CommonDependencies,
  options: ApplyOptions
) {
  const { client, logger } = dependencies;
  const { reporter } = logger;

  await using db = await client.getDB({
    plan: options.plan,
  });

  const migrator = new Migrator({
    db,
    provider: createMigrationProvider({
      db,
      migrationsResolver: async () => {
        if (options.plan) {
          return await getPendingMigrations(client);
        } else {
          return await getAllMigrations();
        }
      },
      options: {
        plan: options.plan,
      },
    }),
  });

  const { results: migrationResults, error: migrationError } =
    await migrator.migrateToLatest();

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

  if (migrationError) {
    if (migrationError instanceof Error) {
      throw migrationError;
    } else {
      throw new Error(`Migration error: ${migrationError}`);
    }
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
      const { defaultConsolaLogger } = await import("../logger");
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});
