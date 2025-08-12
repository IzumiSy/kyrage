import { defineCommand, runMain } from "citty";
import { getClient } from "./client";
import * as pkg from "../package.json";
import { configSchema, ConfigValue } from "./schema";
import { runApply } from "./usecases/apply";
import { logger } from "./logger";
import { runGenerate } from "./usecases/generate";
import { loadConfig } from "c12";

const loadConfigFile = async () => {
  const loadedConfig = await loadConfig<ConfigValue>({
    name: "kyrage",
  });
  return configSchema.parse(loadedConfig.config);
};

const generateCmd = defineCommand({
  meta: {
    name: "generate",
    description: "Generate migration files based on the current schema",
  },
  args: {
    apply: {
      type: "boolean",
      description: "Apply the migration after generating it",
      default: false,
    },
    plan: {
      type: "boolean",
      description: "Plan the migration without applying it (only for --apply)",
      default: false,
    },
    "ignore-pending": {
      type: "boolean",
      description: "Ignore pending migrations and generate a new one",
      default: false,
    },
  },
  run: async (ctx) => {
    try {
      const loadedConfig = await loadConfigFile();
      const client = getClient({
        database: loadedConfig.database,
      });

      await runGenerate({
        client,
        config: loadedConfig,
        options: {
          ignorePending: ctx.args["ignore-pending"],
          apply: ctx.args.apply,
          plan: ctx.args.plan,
        },
      });
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
  },
});

const applyCmd = defineCommand({
  meta: {
    name: "apply",
    description: "Run migrations to sync database schema",
  },
  args: {
    plan: {
      type: "boolean",
      description: "Plan the migration without applying it",
      default: false,
    },
    pretty: {
      type: "boolean",
      description: "Pretty print the migration SQL (only for --plan)",
      default: false,
    },
  },
  run: async (ctx) => {
    try {
      const loadedConfig = await loadConfigFile();
      const client = getClient({
        database: loadedConfig.database,
      });

      await runApply({
        client,
        options: {
          plan: ctx.args.plan,
          pretty: ctx.args.pretty,
        },
      });
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
  },
});

const mainCmd = defineCommand({
  meta: {
    name: "kyrage",
    version: pkg.version,
    description: "Kysely migration CLI with declarative schema",
  },
  subCommands: {
    apply: applyCmd,
    generate: generateCmd,
  },
});

runMain(mainCmd);
