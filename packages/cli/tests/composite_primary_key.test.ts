import { describe, expect } from "vitest";
import { testForDialects } from "./fixtures";
import { executeGenerate } from "../src/commands/generate";
import { applyTable } from "./helper";
import { defineTable, column } from "../src/config/builder";

const it = testForDialects("postgres", "cockroachdb", "mysql", "mariadb");

describe("Composite Primary Key", () => {
  it("should not generate unnecessary migrations for nullable columns in composite primary key", async ({
    testDB,
  }) => {
    const { database, baseDeps } = testDB;
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable(
          "posts",
          {
            id: column("char(36)"), // nullable in schema definition
            author_id: column("char(36)"), // nullable in schema definition
            slug: column("varchar(255)", { notNull: true }),
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
    });

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
