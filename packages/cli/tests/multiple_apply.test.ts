import { vi, it, describe, expect } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, defineConfigForTest } from "./helper";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { executeApply } from "../src/commands/apply";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();

describe("apply migrations in multiple times", () => {
  it("should update DB in multiple times by the schema in config", async () => {
    await using db = client.getDB();
    const deps = {
      client,
      logger: defaultConsolaLogger,
      config: defineConfigForTest({
        database,
        tables: [
          defineTable("members", {
            id: column("uuid", { primaryKey: true }),
            name: column("text"),
          }),
        ],
      }),
    };

    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });
    await executeApply(deps, {
      plan: false,
      pretty: false,
    });

    expect(await db.introspection.getTables()).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: "uuid" }),
          expect.objectContaining({ name: "name", dataType: "text" }),
        ]),
      }),
    ]);

    const updateConfig = defineConfigForTest({
      database,
      tables: [
        defineTable("members", {
          id: column("uuid", { primaryKey: true }),
          email: column("text"),
        }),
        defineTable("posts", {
          id: column("uuid", { primaryKey: true }),
          title: column("text"),
        }),
      ],
    });
    const updatedDeps = {
      ...deps,
      config: updateConfig,
    };

    await executeGenerate(updatedDeps, {
      ignorePending: false,
      dev: false,
    });
    await executeApply(updatedDeps, {
      plan: false,
      pretty: false,
    });

    expect(await db.introspection.getTables()).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: "uuid" }),
          expect.objectContaining({ name: "email", dataType: "text" }),
        ]),
      }),
      expect.objectContaining({
        name: "posts",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: "uuid" }),
          expect.objectContaining({ name: "title", dataType: "text" }),
        ]),
      }),
    ]);
  });
});
