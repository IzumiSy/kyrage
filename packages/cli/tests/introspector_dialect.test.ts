import { describe, expect } from "vitest";
import { applyTable, dropTablesForDialect } from "./helper";
import { column, defineTable } from "../src";
import { databaseTest as it, testForDialects } from "./fixtures";
import { executeGenerate } from "../src/commands/generate";
import { vol } from "memfs";

const constraintTest = testForDialects(
  "postgres",
  "cockroachdb",
  "mysql",
  "mariadb"
);

describe("introspector driver", () => {
  it("should introspect table columns correctly", async ({
    testDB,
    expectations,
  }) => {
    const { client, database, baseDeps, introspector } = testDB;
    const { schema: schemaName, booleanDefault } = expectations;
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable("test_table", {
          id: column("char(36)", { primaryKey: true }),
          name: column("varchar(255)", { notNull: true }),
          age: column("bigint", { defaultSql: "0" }),
          is_active: column("boolean", { defaultSql: "true" }),
        }),
      ],
    });

    const { tables } = await introspector.introspect(deps.config);
    expect(tables).toEqual([
      {
        name: "test_table",
        schema: schemaName,
        columns: {
          id: expect.objectContaining({
            dataType: "char(36)",
            notNull: true,
            default: null,
            characterMaximumLength: 36,
          }),
          name: expect.objectContaining({
            dataType: "varchar(255)",
            notNull: true,
            default: null,
            characterMaximumLength: 255,
          }),
          age: expect.objectContaining({
            dataType: "bigint",
            notNull: false,
            default: "0",
            characterMaximumLength: null,
          }),
          is_active: expect.objectContaining({
            dataType: "boolean",
            notNull: false,
            default: booleanDefault,
            characterMaximumLength: null,
          }),
        },
      },
    ]);

    await dropTablesForDialect({ client, tableNames: ["test_table"] });
  });

  testForDialects("postgres", "cockroachdb")(
    "should preserve unbounded varchar and bounded string lengths when regenerating",
    async ({ testDB, expectations }) => {
      const { client, database, baseDeps, introspector } = testDB;
      const tableName = "test_string_lengths";
      const deps = await applyTable(baseDeps, {
        database,
        tables: [
          defineTable(tableName, {
            // Keep CockroachDB's implicit rowid primary key out of this type regression.
            id: column("char(36)", { primaryKey: true }),
            unbounded: column("varchar"),
            bounded: column("varchar(255)"),
            fixed: column("char(36)"),
          }),
        ],
      });

      const { tables } = await introspector.introspect(deps.config);
      expect(tables).toEqual([
        {
          name: tableName,
          schema: expectations.schema,
          columns: {
            id: expect.objectContaining({
              dataType: "char(36)",
              characterMaximumLength: 36,
              notNull: true,
            }),
            unbounded: expect.objectContaining({
              dataType: "varchar",
              characterMaximumLength: null,
            }),
            bounded: expect.objectContaining({
              dataType: "varchar(255)",
              characterMaximumLength: 255,
            }),
            fixed: expect.objectContaining({
              dataType: "char(36)",
              characterMaximumLength: 36,
            }),
          },
        },
      ]);
      const before = vol.toJSON();
      await executeGenerate(deps, { ignorePending: false, dev: false });
      expect(vol.toJSON()).toEqual(before);
      await dropTablesForDialect({ client, tableNames: [tableName] });
    }
  );

  it("should introspect indexes correctly", async ({ testDB }) => {
    const { client, database, baseDeps, introspector } = testDB;
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable(
          "test_table_with_indexes",
          {
            id: column("char(36)", { primaryKey: true }),
            email: column("varchar(255)"),
            alias: column("varchar(255)", { unique: true }),
            name: column("varchar(255)"),
            age: column("integer"),
          },
          (t) => [
            t.index(["email"]),
            t.index(["name", "age"], { unique: true }),
          ]
        ),
      ],
    });

    const { indexes } = await introspector.introspect(deps.config);
    expect(indexes).toHaveLength(2);
    expect(indexes).toEqual(
      expect.arrayContaining([
        {
          table: "test_table_with_indexes",
          name: "idx_test_table_with_indexes_email",
          columns: ["email"],
          unique: false,
        },
        {
          table: "test_table_with_indexes",
          name: "idx_test_table_with_indexes_name_age",
          columns: ["name", "age"],
          unique: true,
        },
      ])
    );

    await dropTablesForDialect({
      client,
      tableNames: ["test_table_with_indexes"],
    });
  });

  constraintTest(
    "should introspect constraints correctly",
    async ({ testDB, expectations }) => {
      const { client, database, baseDeps, introspector } = testDB;
      const {
        schema: schemaName,
        primaryKeyName,
        constraintMetadata: metadata,
      } = expectations;
      const usersTable = defineTable("users", {
        id: column("char(36)", { primaryKey: true }),
        email: column("varchar(255)", { unique: true }),
        username: column("text"),
      });
      const deps = await applyTable(baseDeps, {
        database,
        tables: [
          usersTable,
          defineTable(
            "posts",
            {
              id: column("char(36)", { primaryKey: true }),
              user_id: column("char(36)"),
              title: column("varchar(255)"),
            },
            (t) => [
              t.reference("user_id", usersTable, "id", {
                onDelete: "cascade",
                onUpdate: "cascade",
                name: "fk_user",
              }),
              t.unique(["user_id", "title"], { name: "unique_title_per_user" }),
            ]
          ),
        ],
      });

      const { constraints } = await introspector.introspect(deps.config);
      expect(constraints).toEqual({
        primaryKey: [
          {
            name: primaryKeyName("posts_id_primary_key"),
            ...metadata,
            schema: schemaName,
            table: "posts",
            type: "PRIMARY KEY",
            columns: ["id"],
          },
          {
            name: primaryKeyName("users_id_primary_key"),
            ...metadata,
            schema: schemaName,
            table: "users",
            type: "PRIMARY KEY",
            columns: ["id"],
          },
        ],
        unique: [
          {
            name: "unique_title_per_user",
            ...metadata,
            schema: schemaName,
            table: "posts",
            type: "UNIQUE",
            columns: ["user_id", "title"],
          },
          {
            name: "users_email_unique",
            ...metadata,
            schema: schemaName,
            table: "users",
            type: "UNIQUE",
            columns: ["email"],
          },
        ],
        foreignKey: [
          {
            schema: schemaName,
            table: "posts",
            name: "fk_user",
            type: "FOREIGN KEY",
            columns: ["user_id"],
            referencedTable: "users",
            referencedColumns: ["id"],
            onDelete: "cascade",
            onUpdate: "cascade",
          },
        ],
      });

      await dropTablesForDialect({ client, tableNames: ["posts", "users"] });
    }
  );
});
