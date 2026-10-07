import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MigratorProps } from "kysely";
import * as fs from "node:fs/promises";
import { getClient } from "../client";
import { defineConfig } from "../config/builder";
import { configSchema } from "../config/loader";
import { defaultSchemaAdapter } from "../dialect/schema-adapter";
import { nullLogger } from "../logger";
import { executeApply } from "./apply";

const mocks = vi.hoisted(() => ({
  migrateToLatest: vi.fn(),
  getPendingMigrations: vi.fn(),
  getAllMigrations: vi.fn(),
  migratorProps: undefined as MigratorProps | undefined,
}));

vi.mock("kysely", async (importOriginal) => {
  const original = await importOriginal<typeof import("kysely")>();
  return {
    ...original,
    /** Captures the provider and collector without touching migration tables or a server. */
    Migrator: class {
      constructor(props: MigratorProps) {
        mocks.migratorProps = props;
      }
      migrateToLatest = mocks.migrateToLatest;
    },
  };
});

vi.mock("../migration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../migration")>()),
  getPendingMigrations: mocks.getPendingMigrations,
  getAllMigrations: mocks.getAllMigrations,
}));

/** Supplies distinct, connection-free execution and metadata DBs to the command. */
const createDependencies = () => {
  const database = {
    dialect: "postgres" as const,
    connectionString: "postgres://user:password@localhost/test",
  };
  const client = getClient({ database });
  const collector = client.getDB({ plan: true });
  const validationDB = client.getDB({ plan: true });
  const getDB = vi
    .spyOn(client, "getDB")
    .mockImplementation((options) =>
      options?.plan ? collector : validationDB
    );
  const validateOperations = vi.fn(async () => {});
  vi.spyOn(client, "getSchemaAdapter").mockReturnValue({
    ...defaultSchemaAdapter,
    validateOperations,
  });
  const logger = {
    ...nullLogger,
    stdout: vi.fn(),
    reporter: { ...nullLogger.reporter, error: vi.fn() },
  };
  return {
    deps: {
      client,
      logger,
      fs,
      config: configSchema.parse(defineConfig({ database, tables: [] })),
    },
    collector,
    validationDB,
    getDB,
    validateOperations,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.migratorProps = undefined;
  mocks.getPendingMigrations.mockResolvedValue([]);
  mocks.getAllMigrations.mockResolvedValue([]);
  mocks.migrateToLatest.mockResolvedValue({});
});

describe("apply validation and planning", () => {
  it("passes a separate metadata DB to planning and excludes superseded migrations", async () => {
    const { deps, collector, validationDB, getDB, validateOperations } =
      createDependencies();
    const operation = { type: "drop_table" as const, table: "kept" };
    mocks.getPendingMigrations.mockResolvedValue([
      {
        id: "skipped",
        version: "1",
        diff: { operations: [{ type: "drop_table", table: "superseded" }] },
      },
      { id: "kept", version: "1", diff: { operations: [operation] } },
    ]);
    mocks.migrateToLatest.mockImplementation(async () => {
      const migrations = await mocks.migratorProps!.provider.getMigrations();
      expect(Object.keys(migrations)).toEqual(["kept"]);
      return {};
    });
    await executeApply(deps, {
      plan: true,
      pretty: false,
      excludedMigrationIds: ["skipped"],
    });
    expect(getDB).toHaveBeenNthCalledWith(1, { plan: true });
    expect(getDB).toHaveBeenNthCalledWith(2);
    expect(mocks.migratorProps!.db).toBe(collector);
    expect(validateOperations).toHaveBeenCalledWith({
      db: validationDB,
      operations: [operation],
    });
    expect(mocks.getAllMigrations).not.toHaveBeenCalled();
  });

  it("rejects a later failure even when an earlier migration already collected SQL", async () => {
    const { deps, collector } = createDependencies();
    const failure = new Error("column validation failed");
    mocks.migrateToLatest.mockImplementation(async () => {
      await mocks.migratorProps!.db.schema.dropTable("orders").execute();
      return {
        error: failure,
        results: [
          { migrationName: "unsafe", status: "Error", direction: "Up" },
        ],
      };
    });
    await expect(
      executeApply(deps, { plan: true, pretty: false })
    ).rejects.toBe(failure);
    expect(collector.getPlannedQueries().map((query) => query.sql)).toEqual([
      'drop table "orders"',
    ]);
    expect(deps.logger.stdout).not.toHaveBeenCalled();
    expect(deps.logger.reporter.error).toHaveBeenCalledWith(
      "Migration failed: unsafe"
    );
  });
});
