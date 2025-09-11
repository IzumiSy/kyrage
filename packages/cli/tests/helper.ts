import { afterAll } from "vitest";
import { DBClient, getClient } from "../src/client";
import {
  defineConfig,
  DefineConfigProp,
  DefinedTables,
} from "../src/config/builder";
import { DatabaseValue, DialectEnum, configSchema } from "../src/config/loader";
import { getContainerRuntimeClient } from "testcontainers";
import { ManagedKey } from "../src/dev/container";
import { getDialect } from "../src/dialect/factory";
import { executeApply } from "../src/commands/apply";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";

const getContainer = () => {
  const targetDialect = (process.env.TEST_DIALECT as DialectEnum) || "postgres";
  const kyrageDialect = getDialect(targetDialect);
  return {
    dialect: kyrageDialect,
    container: kyrageDialect.createDevDatabaseContainer(
      kyrageDialect.getDevDatabaseImageName()
    ),
  };
};

export const setupTestDB = async () => {
  const { container, dialect } = getContainer();
  const startedContainer = await container.start();
  const database = {
    dialect: dialect.getName(),
    connectionString: startedContainer.getConnectionUri(),
  };
  const client = getClient({
    database,
  });

  afterAll(async () => {
    await startedContainer.stop();
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
export const setupTable = async (
  baseDeps: { client: DBClient; database: DatabaseValue },
  tables: DefinedTables
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
  await executeApply(deps, {
    plan: false,
    pretty: false,
  });
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
