import { describe, it, expect, vi, afterEach } from "vitest";
import { defineConfigForTest, setupTestDB } from "./helper";
import { defineTable, column } from "../src/config/builder";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { readdir } from "fs/promises";
import {
  findAllKyrageManagedContainerIDs,
  removeContainersByIDs,
} from "../src/dev/container";
import { vol } from "memfs";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

// `setupTestDB` is not really necessary in this test to use dev database,
// However, it can be just useful for setting up a test database environment.
const { database, client } = await setupTestDB();

describe("generate with dev database", () => {
  const defaultOptions = {
    ignorePending: false,
    dev: true,
  };

  afterEach(() => {
    vol.reset();
  });

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
      defaultOptions
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
      defaultOptions
    );

    expect(await readdir("migrations")).toHaveLength(2);
    expect(await findAllKyrageManagedContainerIDs()).toHaveLength(0);
  });

  it("should keep dev database if reuse option is enabled", async () => {
    const configBase = {
      database,
      dev: {
        container: {
          image: "postgres:16",
          keepAlive: true,
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
      defaultOptions
    );

    expect(await findAllKyrageManagedContainerIDs()).toHaveLength(1);

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
      defaultOptions
    );

    const lastContainerIDs = await findAllKyrageManagedContainerIDs();
    expect(lastContainerIDs).toHaveLength(1);
    expect(await readdir("migrations")).toHaveLength(2);

    await removeContainersByIDs(lastContainerIDs);
  });
});
