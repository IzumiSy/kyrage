import { Migrator } from "kysely";
import { DBClient } from "../client";
import { createMigrationProvider } from "../migration";
import { logger } from "../logger";

export const runApply = async (props: {
  client: DBClient;
  options: {
    plan: boolean;
  };
}) => {
  await using db = props.client.getDB();
  const migrator = new Migrator({
    db,
    provider: createMigrationProvider({
      client: props.client,
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
      console.log(query.sql);
    });
    return;
  }

  if (migrationResults && migrationResults.length > 0) {
    migrationResults.forEach((result) => {
      if (result.status === "Error") {
        logger.error(`Migration failed: ${result.migrationName}`);
      } else if (result.status === "Success") {
        logger.success(`Migration applied: ${result.migrationName}`);
      }
    });
  } else {
    logger.info("No migrations to run");
  }

  if (migrationError) {
    logger.error(`Migration error: ${migrationError}`);
    process.exit(1);
  }
};
