import { describe, it, expect } from "vitest";
import { diffTables, diffIndexes } from "./diff";
import { SchemaSnapshot, ops } from "./operation";

describe("diffTables", () => {
  it("should detect added and removed tables only", () => {
    const current: SchemaSnapshot = {
      tables: [
        { name: "users", columns: { id: { type: "integer" } } },
        { name: "old_table", columns: { id: { type: "integer" } } },
      ],
      indexes: [],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };
    const ideal: SchemaSnapshot = {
      tables: [
        { name: "users", columns: { id: { type: "integer" } } },
        { name: "new_table", columns: { id: { type: "integer" } } },
      ],
      indexes: [],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };

    const operations = diffTables({ current, ideal });

    expect(operations).toEqual([
      ops.createTable("new_table", { id: { type: "integer" } }),
      ops.dropTable("old_table"),
    ]);
  });

  it("should detect column changes in existing tables", () => {
    const current: SchemaSnapshot = {
      tables: [
        {
          name: "users",
          columns: {
            id: { type: "integer" },
            name: { type: "varchar" },
            age: { type: "integer" },
          },
        },
      ],
      indexes: [],

      primaryKeyConstraints: [],

      uniqueConstraints: [],
    };
    const ideal: SchemaSnapshot = {
      tables: [
        {
          name: "users",
          columns: {
            id: { type: "integer" },
            name: { type: "text" }, // changed
            email: { type: "varchar" }, // added
            // age removed
          },
        },
      ],
      indexes: [],

      primaryKeyConstraints: [],

      uniqueConstraints: [],
    };

    const operations = diffTables({ current, ideal });

    expect(operations).toEqual([
      ops.addColumn("users", "email", { type: "varchar" }),
      ops.dropColumn("users", "age", { type: "integer" }),
      ops.alterColumn("users", "name", { type: "varchar" }, { type: "text" }),
    ]);
  });
});

describe("diffIndexes", () => {
  it("should detect added and removed indexes", () => {
    const current: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_old",
          columns: ["id"],
          unique: false,
        },
      ],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };
    const ideal: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_new",
          columns: ["email"],
          unique: false,
        },
      ],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };

    const operations = diffIndexes({ current, ideal });

    expect(operations).toEqual([
      ops.createIndex("users", "idx_new", ["email"], false),
      ops.dropIndex("users", "idx_old"),
    ]);
  });

  it("should detect changed indexes (creates drop + create operations)", () => {
    const current: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_test",
          columns: ["id"],
          unique: false,
        },
      ],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };
    const ideal: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_test",
          columns: ["id"],
          unique: true, // unique flag changed
        },
      ],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };

    const operations = diffIndexes({ current, ideal });

    expect(operations).toEqual([
      ops.dropIndex("users", "idx_test"),
      ops.createIndex("users", "idx_test", ["id"], true),
    ]);
  });

  it("should detect changed indexes (columns order)", () => {
    const current: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_users_a_b",
          columns: ["a", "b"],
          unique: false,
        },
      ],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };
    const ideal: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_users_a_b",
          columns: ["b", "a"], // column order changed
          unique: false,
        },
      ],
      primaryKeyConstraints: [],
      uniqueConstraints: [],
    };

    const operations = diffIndexes({ current, ideal });

    expect(operations).toEqual([
      ops.dropIndex("users", "idx_users_a_b"),
      ops.createIndex("users", "idx_users_a_b", ["b", "a"], false),
    ]);
  });
});
