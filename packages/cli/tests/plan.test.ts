import { describe, expect, it, vi } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, defineConfigForTest } from "./helper";
import { runGenerate } from "../src/usecases/generate";
import { defaultConsolaLogger } from "../src/logger";
import { runApply } from "../src/usecases/apply";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();
const config = defineConfigForTest({
  database,
  tables: [
    defineTable("members", {
      id: column("uuid", { primaryKey: true }),
      name: column("text"),
    }),
  ],
});

describe("generate with planned apply", () => {
  it("should not generate a new migration", async () => {
    const loggerStdout = vi.spyOn(defaultConsolaLogger, "stdout");
    // .mockImplementation(() => void 0);

    await runGenerate({
      client,
      logger: defaultConsolaLogger,
      config,
      options: {
        ignorePending: false,
        apply: true,
        plan: true,
      },
    });

    expect(loggerStdout).toHaveBeenNthCalledWith(
      1,
      `create table "members" ("id" uuid not null primary key, "name" text)`
    );

    await runApply({
      client,
      logger: defaultConsolaLogger,
      options: {
        plan: false,
        pretty: false,
      },
    });

    const updateConfig = defineConfigForTest({
      database,
      tables: [
        defineTable("posts", {
          id: column("uuid", { primaryKey: true }),
          content: column("text"),
        }),
      ],
    });

    await runGenerate({
      client,
      logger: defaultConsolaLogger,
      config: updateConfig,
      options: {
        ignorePending: false,
        apply: true,
        plan: true,
      },
    });

    expect(loggerStdout).toHaveBeenNthCalledWith(
      2,
      `create table "posts" ("id" uuid not null primary key, "content" text)`
    );
    expect(loggerStdout).toHaveBeenNthCalledWith(3, `drop table "members"`);

    loggerStdout.mockClear();
  });
});
