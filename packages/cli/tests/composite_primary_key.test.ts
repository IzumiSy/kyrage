import { describe, it, expect } from "vitest";
import { executeGenerate } from "../src/commands/generate";
import { applyTable, setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";
import { fs } from "memfs";
import { FSPromiseAPIs } from "../src/commands/common";

const { database, client } = await setupTestDB();

describe("Composite Primary Key", () => {
  it("should not generate unnecessary migrations for nullable columns in composite primary key", async () => {
    const deps = await applyTable(
      { client, fs: fs.promises as unknown as FSPromiseAPIs },
      {
        database,
        tables: [
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
        ],
      }
    );

    // Check if migration file was generated
    expect(await deps.fs.readdir("migrations")).toHaveLength(1);

    // Second migration generation (should not detect any changes)
    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });

    // No additional migration files should be generated
    expect(await deps.fs.readdir("migrations")).toHaveLength(1);
  });
});
