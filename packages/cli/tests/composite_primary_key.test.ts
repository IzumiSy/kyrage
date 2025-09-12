import { describe, it, vi, expect } from "vitest";
import { executeGenerate } from "../src/commands/generate";
import { readdir } from "fs/promises";
import { applyTable, setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();

describe("Composite Primary Key", () => {
  it("should not generate unnecessary migrations for nullable columns in composite primary key", async () => {
    const deps = await applyTable({ client, database }, [
      defineTable(
        "posts",
        {
          id: column("uuid"), // nullable in schema definition
          author_id: column("uuid"), // nullable in schema definition
          slug: column("text", { notNull: true }),
          title: column("text"),
          content: column("text", { notNull: true }),
        },
        (t) => [
          t.primaryKey(["id", "author_id"]),
          t.unique(["author_id", "slug"], {
            name: "unique_author_slug",
          }),
        ]
      ),
    ]);

    // Check if migration file was generated
    expect(await readdir("migrations")).toHaveLength(1);

    // Second migration generation (should not detect any changes)
    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });

    // No additional migration files should be generated
    expect(await readdir("migrations")).toHaveLength(1);
  });
});
