import { it, describe, expect } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, applyTable } from "./helper";
import { fs } from "memfs";
import { FSPromiseAPIs } from "../src/commands/common";

const { database, client, dialect } = await setupTestDB();
const baseDeps = { client, fs: fs.promises as unknown as FSPromiseAPIs };

// PostgreSQL stores char(n) as bpchar internally
const dialectName = dialect.getName();
const expectedCharType =
  dialectName === "postgres" || dialectName === "cockroachdb"
    ? "bpchar"
    : dialectName === "sqlite"
      ? "char(36)"
      : "char";
const expectedTextType = dialectName === "sqlite" ? "TEXT" : "text";

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
          expect.objectContaining({ name: "email", dataType: expectedTextType }),
        ]),
      }),
      expect.objectContaining({
        name: "posts",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: expectedCharType }),
          expect.objectContaining({ name: "title", dataType: expectedTextType }),
        ]),
      }),
    ]);
  });
});
