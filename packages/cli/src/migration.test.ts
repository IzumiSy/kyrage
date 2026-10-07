import { describe, expect, it, vi } from "vitest";
import { getClient } from "./client";
import { createMigrationProvider } from "./migration";
import {
  defaultSchemaAdapter,
  type SchemaAdapter,
} from "./dialect/schema-adapter";
import { getDialect } from "./dialect/factory";
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
    expect(validateOperations).toHaveBeenCalledWith({ db, operations: [drop] });
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
        if (operations[0].type === "alter_column") expect(created).toBe(true);
      }
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
    expect(validateOperations).toHaveBeenNthCalledWith(1, {
      db,
      operations: [create],
    });
    expect(validateOperations).toHaveBeenNthCalledWith(2, {
      db,
      operations: [modification],
    });
    expect(executeAlter).toHaveBeenCalledOnce();
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

  it("rejects MySQL future-state plans before reading metadata or collecting SQL", async () => {
    await using validationDB = createPlanDB("mysql");
    const query = vi.spyOn(validationDB.getExecutor(), "executeQuery");
    const create: Operation = {
      type: "create_table",
      table: "orders",
      columns: { amount: { type: "integer" } },
    };
    const provider = createMigrationProvider({
      schemaAdapter: getDialect("mysql").createSchemaAdapter(),
      options: { plan: true },
      validationDB,
      migrationsResolver: async () => [
        { id: "002", version: "1", diff: { operations: [modification] } },
        { id: "001", version: "1", diff: { operations: [create] } },
      ],
    });
    await expect(provider.getMigrations()).rejects.toThrow(
      "state depends on earlier operations"
    );
    expect(query).not.toHaveBeenCalled();
    expect(validationDB.getPlannedQueries()).toEqual([]);
  });
});
