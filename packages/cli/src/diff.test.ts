import { describe, it, expect } from "vitest";
import { diffSchema, Tables, SchemaSnapshot } from "./diff";

describe("diffSchema", () => {
  it("should detect added and removed tables", () => {
    const dbTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
        },
      },
    ];
    const configTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
        },
      },
      {
        name: "posts",
        columns: {
          id: { type: "integer" },
        },
      },
    ];
    const diff = diffSchema({
      current: { tables: dbTables, indexes: [] },
      ideal: { tables: configTables, indexes: [] },
    });

    expect(diff.addedTables).toEqual([
      {
        table: "posts",
        columns: {
          id: { type: "integer" },
        },
      },
    ]);
    expect(diff.removedTables).toEqual([]);
    expect(diff.changedTables).toEqual([]);
  });

  it("should detect removed tables", () => {
    const dbTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
        },
      },
      {
        name: "posts",
        columns: {
          id: { type: "integer" },
        },
      },
    ];
    const configTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
        },
      },
    ];

    const diff = diffSchema({
      current: { tables: dbTables, indexes: [] },
      ideal: { tables: configTables, indexes: [] },
    });

    expect(diff.addedTables).toEqual([]);
    expect(diff.removedTables).toEqual(["posts"]);
    expect(diff.changedTables).toEqual([]);
  });

  it("should detect added, removed, and changed columns", () => {
    const dbTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
          name: { type: "varchar" },
          age: { type: "integer" },
        },
      },
    ];
    const configTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
          name: { type: "text" }, // type changed
          email: { type: "varchar" }, // added
        },
      },
    ];

    const diff = diffSchema({
      current: { tables: dbTables, indexes: [] },
      ideal: { tables: configTables, indexes: [] },
    });

    expect(diff.addedTables).toEqual([]);
    expect(diff.removedTables).toEqual([]);
    expect(diff.changedTables).toEqual([
      {
        table: "users",
        addedColumns: [
          {
            column: "email",
            attributes: { type: "varchar" },
          },
        ],
        removedColumns: [
          {
            column: "age",
            attributes: { type: "integer" },
          },
        ],
        changedColumns: [
          {
            column: "name",
            before: { type: "varchar" },
            after: { type: "text" },
          },
        ],
      },
    ]);
  });

  it("should return empty diff for identical tables", () => {
    const dbTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
          name: { type: "varchar" },
        },
      },
    ];
    const configTables: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
          name: { type: "varchar" },
        },
      },
    ];

    const diff = diffSchema({
      current: { tables: dbTables, indexes: [] },
      ideal: { tables: configTables, indexes: [] },
    });

    expect(diff.addedTables).toEqual([]);
    expect(diff.removedTables).toEqual([]);
    expect(diff.changedTables).toEqual([]);
  });

  it("should detect added index", () => {
    const snap = (tables: Tables, indexes: any[]): SchemaSnapshot => ({
      tables,
      indexes,
    });
    const current = snap(
      [{ name: "users", columns: { id: { type: "integer" } } }],
      []
    );
    const ideal = snap(
      [{ name: "users", columns: { id: { type: "integer" } } }],
      [{ table: "users", name: "idx_users_id", columns: ["id"], unique: false }]
    );
    const diff = diffSchema({ current, ideal });
    expect(diff.addedIndexes).toHaveLength(1);
    expect(diff.addedIndexes[0].name).toBe("idx_users_id");
  });

  it("should detect changed index (columns order)", () => {
    const current: SchemaSnapshot = {
      tables: [
        {
          name: "users",
          columns: { a: { type: "integer" }, b: { type: "integer" } },
        },
      ],
      indexes: [
        {
          table: "users",
          name: "idx_users_a_b",
          columns: ["a", "b"],
          unique: false,
          systemGenerated: false,
        },
      ],
    };
    const ideal: SchemaSnapshot = {
      tables: current.tables,
      indexes: [
        {
          table: "users",
          name: "idx_users_a_b",
          columns: ["b", "a"],
          unique: false,
          systemGenerated: false,
        },
      ],
    };
    const diff = diffSchema({ current, ideal });
    expect(diff.changedIndexes).toHaveLength(1);
    expect(diff.changedIndexes[0].before.columns).toEqual(["a", "b"]);
    expect(diff.changedIndexes[0].after.columns).toEqual(["b", "a"]);
  });

  it("should detect removed index", () => {
    const current: SchemaSnapshot = {
      tables: [{ name: "users", columns: { id: { type: "integer" } } }],
      indexes: [
        {
          table: "users",
          name: "idx_users_id",
          columns: ["id"],
          unique: false,
          systemGenerated: false,
        },
      ],
    };
    const ideal: SchemaSnapshot = { tables: current.tables, indexes: [] };
    const diff = diffSchema({ current, ideal });
    expect(diff.removedIndexes).toHaveLength(1);
    expect(diff.removedIndexes[0].name).toBe("idx_users_id");
  });

  it("should detect changed index (unique flag)", () => {
    const current: SchemaSnapshot = {
      tables: [{ name: "users", columns: { email: { type: "text" } } }],
      indexes: [
        {
          table: "users",
          name: "idx_users_email",
          columns: ["email"],
          unique: false,
          systemGenerated: false,
        },
      ],
    };
    const ideal: SchemaSnapshot = {
      tables: current.tables,
      indexes: [
        {
          table: "users",
          name: "idx_users_email",
          columns: ["email"],
          unique: true,
          systemGenerated: false,
        },
      ],
    };
    const diff = diffSchema({ current, ideal });
    expect(diff.changedIndexes).toHaveLength(1);
    expect(diff.changedIndexes[0].before.unique).toBe(false);
    expect(diff.changedIndexes[0].after.unique).toBe(true);
  });
});
