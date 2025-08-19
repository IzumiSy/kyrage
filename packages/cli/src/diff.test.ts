import { describe, it, expect } from "vitest";
import { diffTables, diffIndexes } from "./diff";
import { ops } from "./operation";

describe("diffTables", () => {
  it("should detect added and removed tables only", () => {
    const current = [
      { name: "users", columns: { id: { type: "integer" } } },
      { name: "old_table", columns: { id: { type: "integer" } } },
    ];
    const ideal = [
      { name: "users", columns: { id: { type: "integer" } } },
      { name: "new_table", columns: { id: { type: "integer" } } },
    ];

    const operations = diffTables({ current, ideal });

    expect(operations).toEqual([
      ops.createTable("new_table", { id: { type: "integer" } }),
      ops.dropTable("old_table"),
    ]);
  });

  it("should detect column changes in existing tables", () => {
    const current = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
          name: { type: "varchar" },
          age: { type: "integer" },
        },
      },
    ];
    const ideal = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
          name: { type: "text" }, // changed
          email: { type: "varchar" }, // added
          // age removed
        },
      },
    ];

    const operations = diffTables({ current, ideal });

    expect(operations).toEqual([
      ops.addColumn({ table: "users", column: "email" }, { type: "varchar" }),
      ops.dropColumn({ table: "users", column: "age" }, { type: "integer" }),
      ops.alterColumn(
        { table: "users", column: "name" },
        { type: "varchar" },
        { type: "text" }
      ),
    ]);
  });
});

describe("diffIndexes", () => {
  it("should detect added and removed indexes", () => {
    const current = [
      {
        table: "users",
        name: "idx_old",
        columns: ["id"],
        unique: false,
      },
    ];
    const ideal = [
      {
        table: "users",
        name: "idx_new",
        columns: ["email"],
        unique: false,
      },
    ];

    const operations = diffIndexes({ current, ideal });

    expect(operations).toEqual([
      ops.createIndex({
        table: "users",
        name: "idx_new",
        columns: ["email"],
        unique: false,
      }),
      ops.dropIndex({ table: "users", name: "idx_old" }),
    ]);
  });

  it("should detect changed indexes (creates drop + create operations)", () => {
    const current = [
      {
        table: "users",
        name: "idx_test",
        columns: ["id"],
        unique: false,
      },
    ];
    const ideal = [
      {
        table: "users",
        name: "idx_test",
        columns: ["id"],
        unique: true, // unique flag changed
      },
    ];

    const operations = diffIndexes({ current, ideal });

    expect(operations).toEqual([
      expect.objectContaining(
        ops.dropIndex({ table: "users", name: "idx_test" })
      ),
      ops.createIndex({
        table: "users",
        name: "idx_test",
        columns: ["id"],
        unique: true,
      }),
    ]);
  });

  it("should detect changed indexes (columns order)", () => {
    const current = [
      {
        table: "users",
        name: "idx_users_a_b",
        columns: ["a", "b"],
        unique: false,
      },
    ];
    const ideal = [
      {
        table: "users",
        name: "idx_users_a_b",
        columns: ["b", "a"], // column order changed
        unique: false,
      },
    ];

    const operations = diffIndexes({ current, ideal });

    expect(operations).toEqual([
      expect.objectContaining(
        ops.dropIndex({ table: "users", name: "idx_users_a_b" })
      ),
      ops.createIndex({
        table: "users",
        name: "idx_users_a_b",
        columns: ["b", "a"],
        unique: false,
      }),
    ]);
  });
});
