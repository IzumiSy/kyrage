import { defineCommand } from "citty";
import { loadConfigFile } from "../config/loader";
import { createDevDatabaseManager } from "../dev/container";
import { defaultConsolaLogger } from "../logger";

const devStatusCmd = defineCommand({
  meta: {
    name: "status",
    description: "Show status of kyrage dev container",
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

      const status = await manager.getStatus();
      if (status?.type !== "container") {
        console.log("No running dev containers found");
        return;
      }

      await manager.start();
      console.log(`Running: ${status.containerID} (${status.imageName})`);
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

      const status = await manager.getStatus();
      if (status?.type !== "container") {
        console.log("No running dev containers found");
        return;
      }

      await manager.start();
      const connectionString = manager.getConnectionString();

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
      const config = await loadConfigFile();
      if (!config.dev || !("container" in config.dev)) {
        defaultConsolaLogger.reporter.warn(
          "No dev database container configuration found"
        );
        return;
      }

      const manager = createDevDatabaseManager(
        config.dev,
        config.database.dialect
      );

      const status = await manager.getStatus();
      if (status?.type !== "container") {
        console.log("No running dev containers found");
        return;
      }

      await manager.start();
      await manager.stop();
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
    status: devStatusCmd,
    "get-url": devGetUrlCmd,
    clean: devCleanCmd,
  },
});
