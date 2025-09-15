import { describe, it, expect, vi, afterEach } from "vitest";
import {
  defineConfigForTest,
  findAllKyrageManagedContainerIDs,
} from "./helper";
import { defineTable, column } from "../src/config/builder";
import { executeGenerate } from "../src/commands/generate";
import { executeDevStart } from "../src/commands/dev";
import { defaultConsolaLogger } from "../src/logger";
import { readdir } from "fs/promises";
import { vol } from "memfs";
import { removeAllKyrageManagedContainers } from "../src/dev/providers/container";
import { DBClient } from "../src/client";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

// A null client to test that no real DB connection is used when not needed.
const nullClient: DBClient = null as unknown as DBClient;

describe("generate with dev database", () => {
  const defaultOptions = {
    ignorePending: false,
    dev: true,
  };

  afterEach(() => {
    vol.reset();
  });

  const configBase = {
    database: {
      dialect: "postgres" as const,
      connectionString: "(justplaceholding)",
    },
    dev: {
      container: {
        image: "postgres:16",
      },
    },
  };

  it(
    "should create and cleanup one-off container when dev start not running",
    { retry: 3 },
    async () => {
      await executeGenerate(
        {
          client: nullClient,
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
          client: nullClient,
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
    }
  );

  it(
    "should reuse dev start container when available",
    { retry: 3 },
    async () => {
      const depBase = {
        client: nullClient,
        logger: defaultConsolaLogger,
      };

      const deps = {
        ...depBase,
        config: defineConfigForTest({
          ...configBase,
          tables: [
            defineTable("members", {
              id: column("uuid", { primaryKey: true }),
              name: column("text"),
            }),
          ],
        }),
      };

      // First, generate a migration
      await executeGenerate(deps, defaultOptions);

      // Start a dev start container with initial table, and verify dev start container is running
      await executeDevStart(deps);
      expect(await findAllKyrageManagedContainerIDs()).toHaveLength(1);

      // Generate another migration, and verify it does not stop the container
      await executeGenerate(
        {
          ...depBase,
          config: defineConfigForTest({
            ...configBase,
            tables: [
              defineTable("members", {
                id: column("uuid", { primaryKey: true }),
                name: column("text"),
                age: column("integer"),
                email: column("text"), // Add email field
              }),
            ],
          }),
        },
        defaultOptions
      );
      expect(await readdir("migrations")).toHaveLength(2);
      const lastContainerIDs = await findAllKyrageManagedContainerIDs();
      expect(lastContainerIDs).toHaveLength(1);

      // Clean up the dev start container
      await removeAllKyrageManagedContainers();
    }
  );
});
