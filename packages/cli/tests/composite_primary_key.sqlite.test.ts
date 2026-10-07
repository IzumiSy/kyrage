import { describe, expect } from "vitest";
import { executeGenerate } from "../src/commands/generate";
import { applyTable } from "./helper";
import { testForDialects } from "./fixtures";
import { defineTable, column } from "../src/config/builder";

const it = testForDialects("sqlite");

describe("Composite Primary Key (SQLite)", () => {
  it("should generate a follow-up migration when named unique constraints are introspected with auto-generated names", async ({
    testDB,
  }) => {
    const { database, baseDeps } = testDB;
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable(
          "posts",
          {
            id: column("uuid"),
            author_id: column("uuid"),
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
    });

    expect(await deps.fs.readdir("migrations")).toHaveLength(1);

    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });

    expect(await deps.fs.readdir("migrations")).toHaveLength(2);
  });
});
