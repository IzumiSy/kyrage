import { beforeEach, describe, expect, it, vi } from "vitest";
import { fs } from "memfs";
import { DBClient } from "../client";
import type { FSPromiseAPIs } from "../commands/common";
import { column, defineConfig, defineTable } from "../config/builder";
import { configSchema } from "../config/loader";
import { nullLogger } from "../logger";
import { startDevDatabase } from "./database";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getPendingMigrations: vi.fn(),
  executeApply: vi.fn(),
  hasReusableDevDatabase: vi.fn(),
  setup: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client")>()),
  getClient: mocks.getClient,
}));
vi.mock("../migration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../migration")>()),
  getPendingMigrations: mocks.getPendingMigrations,
}));
vi.mock("../commands/apply", () => ({ executeApply: mocks.executeApply }));
vi.mock("../dialect/factory", () => ({
  getDialect: () => ({
    hasReusableDevDatabase: mocks.hasReusableDevDatabase,
    createDevDatabaseProvider: () => ({ setup: mocks.setup }),
    parseDevDatabaseConfig: (config: unknown) => config,
  }),
}));

/** Provides different production/dev clients without opening database connections. */
const createDependencies = () => {
  const database = {
    dialect: "sqlite" as const,
    connectionString: "production.sqlite",
  };
  const prodClient = new DBClient({ databaseProps: database });
  const devClient = new DBClient({
    databaseProps: { ...database, connectionString: "dev.sqlite" },
  });
  mocks.getClient.mockReturnValue(devClient);
  return {
    devClient,
    deps: {
      client: prodClient,
      logger: nullLogger,
      fs: fs.promises as unknown as FSPromiseAPIs,
      config: configSchema.parse(
        defineConfig({
          database,
          dev: { file: { name: "dev.sqlite" } },
          tables: [defineTable("users", { id: column("integer") })],
        })
      ),
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasReusableDevDatabase.mockResolvedValue(false);
  mocks.getPendingMigrations.mockResolvedValue([]);
  mocks.executeApply.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.setup.mockResolvedValue({
    start: mocks.start,
    stop: mocks.stop,
    remove: mocks.remove,
    getConnectionString: () => "dev.sqlite",
    getStatus: async () => ({ type: "unavailable" }),
    isAvailable: async () => true,
  });
});

describe("dev squash baseline selection", () => {
  it("queries pending migrations on the dev client and forwards squash exclusions", async () => {
    const { deps, devClient } = createDependencies();
    mocks.getPendingMigrations.mockImplementation(async ({ client }) =>
      client === devClient
        ? [
            { id: "baseline", version: "1", diff: { operations: [] } },
            { id: "superseded", version: "1", diff: { operations: [] } },
          ]
        : []
    );
    const result = await startDevDatabase(deps, {
      mode: "generate-dev",
      logger: nullLogger,
      excludedMigrationIds: ["superseded"],
    });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.getPendingMigrations).toHaveBeenCalledWith({
      ...deps,
      client: devClient,
      logger: nullLogger,
    });
    expect(mocks.executeApply).toHaveBeenCalledTimes(1);
    expect(mocks.executeApply).toHaveBeenCalledWith(
      {
        ...deps,
        client: devClient,
        logger: nullLogger,
      },
      { plan: false, pretty: false, excludedMigrationIds: ["superseded"] }
    );
    expect(result.client).toBe(devClient);
    await result.cleanup();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "one-off", mode: "generate-dev" as const, expectedStops: 1 },
    { label: "persistent", mode: "dev-start" as const, expectedStops: 0 },
  ])(
    "preserves the baseline validation error and cleans up only $label databases as appropriate",
    async ({ mode, expectedStops }) => {
      const { deps } = createDependencies();
      const failure = new Error("baseline validation failed");
      mocks.getPendingMigrations.mockResolvedValue([
        { id: "baseline", version: "1", diff: { operations: [] } },
      ]);
      mocks.executeApply.mockRejectedValueOnce(failure);

      await expect(
        startDevDatabase(deps, {
          mode,
          logger: nullLogger,
        })
      ).rejects.toBe(failure);

      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(mocks.executeApply).toHaveBeenCalledTimes(1);
      expect(mocks.stop).toHaveBeenCalledTimes(expectedStops);
    }
  );

  it("uses a fresh unnamed container for squash while leaving an existing persistent container alone", async () => {
    const { deps } = createDependencies();
    const database = {
      dialect: "mysql" as const,
      connectionString: "mysql://localhost/production",
    };
    const devClient = new DBClient({
      databaseProps: { ...database, connectionString: "mysql://localhost/dev" },
    });
    const namedDeps = {
      ...deps,
      client: new DBClient({ databaseProps: database }),
      config: configSchema.parse(
        defineConfig({
          database,
          dev: { container: { image: "mysql:8", name: "persistent-dev" } },
          tables: [],
        })
      ),
    };
    mocks.getClient.mockReturnValue(devClient);
    mocks.hasReusableDevDatabase.mockResolvedValue(true);
    const freshInstance = {
      start: mocks.start,
      stop: mocks.stop,
      remove: mocks.remove,
      getConnectionString: () => "mysql://localhost/dev",
      getStatus: async () => ({ type: "unavailable" as const }),
      isAvailable: async () => true,
    };
    const persistentStop = vi.fn(async () => {});
    const persistentInstance = { ...freshInstance, stop: persistentStop };
    mocks.setup.mockImplementation(async (_config, manageType) =>
      manageType === "dev-start" ? persistentInstance : freshInstance
    );

    const result = await startDevDatabase(namedDeps, {
      mode: "generate-dev",
      logger: nullLogger,
      excludedMigrationIds: ["superseded"],
    });
    expect(mocks.setup).toHaveBeenCalledWith(
      { container: { image: "mysql:8", name: undefined } },
      "one-off"
    );
    expect(result.manager).toBe(freshInstance);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    await result.cleanup();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(persistentStop).not.toHaveBeenCalled();
    expect(namedDeps.config.dev).toEqual({
      container: { image: "mysql:8", name: "persistent-dev" },
    });
  });

  it("skips baseline application when all dev pending migrations are excluded", async () => {
    const { deps, devClient } = createDependencies();
    mocks.getPendingMigrations.mockResolvedValue([
      { id: "superseded", version: "1", diff: { operations: [] } },
    ]);
    const result = await startDevDatabase(deps, {
      mode: "generate-dev",
      logger: nullLogger,
      excludedMigrationIds: ["superseded"],
    });
    expect(mocks.getPendingMigrations).toHaveBeenCalledWith(
      expect.objectContaining({ client: devClient })
    );
    expect(mocks.executeApply).not.toHaveBeenCalled();
    await result.cleanup();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
});
