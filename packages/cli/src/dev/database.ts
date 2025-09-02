import { type Logger, nullLogger } from "../logger";
import { type CommonDependencies } from "../commands/common";
import { type DBClient, getClient } from "../client";
import { createContainerManager, type DevDatabaseManager } from "./container";
import { executeApply } from "../commands/apply";
import { getPendingMigrations } from "../migration";

export interface DatabaseStartupResult {
  client: DBClient;
  manager: DevDatabaseManager;
  cleanup: () => Promise<void>;
}

export interface DatabaseStartupOptions {
  logger?: Logger;
}

/**
 * Start development database with migrations applied
 */
export async function startDevDatabase(
  dependencies: CommonDependencies,
  options: DatabaseStartupOptions = {}
): Promise<DatabaseStartupResult> {
  const { config } = dependencies;
  const logger = options.logger || nullLogger;
  const { reporter } = logger;

  if (!config.dev) {
    throw new Error("Dev database configuration is required");
  }

  // Create dev database manager (for dev start, always with reuse)
  const dialect = config.database.dialect;
  const devManager = createContainerManager(config.dev, dialect, "dev-start");

  // Check if container is already running
  if (await devManager.exists()) {
    reporter.info("🔄 Reusing existing dev database...");
  } else {
    reporter.info("🚀 Starting dev database...");
  }

  await devManager.start();
  reporter.success(`Dev database started: ${dialect}`);

  // Create client for dev database
  const devClient = getClient({
    database: {
      dialect,
      connectionString: devManager.getConnectionString(),
    },
  });

  // Apply baseline migrations to dev database
  const pendingMigrations = await getPendingMigrations(devClient);
  if (pendingMigrations.length > 0) {
    reporter.info(
      `🔄 Applying ${pendingMigrations.length} pending migrations...`
    );

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

    reporter.success(`✔ Applied ${pendingMigrations.length} migrations`);
  } else {
    reporter.info("No pending migrations found");
  }

  // Cleanup function - dev start containers are always persistent
  const cleanup = async () => {
    reporter.success("✨ Persistent dev database ready: " + dialect);
  };

  return { client: devClient, manager: devManager, cleanup };
}
