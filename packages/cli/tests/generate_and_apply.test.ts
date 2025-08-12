import { describe, it, vi, expect } from "vitest";
import { runGenerate } from "../src/usecases/generate";
import { readdir } from "fs/promises";
import { runApply } from "../src/usecases/apply";
import { setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { config, client } = await setupTestDB({
  tables: [
    defineTable("members", {
      id: column("uuid", { primaryKey: true }),
    }),
  ],
});

describe("generate and apply", () => {
  it("should generate a migration file", async () => {
    await runGenerate({
      client,
      config,
      options: {
        ignorePending: false,
        apply: false,
        plan: false,
      },
    });

    const files = await readdir("migrations");

    expect(files).toHaveLength(1);
  });

  it("should apply the migration", async () => {
    await runApply({
      client,
      options: {
        plan: false,
      },
    });

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
