import { type Logger, nullLogger } from "../logger";
import { type CommonDependencies } from "../commands/common";
import { type DBClient, getClient } from "../client";
import { createDevDatabaseManager } from "./container";
import { DevDatabaseInstance } from "./types";
import { executeApply } from "../commands/apply";
import { getPendingMigrations } from "../migration";
import { getDialect } from "../dialect/factory";

export interface DatabaseStartupResult {
  client: DBClient;
  manager: DevDatabaseInstance;
  cleanup: () => Promise<void>;
}

export type StartDevDatabaseOptions = {
  logger: Logger;
} & (
  | {
      mode: "dev-start";
    }
  | {
      mode: "generate-dev";
    }
);

/**
 * Prepare development database manager
 */
async function prepareDevManager(
  dependencies: CommonDependencies,
  options: StartDevDatabaseOptions
) {
  const { config } = dependencies;
  const kyrageDialect = getDialect(config.database.dialect);

  switch (options.mode) {
    // Always reuse existing dev database container/environment
    case "dev-start": {
      const { instance, manageType } = await createDevDatabaseManager(
        config.dev!,
        config.database.dialect,
        "dev-start" as const
      );

      return {
        manageType,
        manager: instance,
        result: { reused: instance.isAvailable() },
      };
    }

    // Generate a new dev database environment if needed, but reuse existing one if available
    case "generate-dev": {
      // Use dialect-specific logic to check for existing dev-start environments
      const hasDevStart = await kyrageDialect.hasReusableDevDatabase();
      const { instance, manageType } = await createDevDatabaseManager(
        config.dev!,
        config.database.dialect,
        hasDevStart ? ("dev-start" as const) : ("one-off" as const)
      );

      return {
        manageType,
        manager: instance,
        result: { reused: hasDevStart },
      };
    }
  }
}

/**
 * Start development database with migrations applied
 */
export async function startDevDatabase(
  dependencies: CommonDependencies,
  options: StartDevDatabaseOptions
): Promise<DatabaseStartupResult> {
  const { config } = dependencies;
  const logger = options.logger || nullLogger;
  const { reporter } = logger;

  if (!config.dev) {
    throw new Error("Dev database configuration is required");
  }

  // コンテナマネージャーの作成と準備
  const {
    manageType,
    manager: devManager,
    result: devManagerResult,
  } = await prepareDevManager(dependencies, options);
  if (devManagerResult.reused) {
    reporter.info("🔄 Reusing existing dev database...");
  } else {
    reporter.info("🚀 Starting dev database...");
  }

  await devManager.start();
  reporter.success(`Dev database started: ${config.database.dialect}`);

  // Create client for dev database
  const devClient = getClient({
    database: {
      dialect: config.database.dialect,
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

    reporter.success(`Applied ${pendingMigrations.length} migrations`);
  } else {
    reporter.info("No pending migrations found");
  }

  // Cleanup function
  const cleanup = async () => {
    switch (options.mode) {
      case "dev-start":
        reporter.success(
          "Persistent dev database ready: " + config.database.dialect
        );
        break;
      case "generate-dev":
        if (manageType === "dev-start") {
          reporter.info("Dev start container remains running");
        } else {
          await devManager.stop();
          reporter.success("Temporary dev database stopped");
        }
        break;
    }
  };

  return { client: devClient, manager: devManager, cleanup };
}
