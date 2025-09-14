import { defineCommand } from "citty";
import { createCommonDependencies, type CommonDependencies } from "./common";
import { startDevDatabase } from "../dev/database";
import type { DevDatabaseInstance } from "../dev/types";

export interface DevDependencies extends CommonDependencies {
  manager: DevDatabaseInstance;
}

export async function executeDevStatus(dependencies: DevDependencies) {
  const { manager, logger } = dependencies;

  const status = await manager.getStatus();
  if (!status || status.type !== "container") {
    logger.reporter.info("No running dev containers found");
    return;
  }

  logger.reporter.info(`Running: ${status.containerID} (${status.imageName})`);
}

export async function executeDevGetUrl(dependencies: DevDependencies) {
  const { manager, logger } = dependencies;

  if (!manager.isAvailable()) {
    logger.reporter.info("No running dev containers found");
    return;
  }

  // TestContainersのreuseによって既存コンテナに自動接続
  await manager.start();
  console.log(manager.getConnectionString());
}

export async function executeDevClean(dependencies: DevDependencies) {
  const { manager, logger } = dependencies;

  if (!manager.isAvailable()) {
    logger.reporter.info("No dev containers found");
    return;
  }

  await manager.remove();
  logger.reporter.success("Cleaned up dev containers");
}

/**
 * Execute dev start command
 */
export async function executeDevStart(dependencies: CommonDependencies) {
  const { logger } = dependencies;
  const { reporter } = logger;

  // データベース起動とマイグレーション適用
  const { manager } = await startDevDatabase(dependencies, {
    mode: "dev-start",
    logger,
  });

  // 接続情報表示
  reporter.success(`✨ Dev database ready: ${manager.getConnectionString()}`);
}

// dev専用の依存関係作成関数
async function createDevDependencies() {
  const commonDeps = await createCommonDependencies();

  if (!commonDeps.config.dev) {
    throw new Error("No dev database configuration found");
  }

  // Use the new dev database manager system
  const { createDevDatabaseManager } = await import("../dev/container");
  const manager = await createDevDatabaseManager(
    commonDeps.config.dev,
    commonDeps.config.database.dialect,
    "dev-start"
  );

  return {
    ...commonDeps,
    manager,
  };
}

const devStartCmd = defineCommand({
  meta: {
    name: "start",
    description: "Start development database with migrations applied",
  },
  run: async () => {
    try {
      const dependencies = await createCommonDependencies();
      await executeDevStart(dependencies);
    } catch (error) {
      const { defaultConsolaLogger } = await import("../logger");
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});

const devStatusCmd = defineCommand({
  meta: {
    name: "status",
    description: "Show status of kyrage dev container",
  },
  run: async () => {
    try {
      const dependencies = await createDevDependencies();
      await executeDevStatus(dependencies);
    } catch (error) {
      const { defaultConsolaLogger } = await import("../logger");
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});

const devGetUrlCmd = defineCommand({
  meta: {
    name: "get-url",
    description: "Print connection URL for running dev container",
  },
  run: async () => {
    try {
      const dependencies = await createDevDependencies();
      await executeDevGetUrl(dependencies);
    } catch (error) {
      const { defaultConsolaLogger } = await import("../logger");
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});

const devCleanCmd = defineCommand({
  meta: {
    name: "clean",
    description: "Remove all kyrage dev containers",
  },
  run: async () => {
    try {
      const dependencies = await createDevDependencies();
      await executeDevClean(dependencies);
    } catch (error) {
      const { defaultConsolaLogger } = await import("../logger");
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});

export const devCmd = defineCommand({
  meta: {
    name: "dev",
    description: "Manage development database containers",
  },
  subCommands: {
    start: devStartCmd,
    status: devStatusCmd,
    "get-url": devGetUrlCmd,
    clean: devCleanCmd,
  },
});
