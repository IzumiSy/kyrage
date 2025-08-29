import { defineCommand } from "citty";
import { createCommonDependencies, type CommonDependencies } from "./common";
import { createDevDatabaseManager } from "../dev/container";
import type { DevDatabaseManager } from "../dev/container";

export interface DevDependencies extends CommonDependencies {
  manager: DevDatabaseManager;
}

export async function executeDevStatus(dependencies: DevDependencies) {
  const { manager } = dependencies;

  const status = await manager.getStatus();
  if (!status || status.type !== "container") {
    console.log("No running dev containers found");
    return;
  }

  console.log(`Running: ${status.containerID} (${status.imageName})`);
}

export async function executeDevGetUrl(dependencies: DevDependencies) {
  const { manager } = dependencies;

  if (!(await manager.exists())) {
    console.log("No running dev containers found");
    return;
  }

  // TestContainersのreuseによって既存コンテナに自動接続
  await manager.start();
  const connectionString = manager.getConnectionString();

  if (connectionString) {
    console.log(connectionString);
  } else {
    throw new Error("Failed to get connection string");
  }
}

export async function executeDevClean(dependencies: DevDependencies) {
  const { manager, logger } = dependencies;

  if (!(await manager.exists())) {
    console.log("No dev containers found");
    return;
  }

  await manager.remove();
  logger.reporter.success("Cleaned up dev containers");
}

// dev専用の依存関係作成関数
async function createDevDependencies() {
  const commonDeps = await createCommonDependencies();

  if (!commonDeps.config.dev || !("container" in commonDeps.config.dev)) {
    throw new Error("No dev database container configuration found");
  }

  const manager = createDevDatabaseManager(
    commonDeps.config.dev,
    commonDeps.config.database.dialect
  );

  return {
    ...commonDeps,
    manager,
  };
}

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
    status: devStatusCmd,
    "get-url": devGetUrlCmd,
    clean: devCleanCmd,
  },
});
