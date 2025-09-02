import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeGenerate } from "../src/commands/generate";
import { defineTable, column } from "../src/config/builder";
import { defineConfigForTest, setupTestDB } from "./helper";
import { defaultConsolaLogger } from "../src/logger";
import { getAllMigrations } from "../src/migration";
import { mkdir } from "fs/promises";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();
const config = defineConfigForTest({
  database,
  tables: [
    defineTable("users", {
      id: column("uuid", { primaryKey: true }),
      email: column("text", { notNull: true, unique: true }),
      name: column("text"),
    }),
  ],
});

describe("generate --squash", () => {
  beforeEach(async () => {
    // Clear any existing migrations directory
    const memfs = await import("memfs");
    memfs.vol.reset();
  });

  it("should squash multiple pending migrations into one", async () => {
    // First, create some pending migrations by running generate multiple times
    await mkdir("migrations", { recursive: true });

    // Generate first migration - users table with just id
    const configStep1 = defineConfigForTest({
      database,
      tables: [
        defineTable("users", {
          id: column("uuid", { primaryKey: true }),
        }),
      ],
    });

    await executeGenerate(
      { client, logger: defaultConsolaLogger, config: configStep1 },
      {
        ignorePending: false,
        dev: false,
        squash: false,
      }
    );

    // Generate second migration - add email
    const configStep2 = defineConfigForTest({
      database,
      tables: [
        defineTable("users", {
          id: column("uuid", { primaryKey: true }),
          email: column("text", { notNull: true }),
        }),
      ],
    });

    await executeGenerate(
      { client, logger: defaultConsolaLogger, config: configStep2 },
      {
        ignorePending: true,
        dev: false,
        squash: false,
      }
    );

    // Generate third migration - make email unique
    await executeGenerate(
      { client, logger: defaultConsolaLogger, config },
      {
        ignorePending: true,
        dev: false,
        squash: false,
      }
    );

    // At this point we should have 3 pending migrations
    const migrationsBeforeSquash = await getAllMigrations();
    expect(migrationsBeforeSquash.length).toBe(3);

    // Now squash them
    await executeGenerate(
      { client, logger: defaultConsolaLogger, config },
      {
        ignorePending: false,
        dev: false,
        squash: true,
      }
    );

    // After squash, we should have 1 migration
    const migrationsAfterSquash = await getAllMigrations();
    expect(migrationsAfterSquash.length).toBe(1);

    // The squashed migration should contain the final state
    const squashedMigration = migrationsAfterSquash[0];
    expect(squashedMigration.diff.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "create_table",
          table: "users",
          columns: expect.objectContaining({
            id: expect.objectContaining({ type: "uuid", primaryKey: true }),
            email: expect.objectContaining({
              type: "text",
              notNull: true,
              unique: true,
            }),
            name: expect.objectContaining({ type: "text" }),
          }),
        }),
      ])
    );
  });

  it("should handle no pending migrations gracefully", async () => {
    await mkdir("migrations", { recursive: true });

    // Try to squash when there are no migrations
    const consoleSpy = vi.spyOn(defaultConsolaLogger.reporter, "info");

    await executeGenerate(
      { client, logger: defaultConsolaLogger, config },
      {
        ignorePending: false,
        dev: false,
        squash: true,
      }
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      "No pending migrations found, nothing to squash."
    );
  });
});
