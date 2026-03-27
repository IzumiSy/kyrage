import { describe, it, expect } from "vitest";
import { executeGenerate } from "../src/commands/generate";
import { applyTable, setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";
import { fs } from "memfs";
import { FSPromiseAPIs } from "../src/commands/common";

const { database, client, dialect } = await setupTestDB();
const isSQLite = dialect.getName() === "sqlite";

describe.skipIf(!isSQLite)("Composite Primary Key (SQLite)", () => {
  it("should generate a follow-up migration when named unique constraints are introspected with auto-generated names", async () => {
    const deps = await applyTable(
      { client, fs: fs.promises as unknown as FSPromiseAPIs },
      {
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
            ],
          ),
        ],
      },
    );

    expect(await deps.fs.readdir("migrations")).toHaveLength(1);

    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });

    expect(await deps.fs.readdir("migrations")).toHaveLength(2);
  });
});
