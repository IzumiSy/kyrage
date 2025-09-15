import { afterAll } from "vitest";
import { DBClient, getClient } from "../src/client";
import {
  defineConfig,
  DefineConfigProp,
  DefinedTables,
} from "../src/config/builder";
import {
  ConfigValue,
  DatabaseValue,
  DialectEnum,
  configSchema,
} from "../src/config/loader";
import { getContainerRuntimeClient } from "testcontainers";
import { ManagedKey } from "../src/dev/container";
import { getDialect } from "../src/dialect/factory";
import { executeApply } from "../src/commands/apply";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger, Logger } from "../src/logger";

const getContainer = () => {
  const targetDialect = (process.env.TEST_DIALECT as DialectEnum) || "postgres";
  const kyrageDialect = getDialect(targetDialect);

  // Use the new provider system for testing
  const provider = kyrageDialect.createDevDatabaseProvider();

  // Parse empty config - dialect will provide appropriate defaults
  const parsedConfig = kyrageDialect.parseDevDatabaseConfig({
    // TODO: here should be switched by dialect
    container: {
      image: "postgres:16",
    },
  });

  return {
    dialect: kyrageDialect,
    provider,
    config: parsedConfig,
  };
};

export const setupTestDB = async () => {
  const { provider, dialect, config } = getContainer();
  const instance = await provider.setup(config, "one-off");
  await instance.start();

  const database = {
    dialect: dialect.getName(),
    connectionString: instance.getConnectionString(),
  };
  const client = getClient({
    database,
  });

  afterAll(async () => {
    await instance.stop();
  });

  return {
    database,
    client,
    dialect,
  };
};

export const defineConfigForTest = (config: DefineConfigProp) =>
  configSchema.parse(defineConfig(config));

type SetupDeps = {
  client: DBClient;
  logger: Logger;
  config: ConfigValue;
};

/**
 * テスト用にマイグレーションを生成と適用しテーブルをセットアップする
 */
export const applyTable = async (
  baseDeps: { client: DBClient; database: DatabaseValue },
  tables: DefinedTables,
  hooks?: {
    beforeApply?: (deps: SetupDeps) => Promise<void> | void;
  }
) => {
  const deps = {
    client: baseDeps.client,
    logger: defaultConsolaLogger,
    config: defineConfigForTest({
      database: baseDeps.database,
      tables,
    }),
  };

  await executeGenerate(deps, {
    ignorePending: false,
    dev: false,
  });

  await hooks?.beforeApply?.(deps);
  await executeApply(deps, {
    plan: false,
    pretty: false,
  });

  return deps;
};

/**
 * 全てのkyrage管理コンテナのIDを取得する（テスト用）
 */
export const findAllKyrageManagedContainerIDs = async () => {
  const runtime = await getContainerRuntimeClient();
  const allContainers = await runtime.container.list();

  return allContainers
    .filter((container) => container.Labels[ManagedKey] === "true")
    .map((container) => container.Id);
};
