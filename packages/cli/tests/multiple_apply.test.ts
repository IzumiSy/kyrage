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
          id: column("uuid", { primaryKey: true }),
          name: column("text"),
        }),
      ],
    });

    await using db = client.getDB();
    const tables1 = await db.introspection.getTables();
    expect(tables1).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({
            name: "id",
            dataType: expect.stringMatching(/^uuid$/i),
          }),
          expect.objectContaining({
            name: "name",
            dataType: expect.stringMatching(/^text$/i),
          }),
        ]),
      }),
    ]);

    await applyTable(baseDeps, {
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

    const tables2 = await db.introspection.getTables();
    expect(tables2).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({
            name: "id",
            dataType: expect.stringMatching(/^uuid$/i),
          }),
          expect.objectContaining({
            name: "email",
            dataType: expect.stringMatching(/^text$/i),
          }),
        ]),
      }),
      expect.objectContaining({
        name: "posts",
        columns: expect.arrayContaining([
          expect.objectContaining({
            name: "id",
            dataType: expect.stringMatching(/^uuid$/i),
          }),
          expect.objectContaining({
            name: "title",
            dataType: expect.stringMatching(/^text$/i),
          }),
        ]),
      }),
    ]);
  });
});
