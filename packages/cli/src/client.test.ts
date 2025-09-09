import { describe, it, expect } from "vitest";
import { setupTestDB } from "../tests/helper";

const { client } = await setupTestDB();

describe("DBClient", () => {
  describe("should be switchable to plan mode and able to be back", async () => {
    it("should create a test table in non-plan mode", async () => {
      await using actualDB = await client.getDB();
      await actualDB.schema
        .createTable("test_table")
        .addColumn("id", "serial", (col) => col.primaryKey())
        .execute();
      const tablesBefore = await actualDB.introspection.getTables();

      expect(tablesBefore).toHaveLength(1);
      expect(tablesBefore[0].name).toBe("test_table");
    });

    it("should not mutate tables in plan mode", async () => {
      await using actualDB = await client.getDB();
      await using planDB = await client.getDB({
        plan: true,
      });
      await planDB.schema.dropTable("test_table").execute();
      const tablesAfter = await actualDB.introspection.getTables();

      expect(tablesAfter).toHaveLength(1);
      expect(tablesAfter[0].name).toBe("test_table");
    });
  });
});
