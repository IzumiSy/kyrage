import { describe, it, expect } from "vitest";
import { consolidateCreateTableWithConstraints } from "./diff";
import { ops, Operation } from "./operation";

describe("consolidateCreateTableWithConstraints", () => {
  it("should consolidate primary key constraint into create_table operation", () => {
    const operations: Operation[] = [
      ops.createTable("users", {
        id: { type: "uuid" },
        name: { type: "text" },
      }),
      ops.createPrimaryKeyConstraint({
        table: "users",
        name: "pk_users_id",
        columns: ["id"],
      }),
    ];

    const result = consolidateCreateTableWithConstraints(operations);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "create_table",
      table: "users",
      constraints: {
        primaryKey: {
          name: "pk_users_id",
          columns: ["id"],
        },
      },
    });
  });

  it("should consolidate multiple unique constraints into create_table operation", () => {
    const operations: Operation[] = [
      ops.createTable("users", {
        id: { type: "uuid" },
        email: { type: "text" },
        username: { type: "text" },
      }),
      ops.createUniqueConstraint({
        table: "users",
        name: "uq_users_email",
        columns: ["email"],
      }),
      ops.createUniqueConstraint({
        table: "users",
        name: "uq_users_username",
        columns: ["username"],
      }),
    ];

    const result = consolidateCreateTableWithConstraints(operations);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "create_table",
      table: "users",
      constraints: {
        unique: [
          {
            name: "uq_users_email",
            columns: ["email"],
          },
          {
            name: "uq_users_username",
            columns: ["username"],
          },
        ],
      },
    });
  });

  it("should NOT consolidate foreign key constraints into create_table operation", () => {
    const operations: Operation[] = [
      ops.createTable("posts", {
        id: { type: "uuid" },
        user_id: { type: "uuid" },
      }),
      ops.createForeignKeyConstraint(
        {
          table: "posts",
          name: "fk_posts_user_id",
        },
        {
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
          onDelete: "cascade",
          onUpdate: "cascade",
        }
      ),
    ];

    const result = consolidateCreateTableWithConstraints(operations);

    expect(result).toHaveLength(2);

    // create_table should NOT have foreign key constraints
    expect(result[0]).toMatchObject({
      type: "create_table",
      table: "posts",
    });
    expect(result[0]).not.toHaveProperty("constraints.foreignKeys");

    // Foreign key constraint should remain separate
    expect(result[1]).toMatchObject({
      type: "create_foreign_key_constraint",
      table: "posts",
      name: "fk_posts_user_id",
    });
  });

  it("should consolidate primary key and unique constraints but NOT foreign keys", () => {
    const operations: Operation[] = [
      ops.createTable("orders", {
        id: { type: "uuid" },
        user_id: { type: "uuid" },
        order_number: { type: "text" },
      }),
      ops.createPrimaryKeyConstraint({
        table: "orders",
        name: "pk_orders_id",
        columns: ["id"],
      }),
      ops.createUniqueConstraint({
        table: "orders",
        name: "uq_orders_number",
        columns: ["order_number"],
      }),
      ops.createForeignKeyConstraint(
        {
          table: "orders",
          name: "fk_orders_user_id",
        },
        {
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
          onDelete: "cascade",
        }
      ),
    ];

    const result = consolidateCreateTableWithConstraints(operations);

    expect(result).toHaveLength(2);

    // create_table with primary key and unique constraints only
    expect(result[0]).toMatchObject({
      type: "create_table",
      table: "orders",
      constraints: {
        primaryKey: {
          name: "pk_orders_id",
          columns: ["id"],
        },
        unique: [
          {
            name: "uq_orders_number",
            columns: ["order_number"],
          },
        ],
      },
    });
    expect(result[0]).not.toHaveProperty("constraints.foreignKeys");

    // Foreign key constraint should remain separate
    expect(result[1]).toMatchObject({
      type: "create_foreign_key_constraint",
      table: "orders",
      name: "fk_orders_user_id",
    });
  });

  it("should not consolidate constraints for different tables", () => {
    const operations: Operation[] = [
      ops.createTable("users", {
        id: { type: "uuid" },
      }),
      ops.createTable("posts", {
        id: { type: "uuid" },
        user_id: { type: "uuid" },
      }),
      ops.createPrimaryKeyConstraint({
        table: "users",
        name: "pk_users_id",
        columns: ["id"],
      }),
      ops.createPrimaryKeyConstraint({
        table: "posts",
        name: "pk_posts_id",
        columns: ["id"],
      }),
    ];

    const result = consolidateCreateTableWithConstraints(operations);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: "create_table",
      table: "users",
      constraints: {
        primaryKey: {
          name: "pk_users_id",
          columns: ["id"],
        },
      },
    });
    expect(result[1]).toMatchObject({
      type: "create_table",
      table: "posts",
      constraints: {
        primaryKey: {
          name: "pk_posts_id",
          columns: ["id"],
        },
      },
    });
  });

  it("should preserve non-consolidatable operations", () => {
    const operations: Operation[] = [
      ops.createTable("users", {
        id: { type: "uuid" },
      }),
      ops.addColumn(
        { table: "existing_table", column: "new_col" },
        { type: "text" }
      ),
      ops.createPrimaryKeyConstraint({
        table: "existing_table", // Different table, should not be consolidated
        name: "pk_existing_id",
        columns: ["id"],
      }),
      ops.createPrimaryKeyConstraint({
        table: "users",
        name: "pk_users_id",
        columns: ["id"],
      }),
    ];

    const result = consolidateCreateTableWithConstraints(operations);

    expect(result).toHaveLength(3);

    // Consolidated create_table
    expect(result[0]).toMatchObject({
      type: "create_table",
      table: "users",
      constraints: {
        primaryKey: {
          name: "pk_users_id",
          columns: ["id"],
        },
      },
    });

    // Preserved add_column
    expect(result[1]).toMatchObject({
      type: "add_column",
      table: "existing_table",
    });

    // Non-consolidated constraint (different table)
    expect(result[2]).toMatchObject({
      type: "create_primary_key_constraint",
      table: "existing_table",
    });
  });

  it("should handle create_table operation without constraints", () => {
    const operations: Operation[] = [
      ops.createTable("simple_table", {
        id: { type: "uuid" },
        name: { type: "text" },
      }),
    ];

    const result = consolidateCreateTableWithConstraints(operations);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "create_table",
      table: "simple_table",
      columns: {
        id: { type: "uuid" },
        name: { type: "text" },
      },
    });
    expect(result[0]).not.toHaveProperty("constraints");
  });
});
