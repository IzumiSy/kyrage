import { describe, it, expect } from "vitest";
import { sql } from "kysely";
import { applyTable, setupTestDB } from "./helper";
import { column, defineTable } from "../src";
import { getIntrospector } from "../src/introspector";
import { fs } from "memfs";
import { FSPromiseAPIs } from "../src/commands/common";

const { client, dialect, database } = await setupTestDB();
const baseDeps = { client, fs: fs.promises as unknown as FSPromiseAPIs };
const introspector = getIntrospector(client);
const dialectName = dialect.getName();

describe(`${dialectName} introspector driver`, async () => {
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
        schema: "public",
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
            default: "true",
            characterMaximumLength: null,
          }),
        },
      },
    ]);

    await using db = client.getDB();
    await sql`DROP TABLE public.test_table`.execute(db);
  });

  it("should introspect indexes correctly", async () => {
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable(
          "test_table_with_indexes",
          {
            id: column("char(36)", { primaryKey: true }),
            email: column("text"),
            alias: column("text", { unique: true }),
            name: column("text"),
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
    expect(indexes).toEqual([
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
    ]);

    await using db = client.getDB();
    await sql`DROP TABLE public.test_table_with_indexes`.execute(db);
  });

  it("should introspect constraints correctly", async () => {
    const usersTable = defineTable("users", {
      id: column("char(36)", { primaryKey: true }),
      email: column("text", { unique: true }),
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
            title: column("text"),
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
          name: "posts_id_primary_key",
          on_delete: null,
          on_update: null,
          referenced_columns: null,
          referenced_table: null,
          schema: "public",
          table: "posts",
          type: "PRIMARY KEY",
          columns: ["id"],
        },
        {
          name: "users_id_primary_key",
          on_delete: null,
          on_update: null,
          referenced_columns: null,
          referenced_table: null,
          schema: "public",
          table: "users",
          type: "PRIMARY KEY",
          columns: ["id"],
        },
      ],
      unique: [
        {
          name: "unique_title_per_user",
          on_delete: null,
          on_update: null,
          referenced_columns: null,
          referenced_table: null,
          schema: "public",
          table: "posts",
          type: "UNIQUE",
          columns: ["user_id", "title"],
        },
        {
          name: "users_email_unique",
          on_delete: null,
          on_update: null,
          referenced_columns: null,
          referenced_table: null,
          schema: "public",
          table: "users",
          type: "UNIQUE",
          columns: ["email"],
        },
      ],
      foreignKey: [
        {
          schema: "public",
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

    await using db = client.getDB();
    await sql`DROP TABLE public.posts, public.users`.execute(db);
  });
});
