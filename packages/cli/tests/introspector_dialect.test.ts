import { describe, it, expect } from "vitest";
import { applyTable, dropTablesForDialect, setupTestDB } from "./helper";
import { column, defineTable } from "../src";
import { getIntrospector } from "../src/introspector";
import { fs } from "memfs";
import { FSPromiseAPIs } from "../src/commands/common";

const { client, dialect, database } = await setupTestDB();
const baseDeps = { client, fs: fs.promises as unknown as FSPromiseAPIs };
const introspector = getIntrospector(client);
const dialectName = dialect.getName();
const isMysqlLike = dialectName === "mysql" || dialectName === "mariadb";
const textTypeUnique = isMysqlLike ? "varchar(255)" : "text";
const schemaName = isMysqlLike ? "test" : "public";
const booleanDefault = isMysqlLike ? "1" : "true";

describe(`${dialectName} introspector driver`, () => {
  it("should introspect table columns correctly", async () => {
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

  it("should introspect indexes correctly", async () => {
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable(
          "test_table_with_indexes",
          {
            id: column("char(36)", { primaryKey: true }),
            email: column(textTypeUnique),
            alias: column(textTypeUnique, { unique: true }),
            name: column(textTypeUnique),
            age: column("integer"),
          },
          (t) => [
            t.index(["email"]),
            t.index(["name", "age"], { unique: true }),
          ],
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
      ]),
    );

    await dropTablesForDialect({
      client,
      tableNames: ["test_table_with_indexes"],
    });
  });

  it.skipIf(dialectName === "sqlite")("should introspect constraints correctly", async () => {
    const usersTable = defineTable("users", {
      id: column("char(36)", { primaryKey: true }),
      email: column(textTypeUnique, { unique: true }),
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
            title: column(textTypeUnique),
          },
          (t) => [
            t.reference("user_id", usersTable, "id", {
              onDelete: "cascade",
              onUpdate: "cascade",
              name: "fk_user",
            }),
            t.unique(["user_id", "title"], { name: "unique_title_per_user" }),
          ],
        ),
      ],
    });

    const { constraints } = await introspector.introspect(deps.config);
    const primaryKeyName = isMysqlLike ? "PRIMARY" : "posts_id_primary_key";
    const usersKeyName = isMysqlLike ? "PRIMARY" : "users_id_primary_key";
    const metadata = isMysqlLike
      ? {}
      : {
          on_delete: null,
          on_update: null,
          referenced_columns: null,
          referenced_table: null,
        };

    expect(constraints).toEqual({
      primaryKey: [
        {
          name: primaryKeyName,
          ...metadata,
          schema: schemaName,
          table: "posts",
          type: "PRIMARY KEY",
          columns: ["id"],
        },
        {
          name: usersKeyName,
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
  });
});
