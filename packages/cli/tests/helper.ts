import { afterAll, afterEach } from "vitest";
import { getClient } from "../src/client";
import { defineConfig, DefineConfigProp } from "../src/config/builder";
import { DialectEnum, configSchema } from "../src/config/loader";
import { getContainerRuntimeClient } from "testcontainers";
import { ManagedKey } from "../src/dev/container";
import { getDialect } from "../src/dialect/factory";
import { sql } from "kysely";

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

export const setupTestDB = async (options?: {
  dialect?: DialectEnum;
  enableEachCleanup?: boolean;
}) => {
  const { container, dialect } = getContainer(options?.dialect);
  const startedContainer = await container.start();
  const database = {
    dialect,
    connectionString: startedContainer.getConnectionUri(),
  };
  const client = getClient({
    database,
  });

  afterAll(async () => {
    await startedContainer.stop();
  });

  if (options?.enableEachCleanup) {
    afterEach(async () => {
      await using db = client.getDB();
      await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(db);
    });
  }

  return {
    database,
    client,
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
