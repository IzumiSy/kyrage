import { describe, expect, it, vi } from "vitest";
import { getClient } from "../client";
import { column, defineConfig, defineTable } from "../config/builder";
import { configSchema } from "../config/loader";
import { diffSchema } from "../diff";
import { executeOperation, type Operation } from "../operations/executor";
import type { SchemaSnapshot } from "../operations/shared/types";
import { convertMysqlTypeName, doMysqlIntrospect } from "./mysql";

/** Creates a connection-free SQL collector using the actual target dialect. */
const createPlanDB = (dialect: "mysql" | "mariadb" | "postgres") =>
  getClient({
    database: {
      dialect,
      connectionString: `${dialect}://user:password@localhost/test`,
    },
  }).getDB({ plan: true });

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  indexes: [],
  primaryKeyConstraints: [],
  uniqueConstraints: [],
  foreignKeyConstraints: [],
};

describe.each(["mysql", "mariadb"] as const)(
  "%s schema semantics",
  (dialect) => {
    it("normalizes omitted type parameters without hiding precision changes", () => {
      const current = {
        ...emptySnapshot,
        tables: [
          {
            name: "types",
            columns: {
              amount: { type: "decimal(10, 0)" },
              token: { type: "binary(1)" },
            },
          },
        ],
      };
      const ideal = {
        ...emptySnapshot,
        tables: [
          {
            name: "types",
            columns: {
              amount: { type: "decimal" },
              token: { type: "binary" },
            },
          },
        ],
      };
      expect(diffSchema({ current, ideal, dialect }).operations).toEqual([]);
      expect(
        diffSchema({
          current,
          ideal: {
            ...ideal,
            tables: [
              {
                name: "types",
                columns: {
                  amount: { type: "numeric(12, 2)" },
                  token: { type: "binary(16)" },
                },
              },
            ],
          },
          dialect,
        }).operations,
      ).toHaveLength(2);
    });

    it("ignores primary-key names but detects changed columns and removed keys", () => {
      const current = {
        ...emptySnapshot,
        primaryKeyConstraints: [
          {
            table: "orders",
            name: "PRIMARY",
            columns: ["customer_id", "product_id"],
          },
        ],
      };
      const ideal = {
        ...emptySnapshot,
        primaryKeyConstraints: [
          {
            table: "orders",
            name: "custom_pk",
            columns: ["customer_id", "product_id"],
          },
        ],
      };
      expect(diffSchema({ current, ideal, dialect }).operations).toEqual([]);
      expect(diffSchema({ current, ideal }).operations).toHaveLength(2);
      expect(
        diffSchema({
          current,
          ideal: {
            ...ideal,
            primaryKeyConstraints: [
              { ...ideal.primaryKeyConstraints[0], columns: ["product_id"] },
            ],
          },
          dialect,
        }).operations,
      ).toEqual([
        expect.objectContaining({
          type: "drop_primary_key_constraint",
          name: "PRIMARY",
        }),
        expect.objectContaining({
          type: "create_primary_key_constraint",
          columns: ["product_id"],
        }),
      ]);
      expect(
        diffSchema({ current, ideal: emptySnapshot, dialect }).operations,
      ).toEqual([
        {
          type: "drop_primary_key_constraint",
          table: "orders",
          name: "PRIMARY",
        },
      ]);
    });

    it("treats omitted, RESTRICT, and NO ACTION foreign-key actions as equivalent", () => {
      const fk = {
        table: "posts",
        name: "fk_user",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
      };
      const current = {
        ...emptySnapshot,
        foreignKeyConstraints: [
          {
            ...fk,
            onDelete: "restrict" as const,
            onUpdate: "restrict" as const,
          },
        ],
      };
      for (const action of [undefined, "restrict", "no action"] as const) {
        const ideal = {
          ...emptySnapshot,
          foreignKeyConstraints: [
            { ...fk, onDelete: action, onUpdate: action },
          ],
        };
        expect(diffSchema({ current, ideal, dialect }).operations).toEqual([]);
      }
      expect(
        diffSchema({
          current,
          ideal: {
            ...emptySnapshot,
            foreignKeyConstraints: [{ ...fk, onDelete: "cascade" }],
          },
          dialect,
        }).operations.map((op) => op.type),
      ).toEqual([
        "drop_foreign_key_constraint",
        "create_foreign_key_constraint",
      ]);
    });

    it("collects valid drops and MODIFY COLUMN SQL with defaults and escaped identifiers", async () => {
      await using db = createPlanDB(dialect);
      const operations: ReadonlyArray<Operation> = [
        {
          type: "drop_primary_key_constraint",
          table: "orders",
          name: "custom_pk",
        },
        {
          type: "drop_foreign_key_constraint",
          table: "orders",
          name: "fk`user",
        },
        { type: "drop_unique_constraint", table: "orders", name: "uq_order" },
        { type: "drop_index", table: "orders", name: "idx_order" },
        {
          type: "alter_column",
          table: "orders",
          column: "quantity",
          before: { type: "integer", notNull: false, defaultSql: "3" },
          after: { type: "bigint", notNull: true },
        },
        {
          type: "alter_column",
          table: "orders",
          column: "quantity",
          before: { type: "bigint", notNull: true, defaultSql: "3" },
          after: { type: "bigint", notNull: false, defaultSql: "5" },
        },
      ];
      for (const operation of operations) await executeOperation(db, operation);
      expect(db.getPlannedQueries().map((query) => query.sql)).toEqual([
        "alter table `orders` drop primary key",
        "alter table `orders` drop foreign key `fk``user`",
        "alter table `orders` drop index `uq_order`",
        "drop index `idx_order` on `orders`",
        "alter table `orders` modify column `quantity` bigint default 3 not null",
        "alter table `orders` modify column `quantity` bigint default 5",
      ]);
      await executeOperation(db, {
        type: "alter_column",
        table: "orders",
        column: "token",
        before: { type: "binary(16)", defaultSql: "(uuid_to_bin(uuid()))" },
        after: { type: "binary(16)", notNull: true },
      });
      const planned = db.getPlannedQueries();
      expect(planned[planned.length - 1]?.sql).toBe(
        "alter table `orders` modify column `token` binary(16) default (uuid_to_bin(uuid())) not null",
      );
      await expect(
        executeOperation(db, {
          type: "alter_column",
          table: "orders",
          column: "id",
          before: {
            type: "integer",
            alterationBlockedReason: "auto_increment",
          },
          after: { type: "bigint" },
        }),
      ).rejects.toThrow("Cannot safely modify column: auto_increment");
      expect(() =>
        diffSchema({
          dialect,
          current: {
            ...emptySnapshot,
            tables: [
              {
                name: "orders",
                columns: {
                  id: {
                    type: "integer",
                    alterationBlockedReason: "auto_increment",
                  },
                },
              },
            ],
          },
          ideal: {
            ...emptySnapshot,
            tables: [{ name: "orders", columns: { id: { type: "bigint" } } }],
          },
        }),
      ).toThrow("Cannot safely modify column");
      await expect(
        executeOperation(db, {
          type: "alter_column",
          table: "orders",
          column: "quantity",
          before: { type: "integer" },
          after: { type: "integer; drop table orders" },
        }),
      ).rejects.toThrow("Unsupported data type");
    });
  },
);

