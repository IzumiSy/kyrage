import { vi, it, describe, expect } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, defineConfigForTest } from "./helper";
import { runGenerate } from "../src/usecases/generate";
import { defaultConsolaLogger } from "../src/logger";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();
const initialTables = [
  defineTable("members", {
    id: column("uuid", { primaryKey: true }),
  }),
];
const config = defineConfigForTest({
  database,
  tables: initialTables,
});

describe("apply migrations in multiple times", () => {
  it("should update DB in multiple times by the schema in config", async () => {
    await using db = client.getDB();

    await runGenerate({
      client,
      logger: defaultConsolaLogger,
      config,
      options: {
        ignorePending: false,
        apply: true,
        plan: false,
      },
    });

    const tables = await db.introspection.getTables();
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe("members");
    expect(tables[0].columns).toHaveLength(1);

    const updateConfig = defineConfigForTest({
      database,
      tables: [
        defineTable("posts", {
          id: column("uuid", { primaryKey: true }),
          title: column("text"),
        }),
      ],
    });

    await runGenerate({
      client,
      logger: defaultConsolaLogger,
      config: updateConfig,
      options: {
        ignorePending: false,
        apply: true,
        plan: false,
      },
    });

    const updatedTables = await db.introspection.getTables();
    expect(updatedTables[0].name).toBe("posts");
    expect(updatedTables[0].columns).toHaveLength(2);
  });
});
