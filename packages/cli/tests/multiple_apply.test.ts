import { it, describe, expect } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, applyTable } from "./helper";
import { fs } from "memfs";
import { FSPromiseAPIs } from "../src/commands/common";

const { database, client } = await setupTestDB();
const baseDeps = { client, fs: fs.promises as unknown as FSPromiseAPIs };

describe("apply migrations in multiple times", () => {
  it("should update DB in multiple times by the schema in config", async () => {
    await applyTable(baseDeps, {
      database,
      tables: [
        defineTable("members", {
          id: column("char(36)", { primaryKey: true }),
          name: column("text"),
        }),
      ],
    });

    await using db = client.getDB();
    expect(await db.introspection.getTables()).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: "char" }),
          expect.objectContaining({ name: "name", dataType: "text" }),
        ]),
      }),
    ]);

    await applyTable(baseDeps, {
      database,
      tables: [
        defineTable("members", {
          id: column("char(36)", { primaryKey: true }),
          email: column("text"),
        }),
        defineTable("posts", {
          id: column("char(36)", { primaryKey: true }),
          title: column("text"),
        }),
      ],
    });

    expect(await db.introspection.getTables()).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: "char" }),
          expect.objectContaining({ name: "email", dataType: "text" }),
        ]),
      }),
      expect.objectContaining({
        name: "posts",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: "char" }),
          expect.objectContaining({ name: "title", dataType: "text" }),
        ]),
      }),
    ]);
  });
});