it("leaves PostgreSQL constraint and column SQL unchanged", async () => {
  await using db = createPlanDB("postgres");
  await executeOperation(db, {
    type: "drop_primary_key_constraint",
    table: "orders",
    name: "pk_order",
  });
  await executeOperation(db, {
    type: "drop_foreign_key_constraint",
    table: "orders",
    name: "fk_user",
  });
  await executeOperation(db, {
    type: "drop_unique_constraint",
    table: "orders",
    name: "uq_order",
  });
  await executeOperation(db, {
    type: "drop_index",
    table: "orders",
    name: "idx_order",
  });
  await executeOperation(db, {
    type: "alter_column",
    table: "orders",
    column: "quantity",
    before: { type: "integer" },
    after: { type: "bigint", notNull: true },
  });
  expect(db.getPlannedQueries().map((query) => query.sql)).toEqual([
    'alter table "orders" drop constraint "pk_order"',
    'alter table "orders" drop constraint "fk_user"',
    'alter table "orders" drop constraint "uq_order"',
    'drop index "idx_order"',
    'alter table "orders" alter column "quantity" type bigint',
    'alter table "orders" alter column "quantity" set not null',
  ]);
});

it("preserves precision, binary lengths, and non-boolean tiny integers", () => {
  for (const [input, expected] of [
    ["tinyint(1)", "boolean"],
    ["tinyint", "tinyint"],
    ["tinyint(4)", "tinyint"],
    ["int(11)", "integer"],
    ["bigint(20)", "bigint"],
    ["decimal(10,2)", "decimal(10, 2)"],
    ["datetime(6)", "datetime(6)"],
    ["varbinary(32)", "varbinary(32)"],
    ["char(36)", "char(36)"],
  ])
    expect(convertMysqlTypeName(input)).toBe(expected);
});

