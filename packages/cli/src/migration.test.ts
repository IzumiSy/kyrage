import { describe, expect, it, vi } from "vitest";
import { getClient } from "./client";
import { createMigrationProvider } from "./migration";
import {
  defaultSchemaAdapter,
  SchemaOperationValidationError,
  type SchemaAdapter,
} from "./dialect/schema-adapter";
import type { Operation } from "./operations/executor";

/** Uses native SQL compilation with a connection-free collecting driver. */
const createPlanDB = (dialect: "postgres" | "mysql" = "postgres") =>
  getClient({
    database: {
      dialect,
      connectionString: `${dialect}://user:password@localhost/test`,
    },
  }).getDB({ plan: true });

const modification: Operation = {
  type: "alter_column",
  table: "orders",
  column: "amount",
  before: { type: "integer" },
  after: { type: "bigint" },
};

describe("migration validation", () => {
  it("rejects an unsafe later operation before executing any earlier DDL", async () => {
    await using db = createPlanDB();
    const executeDrop = vi.fn(async () => {});
    const executeAlter = vi.fn(async () => {});
    const validateOperations = vi.fn(async () => {
      throw new Error("unsafe column");
    });
    const adapter: SchemaAdapter = {
      ...defaultSchemaAdapter,
      validateOperations,
      operationExecutors: {
        drop_index: executeDrop,
        alter_column: executeAlter,
      },
    };
    const drop: Operation = {
      type: "drop_index",
      table: "orders",
      name: "idx_amount",
    };
    const provider = createMigrationProvider({
      schemaAdapter: adapter,
      options: { plan: false },
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [drop, modification] } },
      ],
    });
    const migrations = await provider.getMigrations();
    await expect(migrations["001"].up(db)).rejects.toThrow("unsafe column");
    expect(validateOperations).toHaveBeenCalledWith({
      db,
      operations: [drop, modification],
    });
    expect(executeDrop).not.toHaveBeenCalled();
    expect(executeAlter).not.toHaveBeenCalled();
    expect(db.getPlannedQueries()).toEqual([]);
  });

  it("validates only operations retained by reconciliation", async () => {
    await using db = createPlanDB();
    const validateOperations = vi.fn(async () => {});
    const drop: Operation = { type: "drop_table", table: "orders" };
    const provider = createMigrationProvider({
      schemaAdapter: { ...defaultSchemaAdapter, validateOperations },
      options: { plan: false },
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [modification, drop] } },
      ],
    });
    const migrations = await provider.getMigrations();
    await migrations["001"].up(db);
    expect(validateOperations).toHaveBeenCalledTimes(2);
    expect(validateOperations).toHaveBeenNthCalledWith(1, {
      db,
      operations: [drop],
    });
    expect(validateOperations).toHaveBeenNthCalledWith(2, {
      db,
      operations: [drop],
    });
    expect(db.getPlannedQueries().map((query) => query.sql)).toEqual([
      'drop table "orders"',
    ]);
  });

  it("validates each actual migration after the previous migration has executed", async () => {
    await using db = createPlanDB();
    let created = false;
    const create: Operation = {
      type: "create_table",
      table: "orders",
      columns: { amount: { type: "integer" } },
    };
    const validateOperations = vi.fn(
      async ({ operations }: { operations: ReadonlyArray<Operation> }) => {
        if (operations.length === 2) expect(created).toBe(false);
        if (operations[0].type === "alter_column") expect(created).toBe(true);
      },
    );
    const executeAlter = vi.fn(async () => {});
    const adapter: SchemaAdapter = {
      ...defaultSchemaAdapter,
      validateOperations,
      operationExecutors: {
        create_table: async () => {
          created = true;
        },
        alter_column: executeAlter,
      },
    };
    const provider = createMigrationProvider({
      schemaAdapter: adapter,
      options: { plan: false },
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [create] } },
        { id: "002", version: "1", diff: { operations: [modification] } },
      ],
    });
    const migrations = await provider.getMigrations();
    expect(validateOperations).not.toHaveBeenCalled();
    await migrations["001"].up(db);
    expect(executeAlter).not.toHaveBeenCalled();
    await migrations["002"].up(db);
    expect(validateOperations).toHaveBeenCalledTimes(3);
    expect(validateOperations).toHaveBeenNthCalledWith(1, {
      db,
      operations: [create, modification],
    });
    expect(validateOperations).toHaveBeenNthCalledWith(2, {
      db,
      operations: [create],
    });
    expect(validateOperations).toHaveBeenNthCalledWith(3, {
      db,
      operations: [modification],
    });
    expect(executeAlter).toHaveBeenCalledOnce();
  });

  it("retains live validation after successful preflight and stops a drifted later migration", async () => {
    await using db = createPlanDB();
    const drop: Operation = {
      type: "drop_index",
      table: "orders",
      name: "idx_amount",
    };
    const validateOperations = vi.fn(async () => {});
    validateOperations
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("live metadata changed"));
    const executeDrop = vi.fn(async () => {});
    const executeAlter = vi.fn(async () => {});
    const provider = createMigrationProvider({
      schemaAdapter: {
        ...defaultSchemaAdapter,
        validateOperations,
        operationExecutors: {
          drop_index: executeDrop,
          alter_column: executeAlter,
        },
      },
      options: { plan: false },
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [drop] } },
        { id: "002", version: "1", diff: { operations: [modification] } },
      ],
    });
    const migrations = await provider.getMigrations();
    await migrations["001"].up(db);
    await expect(migrations["002"].up(db)).rejects.toThrow(
      "live metadata changed",
    );
    expect(validateOperations).toHaveBeenCalledTimes(3);
    expect(validateOperations).toHaveBeenNthCalledWith(3, {
      db,
      operations: [modification],
    });
    expect(executeDrop).toHaveBeenCalledOnce();
    expect(executeAlter).not.toHaveBeenCalled();
  });

  it("validates sorted pending plans once using the supplied metadata connection", async () => {
    await using collector = createPlanDB();
    await using validationDB = createPlanDB();
    const create: Operation = {
      type: "create_table",
      table: "orders",
      columns: { amount: { type: "integer" } },
    };
    const validateOperations = vi.fn(async () => {});
    const execute = vi.fn(async () => {});
    const provider = createMigrationProvider({
      schemaAdapter: {
        ...defaultSchemaAdapter,
        validateOperations,
        operationExecutors: { create_table: execute, alter_column: execute },
      },
      options: { plan: true },
      validationDB,
      migrationsResolver: async () => [
        { id: "002", version: "1", diff: { operations: [modification] } },
        { id: "001", version: "1", diff: { operations: [create] } },
      ],
    });
    const migrations = await provider.getMigrations();
    expect(validateOperations).toHaveBeenCalledOnce();
    expect(validateOperations).toHaveBeenCalledWith({
      db: validationDB,
      operations: [create, modification],
    });
    await migrations["001"].up(collector);
    await migrations["002"].up(collector);
    expect(validateOperations).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, collector, create);
    expect(execute).toHaveBeenNthCalledWith(2, collector, modification);
  });

  it.each([false, true])(
    "attributes a later pending failure to its source migration before DDL (plan: %s)",
    async (plan) => {
      await using validationDB = createPlanDB();
      await using collector = createPlanDB();
      const drop: Operation = {
        type: "drop_index",
        table: "orders",
        name: "idx_amount",
      };
      const execute = vi.fn(async () => {});
      const validateOperations = vi.fn(async () => {
        throw new SchemaOperationValidationError(1, "unsafe orders.amount");
      });
      const provider = createMigrationProvider({
        schemaAdapter: {
          ...defaultSchemaAdapter,
          validateOperations,
          operationExecutors: { drop_index: execute, alter_column: execute },
        },
        options: { plan },
        validationDB,
        migrationsResolver: async () => [
          { id: "002", version: "1", diff: { operations: [modification] } },
          { id: "001", version: "1", diff: { operations: [drop] } },
        ],
      });
      const application = plan
        ? provider.getMigrations()
        : provider
            .getMigrations()
            .then((migrations) => migrations["001"].up(collector));
      await expect(application).rejects.toThrow(
        "Pending sequence preflight failed before application-schema execution at migration 002, operation 1: unsafe orders.amount",
      );
      expect(validateOperations).toHaveBeenCalledOnce();
      expect(validateOperations).toHaveBeenCalledWith({
        db: plan ? validationDB : collector,
        operations: [drop, modification],
      });
      expect(execute).not.toHaveBeenCalled();
      expect(collector.getPlannedQueries()).toEqual([]);
    },
  );

  it("preflights the sorted suffix beginning at the first actual callback, excluding applied history", async () => {
    await using db = createPlanDB();
    /** Distinguishes history from pending operations without executing DDL. */
    const dropFor = (table: string) => ({ type: "drop_table" as const, table });
    const operations = {
      "1": dropFor("applied"),
      "10": dropFor("first_pending"),
      "2": dropFor("later_pending"),
    };
    const validateOperations = vi.fn(async () => {});
    const execute = vi.fn(async () => {});
    const provider = createMigrationProvider({
      schemaAdapter: {
        ...defaultSchemaAdapter,
        validateOperations,
        operationExecutors: { drop_table: execute },
      },
      options: { plan: false },
      migrationsResolver: async () => [
        { id: "2", version: "1", diff: { operations: [operations["2"]] } },
        { id: "1", version: "1", diff: { operations: [operations["1"]] } },
        { id: "10", version: "1", diff: { operations: [operations["10"]] } },
      ],
    });
    const migrations = await provider.getMigrations();
    await migrations["10"].up(db);
    await migrations["2"].up(db);
    expect(validateOperations).toHaveBeenCalledTimes(3);
    expect(validateOperations).toHaveBeenNthCalledWith(1, {
      db,
      operations: [operations["10"], operations["2"]],
    });
    expect(validateOperations).toHaveBeenNthCalledWith(2, {
      db,
      operations: [operations["10"]],
    });
    expect(validateOperations).toHaveBeenNthCalledWith(3, {
      db,
      operations: [operations["2"]],
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("repeats pending preflight for every freshly resolved callback set", async () => {
    await using db = createPlanDB();
    const drop: Operation = { type: "drop_table", table: "orders" };
    const validateOperations = vi.fn(async () => {});
    const provider = createMigrationProvider({
      schemaAdapter: {
        ...defaultSchemaAdapter,
        validateOperations,
        operationExecutors: { drop_table: async () => {} },
      },
      options: { plan: false },
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [drop] } },
      ],
    });
    const first = await provider.getMigrations();
    await first["001"].up(db);
    const second = await provider.getMigrations();
    await second["001"].up(db);
    expect(validateOperations).toHaveBeenCalledTimes(4);
    expect(validateOperations.mock.calls).toEqual([
      [{ db, operations: [drop] }],
      [{ db, operations: [drop] }],
      [{ db, operations: [drop] }],
      [{ db, operations: [drop] }],
    ]);
  });

  it("does not mark a rejected pending preflight as complete", async () => {
    await using db = createPlanDB();
    const drop: Operation = { type: "drop_table", table: "orders" };
    const validateOperations = vi.fn(async () => {});
    validateOperations.mockRejectedValueOnce(new Error("metadata unavailable"));
    const execute = vi.fn(async () => {});
    const provider = createMigrationProvider({
      schemaAdapter: {
        ...defaultSchemaAdapter,
        validateOperations,
        operationExecutors: { drop_table: execute },
      },
      options: { plan: false },
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [drop] } },
      ],
    });
    const migrations = await provider.getMigrations();
    await expect(migrations["001"].up(db)).rejects.toThrow(
      "metadata unavailable",
    );
    expect(execute).not.toHaveBeenCalled();
    await migrations["001"].up(db);
    expect(validateOperations).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reconciles each migration separately instead of rewriting the combined history", async () => {
    await using db = createPlanDB();
    const create: Operation = {
      type: "create_table",
      table: "orders",
      columns: { amount: { type: "integer" } },
    };
    const drop: Operation = { type: "drop_table", table: "orders" };
    const validateOperations = vi.fn(async () => {});
    const provider = createMigrationProvider({
      schemaAdapter: { ...defaultSchemaAdapter, validateOperations },
      options: { plan: true },
      validationDB: db,
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [create] } },
        { id: "002", version: "1", diff: { operations: [modification, drop] } },
      ],
    });
    await provider.getMigrations();
    expect(validateOperations).toHaveBeenCalledWith({
      db,
      operations: [create, drop],
    });
  });

  it("maps an indexed failure to the reconciled source operation position", async () => {
    await using db = createPlanDB();
    const create: Operation = {
      type: "create_table",
      table: "first",
      columns: { amount: { type: "integer" } },
    };
    const drop: Operation = { type: "drop_table", table: "removed" };
    const validateOperations = vi.fn(async () => {
      throw new SchemaOperationValidationError(2, "unsafe orders.amount");
    });
    const provider = createMigrationProvider({
      schemaAdapter: { ...defaultSchemaAdapter, validateOperations },
      options: { plan: true },
      validationDB: db,
      migrationsResolver: async () => [
        { id: "001", version: "1", diff: { operations: [create] } },
        {
          id: "002",
          version: "1",
          diff: {
            operations: [
              { ...modification, table: "removed" },
              modification,
              drop,
            ],
          },
        },
      ],
    });
    await expect(provider.getMigrations()).rejects.toThrow(
      "at migration 002, operation 2: unsafe orders.amount",
    );
    expect(validateOperations).toHaveBeenCalledWith({
      db,
      operations: [create, drop, modification],
    });
  });
});
