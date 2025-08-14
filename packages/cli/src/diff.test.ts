import { describe, it, expect } from "vitest";
import {
  diffSchema,
  diffTables,
  diffIndexes,
  Tables,
  SchemaSnapshot,
} from "./diff";

describe("diffSchema", () => {
  it("should integrate diffTables and diffIndexes correctly", () => {
    const current: SchemaSnapshot = {
      tables: [
        { name: "users", columns: { id: { type: "integer" } } },
        { name: "old_table", columns: { id: { type: "integer" } } },
      ],
      indexes: [
        {
          table: "users",
          name: "idx_old",
          columns: ["id"],
          unique: false,
          systemGenerated: false,
        },
      ],
    };
    const ideal: SchemaSnapshot = {
      tables: [
        {
          name: "users",
          columns: { id: { type: "integer" }, email: { type: "varchar" } },
        },
        { name: "new_table", columns: { id: { type: "integer" } } },
      ],
      indexes: [
        {
          table: "users",
          name: "idx_new",
          columns: ["email"],
          unique: true,
          systemGenerated: false,
        },
      ],
    };

    const diff = diffSchema({ current, ideal });

    // テーブル差分の統合確認
    expect(diff.addedTables).toHaveLength(1);
    expect(diff.removedTables).toHaveLength(1);
    expect(diff.changedTables).toHaveLength(1);

    // インデックス差分の統合確認
    expect(diff.addedIndexes).toHaveLength(1);
    expect(diff.removedIndexes).toHaveLength(1);
    expect(diff.changedIndexes).toHaveLength(0);
  });
});

describe("diffTables", () => {
  it("should detect added and removed tables only", () => {
    const current: Tables = [
      { name: "users", columns: { id: { type: "integer" } } },
      { name: "old_table", columns: { id: { type: "integer" } } },
    ];
    const ideal: Tables = [
      { name: "users", columns: { id: { type: "integer" } } },
      { name: "new_table", columns: { id: { type: "integer" } } },
    ];

    const diff = diffTables(current, ideal);

    expect(diff.addedTables).toEqual([
      { table: "new_table", columns: { id: { type: "integer" } } },
    ]);
    expect(diff.removedTables).toEqual(["old_table"]);
    expect(diff.changedTables).toEqual([]);
  });

  it("should detect column changes in existing tables", () => {
    const current: Tables = [
      {
        name: "users",
        columns: {
          id: { type: "integer" },
          name: { type: "varchar" },
          age: { type: "integer" },
        },
      },
    ];
    const ideal: Tables = [
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

    const diff = diffTables(current, ideal);

    expect(diff.addedTables).toEqual([]);
    expect(diff.removedTables).toEqual([]);
    expect(diff.changedTables).toHaveLength(1);
    expect(diff.changedTables[0].table).toBe("users");
    expect(diff.changedTables[0].addedColumns).toHaveLength(1);
    expect(diff.changedTables[0].removedColumns).toHaveLength(1);
    expect(diff.changedTables[0].changedColumns).toHaveLength(1);
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
        systemGenerated: false,
      },
    ];
    const ideal = [
      {
        table: "users",
        name: "idx_new",
        columns: ["email"],
        unique: false,
        systemGenerated: false,
      },
    ];

    const diff = diffIndexes(current, ideal);

    expect(diff.addedIndexes).toHaveLength(1);
    expect(diff.addedIndexes[0].name).toBe("idx_new");
    expect(diff.removedIndexes).toHaveLength(1);
    expect(diff.removedIndexes[0].name).toBe("idx_old");
    expect(diff.changedIndexes).toHaveLength(0);
  });

  it("should detect changed indexes", () => {
    const baseIndex = {
      table: "users",
      name: "idx_test",
      systemGenerated: false,
    };
    const current = [{ ...baseIndex, columns: ["id"], unique: false }];
    const ideal = [
      { ...baseIndex, columns: ["id"], unique: true }, // unique flag changed
    ];

    const diff = diffIndexes(current, ideal);

    expect(diff.addedIndexes).toHaveLength(0);
    expect(diff.removedIndexes).toHaveLength(0);
    expect(diff.changedIndexes).toHaveLength(1);
    expect(diff.changedIndexes[0].before.unique).toBe(false);
    expect(diff.changedIndexes[0].after.unique).toBe(true);
  });

  it("should detect changed indexes (columns order)", () => {
    const baseIndex = {
      table: "users",
      name: "idx_users_a_b",
      unique: false,
      systemGenerated: false,
    };
    const current = [{ ...baseIndex, columns: ["a", "b"] }];
    const ideal = [
      { ...baseIndex, columns: ["b", "a"] }, // column order changed
    ];

    const diff = diffIndexes(current, ideal);

    expect(diff.addedIndexes).toHaveLength(0);
    expect(diff.removedIndexes).toHaveLength(0);
    expect(diff.changedIndexes).toHaveLength(1);
    expect(diff.changedIndexes[0].before.columns).toEqual(["a", "b"]);
    expect(diff.changedIndexes[0].after.columns).toEqual(["b", "a"]);
  });

  it("should ignore system generated indexes", () => {
    const current = [
      {
        table: "users",
        name: "system_idx",
        columns: ["id"],
        unique: false,
        systemGenerated: true,
      },
    ];
    const ideal: typeof current = [];

    const diff = diffIndexes(current, ideal);

    expect(diff.addedIndexes).toHaveLength(0);
    expect(diff.removedIndexes).toHaveLength(0);
    expect(diff.changedIndexes).toHaveLength(0);
  });
});
