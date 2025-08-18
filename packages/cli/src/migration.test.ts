import { describe, it, expect } from "vitest";
import { Operation } from "./operation";
import { sortOperationsByDependency } from "./migration";

describe("sortOperationsByDependency", () => {
  it("should sort operations by dependency priority", () => {
    const operations: Operation[] = [
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
    ];

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
    const operations: Operation[] = [
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
    ];

    const sorted = sortOperationsByDependency(operations);

    // Should be sorted alphabetically by table name when priority is same
    expect(sorted[0].table).toBe("alpha_table");
    expect(sorted[1].table).toBe("zebra_table");
  });

  it("should handle comprehensive operation ordering", () => {
    const operations: Operation[] = [
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
    ];

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
    const operations: Operation[] = [
      {
        type: "create_table",
        table: "test",
        columns: { id: { type: "integer" } },
      },
      { type: "drop_table", table: "old" },
    ];

    const original = [...operations];
    const sorted = sortOperationsByDependency(operations);

    // Original should be unchanged
    expect(operations).toEqual(original);
    // Sorted should be different
    expect(sorted).not.toEqual(operations);
  });
});
