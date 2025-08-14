import { describe, it, expect } from "vitest";
import { diffSchema, SchemaSnapshot } from "./diff";

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

    expect(diff.operations).toEqual([
      // Table operations
      {
        type: "create_table",
        table: "new_table",
        columns: { id: { type: "integer" } },
      },
      {
        type: "drop_table",
        table: "old_table",
      },
      // Column operations
      {
        type: "add_column",
        table: "users",
        column: "email",
        attributes: { type: "varchar" },
      },
      // Index operations
      {
        type: "create_index",
        table: "users",
        name: "idx_new",
        columns: ["email"],
        unique: true,
      },
      {
        type: "drop_index",
        table: "users",
        name: "idx_old",
      },
    ]);
  });
});

describe("Table Operations", () => {
  it("should detect added and removed tables only", () => {
    const current: SchemaSnapshot = {
      tables: [
        { name: "users", columns: { id: { type: "integer" } } },
        { name: "old_table", columns: { id: { type: "integer" } } },
      ],
      indexes: [],
    };
    const ideal: SchemaSnapshot = {
      tables: [
        { name: "users", columns: { id: { type: "integer" } } },
        { name: "new_table", columns: { id: { type: "integer" } } },
      ],
      indexes: [],
    };

    const diff = diffSchema({ current, ideal });

    expect(diff.operations).toEqual([
      {
        type: "create_table",
        table: "new_table",
        columns: { id: { type: "integer" } },
      },
      {
        type: "drop_table",
        table: "old_table",
      },
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
    };

    const diff = diffSchema({ current, ideal });

    expect(diff.operations).toEqual([
      {
        type: "add_column",
        table: "users",
        column: "email",
        attributes: { type: "varchar" },
      },
      {
        type: "drop_column",
        table: "users",
        column: "age",
        attributes: { type: "integer" },
      },
      {
        type: "alter_column",
        table: "users",
        column: "name",
        before: { type: "varchar" },
        after: { type: "text" },
      },
    ]);
  });
});

describe("Index Operations", () => {
  it("should detect added and removed indexes", () => {
    const current: SchemaSnapshot = {
      tables: [],
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
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_new",
          columns: ["email"],
          unique: false,
          systemGenerated: false,
        },
      ],
    };

    const diff = diffSchema({ current, ideal });

    expect(diff.operations).toEqual([
      {
        type: "create_index",
        table: "users",
        name: "idx_new",
        columns: ["email"],
        unique: false,
      },
      {
        type: "drop_index",
        table: "users",
        name: "idx_old",
      },
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
          systemGenerated: false,
        },
      ],
    };
    const ideal: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_test",
          columns: ["id"],
          unique: true, // unique flag changed
          systemGenerated: false,
        },
      ],
    };

    const diff = diffSchema({ current, ideal });

    expect(diff.operations).toEqual([
      {
        type: "drop_index",
        table: "users",
        name: "idx_test",
      },
      {
        type: "create_index",
        table: "users",
        name: "idx_test",
        columns: ["id"],
        unique: true,
      },
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
          systemGenerated: false,
        },
      ],
    };
    const ideal: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "idx_users_a_b",
          columns: ["b", "a"], // column order changed
          unique: false,
          systemGenerated: false,
        },
      ],
    };

    const diff = diffSchema({ current, ideal });

    expect(diff.operations).toEqual([
      {
        type: "drop_index",
        table: "users",
        name: "idx_users_a_b",
      },
      {
        type: "create_index",
        table: "users",
        name: "idx_users_a_b",
        columns: ["b", "a"],
        unique: false,
      },
    ]);
  });

  it("should ignore system generated indexes", () => {
    const current: SchemaSnapshot = {
      tables: [],
      indexes: [
        {
          table: "users",
          name: "system_idx",
          columns: ["id"],
          unique: false,
          systemGenerated: true,
        },
      ],
    };
    const ideal: SchemaSnapshot = {
      tables: [],
      indexes: [],
    };

    const diff = diffSchema({ current, ideal });

    // System generated indexes should be ignored
    expect(diff.operations).toHaveLength(0);
  });
});
