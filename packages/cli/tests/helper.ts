import { afterAll } from "vitest";
import { getClient } from "../src/client";
import { defineConfig, DefineConfigProp } from "../src/config/builder";
import { DialectEnum, configSchema } from "../src/config/loader";
import { getContainerRuntimeClient } from "testcontainers";
import { ManagedKey } from "../src/dev/container";
import { getDialect } from "../src/dialect/factory";

const getContainer = (dialect?: DialectEnum) => {
  const targetDialect =
    dialect || (process.env.TEST_DIALECT as DialectEnum) || "postgres";
  const kyrageDialect = getDialect(targetDialect);
  return {
    dialect: targetDialect,
    container: kyrageDialect.createDevDatabaseContainer(
      kyrageDialect.getDevDatabaseImageName()
    ),
  };
};

export const setupTestDB = async (targetDialect?: DialectEnum) => {
  const { container, dialect } = getContainer(targetDialect);
  const startedContainer = await container.start();
  const database = {
    dialect,
    connectionString: startedContainer.getConnectionUri(),
  };

  afterAll(async () => {
    await startedContainer.stop();
  });

  return {
    database,
    client: getClient({
      database,
    }),
  };
};

export const defineConfigForTest = (config: DefineConfigProp) =>
  configSchema.parse(defineConfig(config));

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
