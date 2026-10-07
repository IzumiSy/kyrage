import { describe, expect } from "vitest";
import { databaseTest as it } from "./fixtures";
import { defineTable, column } from "../src";
import { applyTable } from "./helper";

describe("apply migrations in multiple times", () => {
  it("should update DB in multiple times by the schema in config", async ({
    testDB,
    expectations,
  }) => {
    const { database, client, baseDeps } = testDB;
    const { rawCharType: expectedCharType, rawTextType: expectedTextType } =
      expectations;
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
    const tables1 = await db.introspection.getTables();
    expect(tables1).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: expectedCharType }),
          expect.objectContaining({ name: "name", dataType: expectedTextType }),
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

    const tables2 = await db.introspection.getTables();
    expect(tables2).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: expectedCharType }),
          expect.objectContaining({
            name: "email",
            dataType: expectedTextType,
          }),
        ]),
      }),
      expect.objectContaining({
        name: "posts",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: expectedCharType }),
          expect.objectContaining({
            name: "title",
            dataType: expectedTextType,
          }),
        ]),
      }),
    ]);
  });
});
