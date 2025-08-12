import { describe, it, expect, vi } from "vitest";
import { runGenerate } from "../src/usecases/generate";
import { defineTable, column } from "../src/config/builder";
import { setupTestDB } from "./helper";

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
  it("should update DB immediately with generate command with apply option", async () => {
    await runGenerate({
      client,
      config,
      options: {
        ignorePending: false,
        apply: true,
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
