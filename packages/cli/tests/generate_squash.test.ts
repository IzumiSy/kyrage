import { describe, expect, vi, beforeEach, afterEach } from "vitest";
import { databaseTest as it } from "./fixtures";
import { executeGenerate } from "../src/commands/generate";
import { defineTable, column } from "../src/config/builder";
import { defineConfigForTest, dropTablesForDialect } from "./helper";
import { executeApply } from "../src/commands/apply";
import { defaultConsolaLogger } from "../src/logger";
import { getAllMigrations } from "../src/migration";
import { fs, vol } from "memfs";
import type { DatabaseValue } from "../src/config/loader";
import type { DBClient } from "../src/client";
import { startDevDatabase } from "../src/dev/database";

vi.mock("../src/dev/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/dev/database")>()),
  startDevDatabase: vi.fn(),
}));

/** Keeps a concrete pending source whose bytes must survive failed replacement attempts. */
const seedPendingMigration = async (id: string) => {
  await fs.promises.mkdir("migrations", { recursive: true });
  await fs.promises.writeFile(
    `migrations/${id}.json`,
    JSON.stringify({
      id,
      version: "1",
      diff: {
        operations: [
          {
            type: "create_table",
            table: "old_users",
            columns: {
              id: { type: "integer" },
            },
          },
        ],
      },
    })
  );
};

/** Injects failure at the adapter boundary rather than relying on a particular database. */
const rejectValidation = (client: DBClient, failure: Error) => {
  const validateOperations = vi.fn().mockRejectedValue(failure);
  vi.spyOn(client, "getSchemaAdapter").mockReturnValue({
    ...client.getSchemaAdapter(),
    validateOperations,
  });
  return validateOperations;
};

/** Defines the final schema shared by the squash scenarios. */
const createConfig = (database: DatabaseValue) =>
  defineConfigForTest({
    database,
    tables: [
      defineTable("users", {
        id: column("char(36)", { primaryKey: true }),
        email: column("text", { notNull: true, unique: true }),
        name: column("text"),
      }),
    ],
  });

