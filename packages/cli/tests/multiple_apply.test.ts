import { vi, it, describe, expect } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, applyTable } from "./helper";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();

describe("apply migrations in multiple times", () => {
  it("should update DB in multiple times by the schema in config", async () => {
    await applyTable({ client, database }, [
      defineTable("members", {
        id: column("uuid", { primaryKey: true }),
        name: column("text"),
      }),
    ]);

    await using db = client.getDB();
    expect(await db.introspection.getTables()).toEqual([
      expect.objectContaining({
        name: "members",
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "id", dataType: "uuid" }),
          expect.objectContaining({ name: "name", dataType: "text" }),
        ]),
      }),
    ]);

    await applyTable({ client, database }, [
      defineTable("members", {
        id: column("uuid", { primaryKey: true }),
        email: column("text"),
      }),
      defineTable("posts", {
        id: column("uuid", { primaryKey: true }),
        title: column("text"),
      }),
    ]);

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
