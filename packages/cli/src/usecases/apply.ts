import { Migrator } from "kysely";
import { DBClient } from "../client";
import {
  createMigrationProvider,
  getAllMigrations,
  getPendingMigrations,
} from "../migration";
import { Logger } from "../logger";
import { format } from "sql-formatter";

export const runApply = async (props: {
  client: DBClient;
  logger: Logger;
  options: {
    plan: boolean;
    pretty: boolean;
  };
}) => {
  const { reporter } = props.logger;
  await using db = props.client.getDB({
    plan: props.options.plan,
  });
  const migrator = new Migrator({
    db,
    provider: createMigrationProvider({
      db,
      migrationsResolver: async () => {
        if (props.options.plan) {
          return await getPendingMigrations(props.client);
        } else {
          return await getAllMigrations();
        }
      },
      options: {
        plan: props.options.plan,
      },
    }),
  });

  const { results: migrationResults, error: migrationError } =
    await migrator.migrateToLatest();

  const plannedQueries = props.client.getPlannedQueries();
  if (plannedQueries.length > 0) {
    plannedQueries.forEach((query) => {
      props.logger.stdout(props.options.pretty ? format(query.sql) : query.sql);
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
    reporter.error(`Migration error: ${migrationError}`);
    process.exit(1);
  }
};
