import { afterAll } from "vitest";
import { getClient } from "../src/client";
import {
  defineConfig,
  DefineConfigProp,
  DefinedTables,
} from "../src/config/builder";
import { DatabaseValue, DialectEnum, configSchema } from "../src/config/loader";
import { getContainerRuntimeClient } from "testcontainers";
import { getDialect } from "../src/dialect/factory";
import { executeApply } from "../src/commands/apply";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { KyrageDialect } from "../src/dialect/types";
import { ManagedKey } from "../src/dev/providers/container";
import { CommonDependencies } from "../src/commands/common";

const getConfigForTest = (kyrageDialect: KyrageDialect) => {
  switch (kyrageDialect.getName()) {
    case "postgres":
      return {
        container: {
          image: "postgres:16",
        },
      };
    case "cockroachdb":
      return {
        container: {
          image: "cockroachdb/cockroach:latest-v24.3",
        },
      };
    case "mysql":
      return {
        container: {
          image: "mysql:8",
        },
      };
    default:
      throw new Error("unsupported dialect specified");
  }
};

const getContainer = () => {
  const kyrageDialect = getDialect(
    (process.env.TEST_DIALECT as DialectEnum) || "postgres"
  );

  return {
    dialect: kyrageDialect,
    provider: kyrageDialect.createDevDatabaseProvider(),
    config: kyrageDialect.parseDevDatabaseConfig(
      getConfigForTest(kyrageDialect)
    ),
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

/**
 * テスト用にマイグレーションを生成と適用しテーブルをセットアップする
 */
export const applyTable = async (
  baseDeps: Pick<CommonDependencies, "client" | "fs">,
  config: {
    database: DatabaseValue;
    tables: DefinedTables;
  },
  hooks?: {
    beforeApply?: (deps: CommonDependencies) => Promise<void> | void;
  }
) => {
  const deps = {
    ...baseDeps,
    logger: defaultConsolaLogger,
    config: defineConfigForTest(config),
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
