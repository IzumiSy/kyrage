import { DBClient } from "../client";
import { getAllMigrations, buildMigrationFromDiff } from "../migration";
import { Logger } from "../logger";

/**
 * Apply all existing migrations to dev database to establish baseline
 */
export const applyBaselineToDevDatabase = async (
  devClient: DBClient,
  logger: Logger
): Promise<void> => {
  const { reporter } = logger;

  try {
    const migrations = await getAllMigrations();

    if (migrations.length === 0) {
      reporter.info(
        "No existing migrations found - dev database will start from empty state"
      );
      return;
    }

    reporter.info(
      `Applying ${migrations.length} baseline migration(s) to dev database...`
    );

    await using devDB = devClient.getDB();

    // Apply each migration to dev database
    for (const migration of migrations) {
      await buildMigrationFromDiff(devDB, migration.diff);
      reporter.success(`- Applied migration: ${migration.id}`);
    }
  } catch (error) {
    reporter.error("Failed to apply baseline migrations to dev database");
    throw error;
  }
};
