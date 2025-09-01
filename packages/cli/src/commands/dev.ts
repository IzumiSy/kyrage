import { defineCommand } from "citty";
import { createCommonDependencies, type CommonDependencies } from "./common";
import { createDevDatabaseManager, startDevDatabase } from "../dev/container";
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

export async function executeDevStart(
  dependencies: DevDependencies,
  options: { noApply: boolean }
) {
  const { config, logger } = dependencies;
  const { reporter } = logger;

  const result = await startDevDatabase({
    config,
    logger,
    applyMigrations: !options.noApply,
    forceReuse: true, // dev start では常にreuseモードでコンテナを維持
  });

  if (!options.noApply && result.appliedMigrations > 0) {
    reporter.success(`${result.appliedMigrations} migrations applied`);
  }

  // 元の設定でのreuse判定（ユーザーの意図を保持）
  const isReuse = "container" in config.dev! && config.dev!.container.reuse;

  if (!isReuse) {
    // Foreground mode: set up cleanup handlers and keep process alive
    const cleanup = async () => {
      try {
        reporter.info("🧹 Cleaning up temporary dev database...");

        const exists = await result.manager.exists();
        if (!exists) {
          reporter.info("Dev database already stopped by some reason");
        } else {
          await result.manager.stop();
          reporter.success("Dev database stopped");
        }
      } catch (error) {
        reporter.error(`Failed to stop database: ${error}`);
      } finally {
        process.exit(0);
      }
    };

    // シグナルハンドラーを設定
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    reporter.success(
      `✨ ${options.noApply ? "Empty " : ""}dev database ready: ${result.connectionString}`
    );
    reporter.info("🔄 Container will auto-cleanup on process exit");
    reporter.info("Press Ctrl+C to stop the database");

    // プロセスを維持するためのシンプルな方法
    setInterval(() => {}, 1 << 30);
  } else {
    // Background mode: command exits immediately
    reporter.success(
      `✨ ${options.noApply ? "Empty " : ""}dev database ready: ${result.connectionString}`
    );
  }
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

const devStartCmd = defineCommand({
  meta: {
    name: "start",
    description: "Start development database with migrations applied",
  },
  args: {
    "no-apply": {
      type: "boolean",
      description: "Skip migration application (start empty database)",
      default: false,
    },
  },
  run: async (ctx) => {
    try {
      const dependencies = await createDevDependencies();
      await executeDevStart(dependencies, {
        noApply: ctx.args["no-apply"],
      });
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
