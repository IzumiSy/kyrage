import { describe, it, vi, expect } from "vitest";
import { executeGenerate } from "../src/commands/generate";
import { readdir } from "fs/promises";
import { executeApply } from "../src/commands/apply";
import { defineConfigForTest, setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";
import { defaultConsolaLogger } from "../src/logger";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();
const config = defineConfigForTest({
  database,
  tables: [
    defineTable("members", {
      id: column("uuid", { primaryKey: true }),
    }),
  ],
});

describe("generate and apply", () => {
  it("should generate a migration file", async () => {
    await executeGenerate(
      {
        client,
        logger: defaultConsolaLogger,
        config,
      },
      {
        ignorePending: false,
        dev: false,
      }
    );

    const files = await readdir("migrations");

    expect(files).toHaveLength(1);
  });

  it("should apply the migration", async () => {
    await executeApply(
      {
        client,
        logger: defaultConsolaLogger,
        config,
      },
      {
        plan: false,
        pretty: false,
      }
    );

    await using db = client.getDB();
    const tables = await db.introspection.getTables();

    expect(tables).toHaveLength(1);

    const table = tables[0];
    expect(table.name).toBe("members");
    expect(table.columns).toHaveLength(1);
    expect(table.columns[0]).toEqual(
      expect.objectContaining({
        name: "id",
        dataType: "uuid",
      })
    );
  });
});
