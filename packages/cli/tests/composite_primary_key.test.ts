import { describe, it, vi, expect, beforeEach } from "vitest";
import { executeGenerate } from "../src/commands/generate";
import { readdir } from "fs/promises";
import { defineConfigForTest, setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";
import { defaultConsolaLogger } from "../src/logger";
import { vol } from "memfs";
import { executeApply } from "../src/commands/apply";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();

describe("Composite Primary Key", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("should not generate unnecessary migrations for nullable columns in composite primary key", async () => {
    const config = defineConfigForTest({
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
    });
    const deps = {
      client,
      logger: defaultConsolaLogger,
      config,
    };

    // Initial migration generation (should create table and constraints)
    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });
    await executeApply(deps, {
      plan: false,
      pretty: false,
    });

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
