import { afterAll } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { configSchema } from "../src/schema";
import { defineConfig, DefinedTables } from "../src/config/builder";
import { getClient } from "../src/client";

export const setupTestDB = async (props: { tables: DefinedTables }) => {
  const container = await new PostgreSqlContainer("postgres:14").start();
  const config = configSchema.parse(
    defineConfig({
      database: {
        dialect: "postgres" as const,
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
