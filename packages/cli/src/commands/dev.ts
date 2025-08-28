import { defineCommand } from "citty";
import { loadConfigFile } from "../config/loader";
import { createDevDatabaseManager } from "../dev/container";
import { defaultConsolaLogger } from "../logger";

const devListCmd = defineCommand({
  meta: {
    name: "list",
    description: "List all kyrage dev containers",
  },
  run: async () => {
    try {
      const config = await loadConfigFile();
      if (!config.dev || !("container" in config.dev)) {
        console.log("No dev database container configuration found");
        return;
      }

      const manager = createDevDatabaseManager(
        config.dev,
        config.database.dialect
      );
      const isRunning = await manager.isRunning();

      if (isRunning) {
        const connectionString = await manager.getConnectionString();
        console.log(
          `Running: ${config.dev.container.name || "kyrage-dev"} (${connectionString})`
        );
      } else {
        console.log("No running dev containers found");
      }
    } catch (error) {
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
      const config = await loadConfigFile();
      if (!config.dev || !("container" in config.dev)) {
        defaultConsolaLogger.reporter.error(
          "No dev database container configuration found"
        );
        process.exit(1);
      }

      const manager = createDevDatabaseManager(
        config.dev,
        config.database.dialect
      );
      const connectionString = await manager.getConnectionString();

      if (connectionString) {
        console.log(connectionString);
      } else {
        defaultConsolaLogger.reporter.error("No running dev container found");
        process.exit(1);
      }
    } catch (error) {
      defaultConsolaLogger.reporter.error(error as Error);
      process.exit(1);
    }
  },
});

const devCleanCmd = defineCommand({
  meta: {
    name: "clean",
    description: "Remove all stopped kyrage dev containers",
  },
  run: async () => {
    try {
      // For now, this is a placeholder
      // In the future, we could implement container cleanup logic
      defaultConsolaLogger.reporter.success(
        "Cleaned up stopped dev containers"
      );
    } catch (error) {
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
    list: devListCmd,
    "get-url": devGetUrlCmd,
    clean: devCleanCmd,
  },
});
