import { type Logger, nullLogger } from "../logger";
import { type CommonDependencies } from "../commands/common";
import { type DBClient, getClient } from "../client";
import { createDevDatabaseManager, type DevDatabaseManager } from "./container";
import { executeApply } from "../commands/apply";
import { getPendingMigrations } from "../migration";
import { type ConfigValue } from "../config/loader";

export interface DatabaseStartupResult {
  client: DBClient;
  manager: DevDatabaseManager;
  cleanup: () => Promise<void>;
}

export interface DatabaseStartupOptions {
  logger?: Logger;
}

/**
 * Dev database configuration validation for dev start command
 */
export function validateDevStartRequirements(config: ConfigValue) {
  if (!config.dev) {
    throw new Error(
      "Dev database configuration is required for dev start command"
    );
  }

  if (!("container" in config.dev)) {
    throw new Error(
      "Container-based dev database configuration is required for dev start command"
    );
  }

  if (!config.dev.container.keepAlive) {
    throw new Error(
      "keepAlive: true is required in dev.container configuration for dev start command"
    );
  }
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

  // Create dev database manager
  const dialect = config.database.dialect;
  const devManager = createDevDatabaseManager(config.dev, dialect);

  // Check if reuse is enabled and container is already running
  const isKeepAlive =
    "container" in config.dev && config.dev.container.keepAlive;
  if (isKeepAlive && (await devManager.exists())) {
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

  // Cleanup function
  const cleanup = async () => {
    if (!isKeepAlive) {
      await devManager.stop();
      reporter.success("Dev database stopped");
    } else {
      reporter.success("✨ Persistent dev database ready: " + dialect);
    }
  };

  return { client: devClient, manager: devManager, cleanup };
}
