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
const isSQLite = dialect.getName() === "sqlite";

describe.skipIf(!isSQLite)("sqlite introspector constraints", () => {
  it("should introspect constraints with sqlite naming behavior", async () => {
    const usersTable = defineTable("users", {
      id: column("uuid", { primaryKey: true }),
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
            id: column("uuid", { primaryKey: true }),
            user_id: column("uuid"),
            title: column("text"),
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

    expect(constraints.primaryKey).toHaveLength(2);
    expect(constraints.primaryKey).toEqual(
      expect.arrayContaining([
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
      ]),
    );

    expect(constraints.unique).toHaveLength(2);
    expect(constraints.unique).toEqual(
      expect.arrayContaining([
        {
          name: "uq_posts_user_id_title",
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
      ]),
    );

    expect(constraints.foreignKey).toHaveLength(1);
    expect(constraints.foreignKey).toEqual(
      expect.arrayContaining([
        {
          schema: "public",
          table: "posts",
          name: "fk_user_id",
          type: "FOREIGN KEY",
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      ]),
    );

    await using db = client.getDB();
    await sql`DROP TABLE posts`.execute(db);
    await sql`DROP TABLE users`.execute(db);
  });
});
