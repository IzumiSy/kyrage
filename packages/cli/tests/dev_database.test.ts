import { describe, it, expect, vi } from "vitest";
import { defineConfigForTest, setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { readdir } from "fs/promises";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

// `setupTestDB` is not really necessary in this test to use dev database,
// However, it can be just useful for setting up a test database environment.
const { database, client } = await setupTestDB();

describe("generate with dev database", () => {
  it("should generate migrations in multiple times with dev database", async () => {
    const configBase = {
      database,
      dev: {
        container: {
          image: "postgres:16",
        },
      },
    };

    await executeGenerate(
      {
        client,
        logger: defaultConsolaLogger,
        config: defineConfigForTest({
          ...configBase,
          tables: [
            defineTable("members", {
              id: column("uuid", { primaryKey: true }),
              name: column("text"),
            }),
          ],
        }),
      },
      {
        ignorePending: false,
        apply: false,
        plan: false,
        dev: true,
      }
    );

    await executeGenerate(
      {
        client,
        logger: defaultConsolaLogger,
        config: defineConfigForTest({
          ...configBase,
          tables: [
            defineTable("members", {
              id: column("uuid", { primaryKey: true }),
              age: column("integer"),
            }),
          ],
        }),
      },
      {
        ignorePending: false,
        apply: false,
        plan: false,
        dev: true,
      }
    );

    expect(await readdir("migrations")).toHaveLength(2);
  });
});
