import { afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { getClient } from "../src/client";
import { defineConfig, DefineConfigProp } from "../src/config/builder";
import { DialectEnum, configSchema } from "../src/config/loader";
import { getContainerRuntimeClient } from "testcontainers";
import { ManagedKey } from "../src/dev/container";

const getContainer = (dialect: string) => {
  switch (dialect) {
    case "postgres":
      return new PostgreSqlContainer("postgres:16");
    case "cockroachdb":
      return new CockroachDbContainer("cockroachdb/cockroach:latest-v24.3");
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }
};

const targetDialect = (process.env.TEST_DIALECT as DialectEnum) || "postgres";

export const setupTestDB = async () => {
  const container = await getContainer(targetDialect).start();
  const database = {
    dialect: targetDialect as DialectEnum,
    connectionString: container.getConnectionUri(),
  } as const;

  afterAll(async () => {
    await container.stop();
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