it("groups ordered catalog rows without splitting comma-containing column names", async () => {
  const client = getClient({
    database: {
      dialect: "mysql",
      connectionString: "mysql://user:password@localhost/test",
    },
  });
  const fkRow = {
    schema_name: "test",
    table_name: "child",
    constraint_name: "fk_parent",
    constraint_type: "FOREIGN KEY",
    column_name: "parent,id",
    referenced_table: "parent",
    referenced_column: "id,part",
    on_delete: "RESTRICT",
    on_update: "NO ACTION",
  };
  const indexRow = {
    table_name: "child",
    index_name: "fk_parent",
    is_unique: 0,
    column_name: "parent,id",
  };
  const columns = [
    {
      table_schema: "test",
      table_name: "child",
      column_name: "amount",
      column_type: "decimal(10,2)",
      column_default: null,
      character_maximum_length: null,
      extra: "DEFAULT_GENERATED",
      column_comment: "",
      custom_collation: 0,
    },
    {
      table_schema: "test",
      table_name: "child",
      column_name: "id",
      column_type: "int",
      column_default: null,
      character_maximum_length: null,
      extra: "auto_increment",
      column_comment: "",
      custom_collation: 0,
    },
  ];
  vi.spyOn(client, "getDB").mockImplementation(() => {
    const db = createPlanDB("mysql");
    vi.spyOn(db.getExecutor(), "executeQuery")
      .mockResolvedValueOnce({ rows: columns })
      .mockResolvedValueOnce({
        rows: [indexRow, { ...indexRow, column_name: "tenant" }],
      })
      .mockResolvedValueOnce({
        rows: [
          fkRow,
          { ...fkRow, column_name: "tenant", referenced_column: "tenant" },
        ],
      });
    return db;
  });
  const parent = defineTable("parent", {
    "id,part": column("integer"),
    tenant: column("integer"),
  });
  const child = defineTable(
    "child",
    { "parent,id": column("integer"), tenant: column("integer") },
    (t) => [
      t.reference(["parent,id", "tenant"], parent, ["id,part", "tenant"], {
        name: "fk_parent",
      }),
    ],
  );
  const config = configSchema.parse(
    defineConfig({
      database: {
        dialect: "mysql",
        connectionString: "mysql://localhost/test",
      },
      tables: [parent, child],
    }),
  );
  const result = await doMysqlIntrospect(client)({ config });
  expect(result.tables[0].dataType).toBe("decimal(10, 2)");
  expect(result.tables[0].alterationBlockedReason).toBeUndefined();
  expect(result.tables[1].alterationBlockedReason).toBe("auto_increment");
  expect(result.indexes).toEqual([]);
  expect(result.constraints.foreignKey).toEqual([
    expect.objectContaining({
      columns: ["parent,id", "tenant"],
      referencedColumns: ["id,part", "tenant"],
    }),
  ]);
  const explicit = await doMysqlIntrospect(client)({
    config: {
      ...config,
      indexes: [
        {
          table: "child",
          name: "fk_parent",
          columns: ["parent,id", "tenant"],
          unique: false,
        },
      ],
    },
  });
  expect(explicit.indexes).toEqual([
    {
      table: "child",
      name: "fk_parent",
      columns: ["parent,id", "tenant"],
      unique: false,
    },
  ]);
  const removed = await doMysqlIntrospect(client)({
    config: { ...config, foreignKeyConstraints: [] },
  });
  expect(removed.indexes).toHaveLength(1);
});
