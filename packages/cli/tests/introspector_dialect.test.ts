import { describe, it, expect, vi } from "vitest";
import { sql } from "kysely";
import { setupTable, setupTestDB } from "./helper";
import { column, defineTable } from "../src";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { client, dialect, database } = await setupTestDB();
const dialectName = dialect.getName();

describe(`${dialectName} introspector driver`, async () => {
  const introspector = dialect.createIntrospectionDriver(client);

  it.skip("should introspect table columns correctly", async () => {
    await using db = client.getDB();

    // テストテーブルを作成
    await sql`
      CREATE TABLE public.test_table (
        id uuid PRIMARY KEY,
        name varchar(255) NOT NULL,
        age integer DEFAULT 0,
        is_active boolean DEFAULT true
      )
    `.execute(db);

    const { tables } = await introspector.introspect();
    expect(tables).toEqual([
      {
        schema: "public",
        table: "test_table",
        name: "id",
        default: null,
        characterMaximumLength: null,
      },
      {
        schema: "public",
        table: "test_table",
        name: "name",
        default: null,
        characterMaximumLength: 255,
      },
      {
        schema: "public",
        table: "test_table",
        name: "age",
        default: "0",
        characterMaximumLength: null,
      },
      {
        schema: "public",
        table: "test_table",
        name: "is_active",
        default: "true",
        characterMaximumLength: null,
      },
    ]);

    await sql`DROP TABLE public.test_table`.execute(db);
  });

  it("should introspect indexes correctly", async () => {
    await setupTable({ client, database }, [
      defineTable(
        "test_table_with_indexes",
        {
          id: column("uuid", { primaryKey: true }),
          email: column("text"),
          alias: column("text", { unique: true }),
          name: column("text"),
          age: column("integer"),
        },
        (t) => [t.index(["email"]), t.index(["name", "age"], { unique: true })]
      ),
    ]);

    const { indexes } = await introspector.introspect();
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

  it.skip("should introspect constraints correctly", async () => {
    await using db = client.getDB();

    await sql`
      CREATE TABLE public.users (
        id uuid PRIMARY KEY,
        email text UNIQUE,
        username text
      )
    `.execute(db);

    await sql`
      CREATE TABLE public.posts (
        id uuid PRIMARY KEY,
        user_id uuid,
        title text,
        CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT unique_title_per_user UNIQUE (user_id, title)
      )
    `.execute(db);

    const { constraints } = await introspector.introspect();
    expect(constraints).toEqual({
      primaryKey: [
        {
          name: "posts_pkey",
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
          name: "users_pkey",
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
          name: "users_email_key",
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

    await sql`DROP TABLE public.posts, public.users`.execute(db);
  });
});
