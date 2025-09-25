import { describe, it, expect } from "vitest";
import {
  sortOperationsByDependency,
  mergeTableCreationWithConstraints,
} from "./reconciler";
import { Operation } from "./executor";

describe("sortOperationsByDependency", () => {
  it("should sort operations by dependency priority", () => {
    const operations = [
      {
        type: "create_unique_constraint",
        table: "users",
        name: "uk_users_email",
        columns: ["email"],
      },
      {
        type: "drop_table",
        table: "old_table",
      },
      {
        type: "create_table",
        table: "new_table",
        columns: {
          id: { type: "integer" },
          name: { type: "varchar" },
        },
      },
      {
        type: "alter_column",
        table: "users",
        column: "name",
        before: { type: "varchar" },
        after: { type: "text" },
      },
      {
        type: "drop_unique_constraint",
        table: "users",
        name: "uk_users_old",
      },
    ] as const;

    const sorted = sortOperationsByDependency(operations);

    // Expected order by priority:
    // 1. drop_unique_constraint (priority 1)
    // 2. drop_table (priority 5)
    // 3. create_table (priority 6)
    // 4. alter_column (priority 8)
    // 5. create_unique_constraint (priority 11)

    expect(sorted[0].type).toBe("drop_unique_constraint");
    expect(sorted[1].type).toBe("drop_table");
    expect(sorted[2].type).toBe("create_table");
    expect(sorted[3].type).toBe("alter_column");
    expect(sorted[4].type).toBe("create_unique_constraint");
  });

  it("should sort operations with same priority by table name", () => {
    const operations = [
      {
        type: "create_table",
        table: "zebra_table",
        columns: { id: { type: "integer" } },
      },
      {
        type: "create_table",
        table: "alpha_table",
        columns: { id: { type: "integer" } },
      },
    ] as const;

    const sorted = sortOperationsByDependency(operations);

    // Should be sorted alphabetically by table name when priority is same
    expect(sorted[0].table).toBe("alpha_table");
    expect(sorted[1].table).toBe("zebra_table");
  });

  it("should handle comprehensive operation ordering", () => {
    const operations = [
      {
        type: "create_index",
        table: "users",
        name: "idx_users_name",
        columns: ["name"],
        unique: false,
      },
      { type: "drop_primary_key_constraint", table: "users", name: "pk_users" },
      {
        type: "add_column",
        table: "users",
        column: "email",
        attributes: { type: "varchar" },
      },
      { type: "drop_index", table: "users", name: "idx_old" },
      {
        type: "create_primary_key_constraint",
        table: "users",
        name: "pk_users_new",
        columns: ["id"],
      },
    ] as const;

    const sorted = sortOperationsByDependency(operations);
    const types = sorted.map((op) => op.type);

    // Verify drop operations come first, create operations come last
    expect(types.indexOf("drop_primary_key_constraint")).toBeLessThan(
      types.indexOf("add_column")
    );
    expect(types.indexOf("drop_index")).toBeLessThan(
      types.indexOf("add_column")
    );
    expect(types.indexOf("add_column")).toBeLessThan(
      types.indexOf("create_index")
    );
    expect(types.indexOf("add_column")).toBeLessThan(
      types.indexOf("create_primary_key_constraint")
    );
  });

  it("should not mutate original operations array", () => {
    const operations = [
      {
        type: "create_table",
        table: "test",
        columns: { id: { type: "integer" } },
      },
      { type: "drop_table", table: "old" },
    ] as const;

    const original = [...operations];
    const sorted = sortOperationsByDependency(operations);

    // Original should be unchanged
    expect(operations).toEqual(original);
    // Sorted should be different
    expect(sorted).not.toEqual(operations);
  });
});

