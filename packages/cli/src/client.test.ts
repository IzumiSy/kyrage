import { afterAll, beforeAll, describe, it, expect } from "vitest";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DBClient, getClient } from "./client";

let container: StartedPostgreSqlContainer;
let client: DBClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:14").start();
  client = getClient({
    database: {
      dialect: "postgres",
      connectionString: container.getConnectionUri(),
    },
  });
});

describe("DBClient", () => {
  describe("should be switchable to plan mode and able to be back", async () => {
    it("should create a test table in non-plan mode", async () => {
      await using actualDB = client.getDB();
      await actualDB.schema
        .createTable("test_table")
        .addColumn("id", "serial", (col) => col.primaryKey())
        .execute();
      const tablesBefore = await actualDB.introspection.getTables();

      expect(tablesBefore).toHaveLength(1);
      expect(tablesBefore[0].name).toBe("test_table");
    });

    it("should not mutate tables in plan mode", async () => {
      await using actualDB = client.getDB();
      await using planDB = client.getDB({
        plan: true,
      });
      await planDB.schema.dropTable("test_table").execute();
      const tablesAfter = await actualDB.introspection.getTables();

      expect(tablesAfter).toHaveLength(1);
      expect(tablesAfter[0].name).toBe("test_table");
    });
  });
});

afterAll(async () => {
  await container.stop();
});
