import { defineCommand, runMain } from "citty";
import { getClient } from "./client";
import * as pkg from "../package.json";
import { runApply } from "./usecases/apply";
import { defaultConsolaLogger } from "./logger";
import { runGenerate } from "./usecases/generate";
import { loadConfigFile } from "./config/loader";

const logger = defaultConsolaLogger;

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
    dev: {
      type: "boolean",
      description: "Use dev database for safe migration generation",
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
        logger,
        config: loadedConfig,
        options: {
          ignorePending: ctx.args["ignore-pending"],
          apply: ctx.args.apply,
          plan: ctx.args.plan,
          dev: ctx.args.dev,
        },
      });
    } catch (error) {
      logger.reporter.error(error as Error);
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
        logger,
        options: {
          plan: ctx.args.plan,
          pretty: ctx.args.pretty,
        },
      });
    } catch (error) {
      logger.reporter.error(error as Error);
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