describe("generate --squash", () => {
  beforeEach(async () => {
    // Clear any existing migrations directory
    vol.reset();
    vi.mocked(startDevDatabase).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should squash multiple pending migrations into one", async ({
    testDB,
  }) => {
    const { database } = testDB;
    const baseDeps = { ...testDB.baseDeps, logger: defaultConsolaLogger };
    const config = createConfig(database);
    // First, create some pending migrations by running generate multiple times
    await baseDeps.fs.mkdir("migrations", { recursive: true });

    // Generate first migration - users table with just id
    const configStep1 = defineConfigForTest({
      database,
      tables: [
        defineTable("users", {
          id: column("char(36)", { primaryKey: true }),
        }),
      ],
    });

    await executeGenerate(
      {
        ...baseDeps,
        config: configStep1,
      },
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
          id: column("char(36)", { primaryKey: true }),
          email: column("text", { notNull: true }),
        }),
      ],
    });

    await executeGenerate(
      {
        ...baseDeps,
        config: configStep2,
      },
      {
        ignorePending: true,
        dev: false,
        squash: false,
      }
    );

    // Generate third migration - make email unique
    await executeGenerate(
      {
        ...baseDeps,
        config,
      },
      {
        ignorePending: true,
        dev: false,
        squash: false,
      }
    );

    // At this point we should have 3 pending migrations
    const migrationsBeforeSquash = await getAllMigrations(baseDeps);
    expect(migrationsBeforeSquash.length).toBe(3);

    // Now squash them
    await executeGenerate(
      { ...baseDeps, config },
      {
        ignorePending: false,
        dev: false,
        squash: true,
      }
    );

    // After squash, we should have 1 migration
    const migrationsAfterSquash = await getAllMigrations(baseDeps);
    expect(migrationsAfterSquash.length).toBe(1);

    // The squashed migration should contain the final state
    const squashedMigration = migrationsAfterSquash[0];
    expect(squashedMigration.diff.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "create_table",
          table: "users",
          columns: expect.objectContaining({
            id: expect.objectContaining({ type: "char(36)", primaryKey: true }),
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

  it.for([
    { label: "ordinary generation", squash: false, dev: false },
    { label: "squash", squash: true, dev: false },
    { label: "dev squash", squash: true, dev: true },
  ])(
    "preserves existing files when validation rejects $label",
    async ({ squash, dev }, { testDB }) => {
      await seedPendingMigration("100");
      const before = vol.toJSON();
      const failure = new Error("unsafe column modification");
      const validateOperations = rejectValidation(testDB.client, failure);
      const cleanup = vi.fn(async () => {});
      vi.mocked(startDevDatabase).mockResolvedValue({
        client: testDB.client,
        cleanup,
        manager: {
          start: vi.fn(async () => {}),
          stop: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
          getConnectionString: () => testDB.database.connectionString,
          getStatus: async () => ({ type: "unavailable" as const }),
          isAvailable: async () => true,
        },
      });
      const deps = {
        ...testDB.baseDeps,
        logger: defaultConsolaLogger,
        config: createConfig(testDB.database),
      };
      await expect(
        executeGenerate(deps, {
          squash,
          dev,
          ignorePending: !squash,
        })
      ).rejects.toBe(failure);
      expect(validateOperations).toHaveBeenCalledTimes(1);
      expect(vol.toJSON()).toEqual(before);
      if (dev) {
        expect(startDevDatabase).toHaveBeenCalledWith(deps, {
          mode: "generate-dev",
          logger: deps.logger,
          excludedMigrationIds: ["100"],
        });
        expect(cleanup).toHaveBeenCalledTimes(1);
      } else {
        expect(startDevDatabase).not.toHaveBeenCalled();
        expect(cleanup).not.toHaveBeenCalled();
      }
    }
  );

  it("preserves squash sources if writing the validated replacement fails", async ({
    testDB,
  }) => {
    await seedPendingMigration("100");
    const before = vol.toJSON();
    const failure = new Error("replacement write failed");
    const write = vi
      .spyOn(testDB.baseDeps.fs, "writeFile")
      .mockRejectedValue(failure);
    await expect(
      executeGenerate(
        {
          ...testDB.baseDeps,
          logger: defaultConsolaLogger,
          config: createConfig(testDB.database),
        },
        { squash: true, dev: false, ignorePending: false }
      )
    ).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(1);
    expect(vol.toJSON()).toEqual(before);
  });

  it("keeps the replacement when the clock reuses a squash source's timestamp", async ({
    testDB,
  }) => {
    await seedPendingMigration("100");
    vi.spyOn(Date, "now").mockReturnValue(100);
    await executeGenerate(
      {
        ...testDB.baseDeps,
        logger: defaultConsolaLogger,
        config: createConfig(testDB.database),
      },
      { squash: true, dev: false, ignorePending: false }
    );
    expect(await testDB.baseDeps.fs.readdir("migrations")).toEqual([
      "101.json",
    ]);
    const migrations = await getAllMigrations(testDB.baseDeps);
    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toEqual(
      expect.objectContaining({
        id: "101",
        diff: {
          operations: expect.arrayContaining([
            expect.objectContaining({ type: "create_table", table: "users" }),
          ]),
        },
      })
    );
  });

  it("preserves applied history when the replacement advances past a squash source", async ({
    testDB,
  }) => {
    await seedPendingMigration("100");
    await seedPendingMigration("101");
    const deps = {
      ...testDB.baseDeps,
      logger: defaultConsolaLogger,
      config: createConfig(testDB.database),
    };
    await executeApply(deps, {
      plan: false,
      pretty: false,
      excludedMigrationIds: ["100"],
    });
    const appliedHistory = await testDB.baseDeps.fs.readFile(
      "migrations/101.json",
      "utf-8"
    );
    const write = vi.spyOn(testDB.baseDeps.fs, "writeFile");
    vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      await executeGenerate(deps, {
        squash: true,
        dev: false,
        ignorePending: false,
      });
      expect((await testDB.baseDeps.fs.readdir("migrations")).sort()).toEqual([
        "101.json",
        "102.json",
      ]);
      expect(
        await testDB.baseDeps.fs.readFile("migrations/101.json", "utf-8")
      ).toBe(appliedHistory);
      expect(write).toHaveBeenCalledWith(
        "migrations/102.json",
        expect.any(String),
        { encoding: "utf-8", flag: "wx" }
      );
      expect(
        (await getAllMigrations(testDB.baseDeps))
          .map((migration) => migration.id)
          .sort()
      ).toEqual(["101", "102"]);
    } finally {
      await dropTablesForDialect({
        client: testDB.client,
        tableNames: ["old_users"],
      });
    }
  });

  it("should handle no pending migrations gracefully", async ({ testDB }) => {
    const baseDeps = { ...testDB.baseDeps, logger: defaultConsolaLogger };
    const config = createConfig(testDB.database);
    await fs.mkdir("migrations", { recursive: true }, () => void 0);

    // Try to squash when there are no migrations
    const consoleSpy = vi.spyOn(defaultConsolaLogger.reporter, "info");

    await executeGenerate(
      { ...baseDeps, config },
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
