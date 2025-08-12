import { afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { configSchema, DialectEnum } from "../src/schema";
import { defineConfig, DefinedTables } from "../src/config/builder";
import { getClient } from "../src/client";

const getContainer = (dialect: string) => {
  switch (dialect) {
    case "postgres":
      return new PostgreSqlContainer("postgres:14");
    case "cockroachdb":
      return new CockroachDbContainer("cockroachdb/cockroach:latest-v24.3");
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }
};

const targetDialect = (process.env.TEST_DIALECT as DialectEnum) || "postgres";

export const setupTestDB = async (props: { tables: DefinedTables }) => {
  const container = await getContainer(targetDialect).start();
  const config = configSchema.parse(
    defineConfig({
      database: {
        dialect: targetDialect as DialectEnum,
        connectionString: container.getConnectionUri(),
      },
      tables: props.tables,
    })
  );

  afterAll(async () => {
    await container.stop();
  });

  return {
    config,
    client: getClient({
      database: config.database,
    }),
  };
};