describe("mergeTableCreationWithConstraints", () => {
  it("should merge primary key and unique constraints", () => {
    const operations: Operation[] = [
      {
        type: "create_primary_key_constraint",
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      },
      {
        type: "create_unique_constraint",
        table: "users",
        name: "users_email_unique",
        columns: ["email"],
      },
      {
        type: "create_foreign_key_constraint",
        table: "posts",
        name: "posts_user_fkey",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
      },
      {
        type: "create_table",
        table: "users",
        columns: { id: { type: "integer" }, email: { type: "varchar" } },
      },
      {
        type: "create_index",
        table: "posts",
        name: "posts_title_idx",
        columns: ["title"],
        unique: false,
      },
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      {
        type: "create_table_with_constraints",
        table: "users",
        columns: { id: { type: "integer" }, email: { type: "varchar" } },
        constraints: {
          primaryKey: { name: "users_pkey", columns: ["id"] },
          unique: [{ name: "users_email_unique", columns: ["email"] }],
        },
      },
      {
        type: "create_foreign_key_constraint",
        table: "posts",
        name: "posts_user_fkey",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
      },
      {
        type: "create_index",
        table: "posts",
        name: "posts_title_idx",
        columns: ["title"],
        unique: false,
      },
    ]);
  });

  it("should keep create_table unchanged when no constraints to merge", () => {
    const operations: Operation[] = [
      {
        type: "create_table",
        table: "users",
        columns: { id: { type: "integer" } },
      },
      {
        type: "create_index",
        table: "users",
        name: "users_id_idx",
        columns: ["id"],
        unique: false,
      },
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual(operations);
  });

  it("should handle multiple tables with mixed constraints", () => {
    const operations: Operation[] = [
      {
        type: "create_table",
        table: "users",
        columns: { id: { type: "integer" }, name: { type: "varchar" } },
      },
      {
        type: "create_table",
        table: "posts",
        columns: { id: { type: "integer" }, title: { type: "varchar" } },
      },
      {
        type: "create_primary_key_constraint",
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      },
      {
        type: "create_unique_constraint",
        table: "users",
        name: "users_name_unique",
        columns: ["name"],
      },
      {
        type: "create_primary_key_constraint",
        table: "posts",
        name: "posts_pkey",
        columns: ["id"],
      },
      {
        type: "create_foreign_key_constraint",
        table: "posts",
        name: "posts_user_fkey",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
      },
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      {
        type: "create_table_with_constraints",
        table: "users",
        columns: { id: { type: "integer" }, name: { type: "varchar" } },
        constraints: {
          primaryKey: { name: "users_pkey", columns: ["id"] },
          unique: [{ name: "users_name_unique", columns: ["name"] }],
        },
      },
      {
        type: "create_table_with_constraints",
        table: "posts",
        columns: { id: { type: "integer" }, title: { type: "varchar" } },
        constraints: {
          primaryKey: { name: "posts_pkey", columns: ["id"] },
        },
      },
      {
        type: "create_foreign_key_constraint",
        table: "posts",
        name: "posts_user_fkey",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
      },
    ]);
  });

  it("should preserve operation order for non-merged operations", () => {
    const operations: Operation[] = [
      { type: "drop_table", table: "old_table" },
      {
        type: "create_table",
        table: "users",
        columns: { id: { type: "integer" } },
      },
      {
        type: "create_primary_key_constraint",
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      },
      {
        type: "create_index",
        table: "other_table",
        name: "other_idx",
        columns: ["col"],
        unique: false,
      },
      {
        type: "add_column",
        table: "existing_table",
        column: "new_col",
        attributes: { type: "varchar" },
      },
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      {
        type: "create_table_with_constraints",
        table: "users",
        columns: { id: { type: "integer" } },
        constraints: {
          primaryKey: { name: "users_pkey", columns: ["id"] },
        },
      },
      { type: "drop_table", table: "old_table" },
      {
        type: "create_index",
        table: "other_table",
        name: "other_idx",
        columns: ["col"],
        unique: false,
      },
      {
        type: "add_column",
        table: "existing_table",
        column: "new_col",
        attributes: { type: "varchar" },
      },
    ]);
  });

  it("should handle constraints without corresponding create_table", () => {
    const operations: Operation[] = [
      {
        type: "create_primary_key_constraint",
        table: "existing_table",
        name: "pk",
        columns: ["id"],
      },
      {
        type: "create_unique_constraint",
        table: "existing_table",
        name: "uq",
        columns: ["email"],
      },
      {
        type: "add_column",
        table: "other_table",
        column: "col",
        attributes: { type: "varchar" },
      },
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual(operations);
  });

  it("should merge self-referencing foreign key constraints with table creation", () => {
    const operations: Operation[] = [
      {
        type: "create_table",
        table: "users",
        columns: { id: { type: "integer" }, parent_id: { type: "integer" } },
      },
      {
        type: "create_primary_key_constraint",
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      },
      {
        type: "create_foreign_key_constraint",
        table: "users",
        name: "users_parent_fkey",
        columns: ["parent_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
      },
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      {
        type: "create_table_with_constraints",
        table: "users",
        columns: { id: { type: "integer" }, parent_id: { type: "integer" } },
        constraints: {
          primaryKey: { name: "users_pkey", columns: ["id"] },
          foreignKeys: [
            {
              name: "users_parent_fkey",
              columns: ["parent_id"],
              referencedTable: "users",
              referencedColumns: ["id"],
              onDelete: undefined,
              onUpdate: undefined,
            },
          ],
        },
      },
    ]);
  });

  it("should keep cross-table foreign key constraints as separate operations", () => {
    const operations: Operation[] = [
      {
        type: "create_table",
        table: "users",
        columns: { id: { type: "integer" }, email: { type: "varchar" } },
      },
      {
        type: "create_table",
        table: "posts",
        columns: { id: { type: "integer" }, user_id: { type: "integer" }, title: { type: "varchar" } },
      },
      {
        type: "create_primary_key_constraint",
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      },
      {
        type: "create_unique_constraint",
        table: "users",
        name: "users_email_unique",
        columns: ["email"],
      },
      {
        type: "create_primary_key_constraint",
        table: "posts",
        name: "posts_pkey",
        columns: ["id"],
      },
      {
        type: "create_foreign_key_constraint",
        table: "posts",
        name: "posts_user_fkey",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "restrict",
      },
      {
        type: "create_unique_constraint",
        table: "posts",
        name: "posts_title_unique",
        columns: ["title"],
      },
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      {
        type: "create_table_with_constraints",
        table: "users",
        columns: { id: { type: "integer" }, email: { type: "varchar" } },
        constraints: {
          primaryKey: { name: "users_pkey", columns: ["id"] },
          unique: [{ name: "users_email_unique", columns: ["email"] }],
        },
      },
      {
        type: "create_table_with_constraints",
        table: "posts",
        columns: { id: { type: "integer" }, user_id: { type: "integer" }, title: { type: "varchar" } },
        constraints: {
          primaryKey: { name: "posts_pkey", columns: ["id"] },
          unique: [{ name: "posts_title_unique", columns: ["title"] }],
        },
      },
      // Cross-table foreign key constraint remains as separate operation
      {
        type: "create_foreign_key_constraint",
        table: "posts",
        name: "posts_user_fkey",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
        onDelete: "cascade",
        onUpdate: "restrict",
      },
    ]);
  });
});
