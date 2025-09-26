import { describe, it, expect } from "vitest";
import {
  sortOperationsByDependency,
  mergeTableCreationWithConstraints,
} from "./reconciler";
import { Operation } from "./executor";
import { createTable } from "./table/createTable";
import { createTableWithConstraints } from "./table/createTableWithConstraints";
import { addColumn } from "./column/addColumn";
import { alterColumn } from "./column/alterColumn";
import { dropTable } from "./table/dropTable";
import { createIndex } from "./index/createIndex";
import { dropIndex } from "./index/dropIndex";
import { createPrimaryKeyConstraint } from "./constraint/createPrimaryKeyConstraint";
import { createUniqueConstraint } from "./constraint/createUniqueConstraint";
import { createForeignKeyConstraint } from "./constraint/createForeignKeyConstraint";
import { dropPrimaryKeyConstraint } from "./constraint/dropPrimaryKeyConstraint";
import { dropUniqueConstraint } from "./constraint/dropUniqueConstraint";

describe("sortOperationsByDependency", () => {
  it("should sort operations by dependency priority", () => {
    const operations = [
      createUniqueConstraint({
        table: "users",
        name: "uk_users_email",
        columns: ["email"],
      }),
      dropTable("old_table"),
      createTable("new_table", {
        id: { type: "integer" },
        name: { type: "varchar" },
      }),
      alterColumn(
        { table: "users", column: "name" },
        { type: "varchar" },
        { type: "text" }
      ),
      dropUniqueConstraint({ table: "users", name: "uk_users_old" }),
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
      createTable("zebra_table", { id: { type: "integer" } }),
      createTable("alpha_table", { id: { type: "integer" } }),
    ] as const;

    const sorted = sortOperationsByDependency(operations);

    // Should be sorted alphabetically by table name when priority is same
    expect(sorted[0].table).toBe("alpha_table");
    expect(sorted[1].table).toBe("zebra_table");
  });

  it("should handle comprehensive operation ordering", () => {
    const operations = [
      createIndex({
        table: "users",
        name: "idx_users_name",
        columns: ["name"],
        unique: false,
      }),
      dropPrimaryKeyConstraint({ table: "users", name: "pk_users" }),
      addColumn({ table: "users", column: "email" }, { type: "varchar" }),
      dropIndex({ table: "users", name: "idx_old" }),
      createPrimaryKeyConstraint({
        table: "users",
        name: "pk_users_new",
        columns: ["id"],
      }),
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
      createTable("test", { id: { type: "integer" } }),
      dropTable("old"),
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
      createPrimaryKeyConstraint({
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      }),
      createUniqueConstraint({
        table: "users",
        name: "users_email_unique",
        columns: ["email"],
      }),
      createForeignKeyConstraint(
        { table: "posts", name: "posts_user_fkey" },
        {
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
        }
      ),
      createTable("users", {
        id: { type: "integer" },
        email: { type: "varchar" },
      }),
      createIndex({
        table: "posts",
        name: "posts_title_idx",
        columns: ["title"],
        unique: false,
      }),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      createTableWithConstraints(
        "users",
        { id: { type: "integer" }, email: { type: "varchar" } },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "users",
            name: "users_pkey",
            columns: ["id"],
          }),
          unique: [
            createUniqueConstraint({
              table: "users",
              name: "users_email_unique",
              columns: ["email"],
            }),
          ],
        }
      ),
      createForeignKeyConstraint(
        { table: "posts", name: "posts_user_fkey" },
        {
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
        }
      ),
      createIndex({
        table: "posts",
        name: "posts_title_idx",
        columns: ["title"],
        unique: false,
      }),
    ]);
  });

  it("should keep create_table unchanged when no constraints to merge", () => {
    const operations: Operation[] = [
      createTable("users", { id: { type: "integer" } }),
      createIndex({
        table: "users",
        name: "users_id_idx",
        columns: ["id"],
        unique: false,
      }),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual(operations);
  });

  it("should handle multiple tables with mixed constraints", () => {
    const operations: Operation[] = [
      createTable("users", {
        id: { type: "integer" },
        name: { type: "varchar" },
      }),
      createTable("posts", {
        id: { type: "integer" },
        title: { type: "varchar" },
        user_id: { type: "integer" },
      }),
      createPrimaryKeyConstraint({
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      }),
      createUniqueConstraint({
        table: "users",
        name: "users_name_unique",
        columns: ["name"],
      }),
      createPrimaryKeyConstraint({
        table: "posts",
        name: "posts_pkey",
        columns: ["id"],
      }),
      createForeignKeyConstraint(
        { table: "posts", name: "posts_user_fkey" },
        {
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
        }
      ),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      createTableWithConstraints(
        "users",
        { id: { type: "integer" }, name: { type: "varchar" } },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "users",
            name: "users_pkey",
            columns: ["id"],
          }),
          unique: [
            createUniqueConstraint({
              table: "users",
              name: "users_name_unique",
              columns: ["name"],
            }),
          ],
        }
      ),
      createTableWithConstraints(
        "posts",
        {
          id: { type: "integer" },
          title: { type: "varchar" },
          user_id: { type: "integer" },
        },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "posts",
            name: "posts_pkey",
            columns: ["id"],
          }),
          foreignKeys: [
            createForeignKeyConstraint(
              { table: "posts", name: "posts_user_fkey" },
              {
                columns: ["user_id"],
                referencedTable: "users",
                referencedColumns: ["id"],
                onDelete: undefined,
                onUpdate: undefined,
                inline: undefined,
              }
            ),
          ],
        }
      ),
    ]);
  });

  it("should preserve operation order for non-merged operations", () => {
    const operations: Operation[] = [
      dropTable("old_table"),
      createTable("users", { id: { type: "integer" } }),
      createPrimaryKeyConstraint({
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      }),
      createIndex({
        table: "other_table",
        name: "other_idx",
        columns: ["col"],
        unique: false,
      }),
      addColumn(
        { table: "existing_table", column: "new_col" },
        { type: "varchar" }
      ),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      createTableWithConstraints(
        "users",
        { id: { type: "integer" } },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "users",
            name: "users_pkey",
            columns: ["id"],
          }),
        }
      ),
      dropTable("old_table"),
      createIndex({
        table: "other_table",
        name: "other_idx",
        columns: ["col"],
        unique: false,
      }),
      addColumn(
        { table: "existing_table", column: "new_col" },
        { type: "varchar" }
      ),
    ]);
  });

  it("should handle constraints without corresponding create_table", () => {
    const operations: Operation[] = [
      createPrimaryKeyConstraint({
        table: "existing_table",
        name: "pk",
        columns: ["id"],
      }),
      createUniqueConstraint({
        table: "existing_table",
        name: "uq",
        columns: ["email"],
      }),
      addColumn({ table: "other_table", column: "col" }, { type: "varchar" }),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual(operations);
  });

  it("should merge self-referencing foreign key constraints with table creation", () => {
    const operations: Operation[] = [
      createTable("users", {
        id: { type: "integer" },
        parent_id: { type: "integer" },
      }),
      createPrimaryKeyConstraint({
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      }),
      createForeignKeyConstraint(
        { table: "users", name: "users_parent_fkey" },
        {
          columns: ["parent_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
        }
      ),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      createTableWithConstraints(
        "users",
        { id: { type: "integer" }, parent_id: { type: "integer" } },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "users",
            name: "users_pkey",
            columns: ["id"],
          }),
          foreignKeys: [
            createForeignKeyConstraint(
              { table: "users", name: "users_parent_fkey" },
              {
                columns: ["parent_id"],
                referencedTable: "users",
                referencedColumns: ["id"],
                onDelete: undefined,
                onUpdate: undefined,
                inline: undefined,
              }
            ),
          ],
        }
      ),
    ]);
  });

  it("should merge cross-table foreign key constraints with table creation (default inline: true)", () => {
    const operations: Operation[] = [
      createTable("users", {
        id: { type: "integer" },
        email: { type: "varchar" },
      }),
      createTable("posts", {
        id: { type: "integer" },
        user_id: { type: "integer" },
        title: { type: "varchar" },
      }),
      createPrimaryKeyConstraint({
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      }),
      createUniqueConstraint({
        table: "users",
        name: "users_email_unique",
        columns: ["email"],
      }),
      createPrimaryKeyConstraint({
        table: "posts",
        name: "posts_pkey",
        columns: ["id"],
      }),
      createForeignKeyConstraint(
        { table: "posts", name: "posts_user_fkey" },
        {
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
          onDelete: "cascade",
          onUpdate: "restrict",
        }
      ),
      createUniqueConstraint({
        table: "posts",
        name: "posts_title_unique",
        columns: ["title"],
      }),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      createTableWithConstraints(
        "users",
        { id: { type: "integer" }, email: { type: "varchar" } },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "users",
            name: "users_pkey",
            columns: ["id"],
          }),
          unique: [
            createUniqueConstraint({
              table: "users",
              name: "users_email_unique",
              columns: ["email"],
            }),
          ],
        }
      ),
      createTableWithConstraints(
        "posts",
        {
          id: { type: "integer" },
          user_id: { type: "integer" },
          title: { type: "varchar" },
        },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "posts",
            name: "posts_pkey",
            columns: ["id"],
          }),
          unique: [
            createUniqueConstraint({
              table: "posts",
              name: "posts_title_unique",
              columns: ["title"],
            }),
          ],
          foreignKeys: [
            createForeignKeyConstraint(
              { table: "posts", name: "posts_user_fkey" },
              {
                columns: ["user_id"],
                referencedTable: "users",
                referencedColumns: ["id"],
                onDelete: "cascade",
                onUpdate: "restrict",
                inline: undefined,
              }
            ),
          ],
        }
      ),
    ]);
  });

  it("should respect inline: false option for foreign key constraints", () => {
    const operations: Operation[] = [
      createTable("users", {
        id: { type: "integer" },
        parent_id: { type: "integer" },
      }),
      createPrimaryKeyConstraint({
        table: "users",
        name: "users_pkey",
        columns: ["id"],
      }),
      createForeignKeyConstraint(
        { table: "users", name: "users_parent_fkey" },
        {
          columns: ["parent_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
          inline: false, // 明示的にinline: falseを指定
        }
      ),
    ];

    const result = mergeTableCreationWithConstraints(operations);

    expect(result).toEqual([
      createTableWithConstraints(
        "users",
        { id: { type: "integer" }, parent_id: { type: "integer" } },
        {
          primaryKey: createPrimaryKeyConstraint({
            table: "users",
            name: "users_pkey",
            columns: ["id"],
          }),
        }
      ),
      createForeignKeyConstraint(
        { table: "users", name: "users_parent_fkey" },
        {
          columns: ["parent_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
          inline: false,
        }
      ),
    ]);
  });

  it("should throw error when foreign key references non-existent column", () => {
    const operations: Operation[] = [
      createTable("posts", {
        id: { type: "integer" },
        title: { type: "varchar" },
      }),
      createForeignKeyConstraint(
        { table: "posts", name: "posts_user_fkey" },
        {
          columns: ["user_id"], // Undefined column reference
          referencedTable: "users",
          referencedColumns: ["id"],
        }
      ),
    ];

    expect(() => mergeTableCreationWithConstraints(operations)).toThrow(
      'Foreign key constraint "posts_user_fkey" references non-existent columns: user_id'
    );
  });

  it("should throw error when foreign key references multiple non-existent columns", () => {
    const operations: Operation[] = [
      createTable("orders", {
        id: { type: "integer" },
        total: { type: "decimal" },
      }),
      createForeignKeyConstraint(
        { table: "orders", name: "orders_composite_fkey" },
        {
          columns: ["user_id", "product_id"], // Undefined column reference
          referencedTable: "user_products",
          referencedColumns: ["user_id", "product_id"],
        }
      ),
    ];

    expect(() => mergeTableCreationWithConstraints(operations)).toThrow(
      'Foreign key constraint "orders_composite_fkey" references non-existent columns: user_id, product_id'
    );
  });
});
