import { describe, expect } from "vitest";
import { DEFAULT_MIGRATION_TABLE } from "kysely";
import {
  applyTable,
  defineConfigForTest,
  dropTablesForDialect,
} from "./helper";
import { column, defineTable } from "../src";
import { vol } from "memfs";
import { executeGenerate } from "../src/commands/generate";
import { executeApply } from "../src/commands/apply";
import { getAllMigrations, migrationDirName } from "../src/migration";
import { defaultConsolaLogger } from "../src/logger";
import { testForDialects } from "./fixtures";

const it = testForDialects("postgres", "cockroachdb", "mysql", "mariadb");
const mysqlIt = testForDialects("mysql", "mariadb");

describe("non-sqlite introspector constraints", () => {
  it("should introspect constraints with explicit constraint names", async ({
    testDB,
    expectations,
  }) => {
    const { client, database, baseDeps, introspector } = testDB;
    const { schema: schemaName, primaryKeyName } = expectations;
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

    expect(constraints.primaryKey).toHaveLength(2);
    expect(constraints.primaryKey).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: primaryKeyName("posts_id_primary_key"),
          schema: schemaName,
          table: "posts",
          type: "PRIMARY KEY",
          columns: ["id"],
        }),
        expect.objectContaining({
          name: primaryKeyName("users_id_primary_key"),
          schema: schemaName,
          table: "users",
          type: "PRIMARY KEY",
          columns: ["id"],
        }),
      ])
    );

    expect(constraints.unique).toHaveLength(2);
    expect(constraints.unique).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "unique_title_per_user",
          schema: schemaName,
          table: "posts",
          type: "UNIQUE",
          columns: ["user_id", "title"],
        }),
        expect.objectContaining({
          name: "users_email_unique",
          schema: schemaName,
          table: "users",
          type: "UNIQUE",
          columns: ["email"],
        }),
      ])
    );

    expect(constraints.foreignKey).toHaveLength(1);
    expect(constraints.foreignKey).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema: schemaName,
          table: "posts",
          name: "fk_user",
          type: "FOREIGN KEY",
          columns: ["user_id"],
          referencedTable: "users",
          referencedColumns: ["id"],
          onDelete: "cascade",
          onUpdate: "cascade",
        }),
      ])
    );

    await dropTablesForDialect({ client, tableNames: ["posts", "users"] });
  });

  mysqlIt(
    "should apply constraint, index, and column changes and then regenerate cleanly",
    async ({ testDB }) => {
      const { client, database, baseDeps, introspector } = testDB;
      const users = defineTable("users", {
        id: column("char(36)", { primaryKey: true }),
      });
      await applyTable(baseDeps, {
        database,
        tables: [
          users,
          defineTable(
            "orders",
            {
              id: column("integer"),
              owner_id: column("char(36)"),
              code: column("varchar(255)", { unique: true }),
              quantity: column("integer", {
                notNull: true,
                defaultSql: "(1 + 2)",
              }),
            },
            (t) => [
              t.primaryKey(["id", "owner_id"], { name: "custom_orders_pk" }),
              t.reference("owner_id", users, "id", { name: "fk_orders_owner" }),
              t.index(["quantity"]),
            ]
          ),
        ],
      });

      const deps = await applyTable(baseDeps, {
        database,
        tables: [
          users,
          defineTable(
            "orders",
            {
              id: column("integer"),
              owner_id: column("char(36)"),
              code: column("varchar(255)"),
              quantity: column("bigint"),
            },
            (t) => [t.primaryKey(["id", "code"], { name: "changed_orders_pk" })]
          ),
        ],
      });
      const snapshot = await introspector.introspect(deps.config);
      expect(snapshot.constraints.foreignKey).toEqual([]);
      expect(snapshot.constraints.unique).toEqual([]);
      expect(snapshot.constraints.primaryKey).toContainEqual(
        expect.objectContaining({
          table: "orders",
          name: "PRIMARY",
          columns: ["id", "code"],
        })
      );
      expect(
        snapshot.tables.find((table) => table.name === "orders")?.columns
          .quantity
      ).toEqual(
        expect.objectContaining({ dataType: "bigint", notNull: false })
      );
      await using db = client.getDB();
      await db.insertInto("orders").values({ id: 1, code: "test" }).execute();
      const row = await db
        .selectFrom("orders")
        .select("quantity")
        .executeTakeFirstOrThrow();
      expect(Number(row.quantity)).toBe(3);

      const before = vol.toJSON();
      await executeGenerate(deps, { ignorePending: false, dev: false });
      expect(vol.toJSON()).toEqual(before);
      await dropTablesForDialect({ client, tableNames: ["orders", "users"] });
    }
  );

  mysqlIt(
    "should reject alterations that would discard auto-increment",
    async ({ testDB }) => {
      const { client, database, baseDeps } = testDB;
      await using db = client.getDB();
      await db.schema
        .createTable("legacy")
        .addColumn("id", "integer", (col) => col.autoIncrement().primaryKey())
        .execute();
      const before = vol.toJSON();
      await expect(
        executeGenerate(
          {
            ...baseDeps,
            logger: defaultConsolaLogger,
            config: defineConfigForTest({
              database,
              tables: [
                defineTable("legacy", {
                  id: column("bigint", { primaryKey: true }),
                }),
              ],
            }),
          },
          { ignorePending: false, dev: false }
        )
      ).rejects.toThrow("auto_increment");
      expect(vol.toJSON()).toEqual(before);
      await dropTablesForDialect({ client, tableNames: ["legacy"] });
    }
  );

  mysqlIt(
    "should reject an unsafe migration before any earlier column addition executes",
    async ({ testDB }) => {
      const { client, database, baseDeps } = testDB;
      const tableName = "live_validation";
      await using db = client.getDB();
      await db.schema
        .createTable(tableName)
        .addColumn("id", "integer", (col) => col.autoIncrement().primaryKey())
        .execute();
      let pendingPath: string | undefined;
      let appliedId: string | undefined;
      try {
        const existingIds = new Set(
          (await getAllMigrations(baseDeps)).map((migration) => migration.id)
        );
        let id = String(Date.now());
        while (existingIds.has(id)) id = String(Number(id) + 1);
        await baseDeps.fs.mkdir(migrationDirName, { recursive: true });
        const path = `${migrationDirName}/${id}.json`;
        await baseDeps.fs.writeFile(
          path,
          JSON.stringify({
            id,
            version: "1",
            diff: {
              operations: [
                {
                  type: "add_column",
                  table: tableName,
                  column: "before_failure",
                  attributes: { type: "integer" },
                },
                {
                  type: "alter_column",
                  table: tableName,
                  column: "id",
                  before: { type: "integer", notNull: true },
                  after: { type: "bigint", notNull: true },
                },
              ],
            },
          }),
          "utf-8"
        );
        pendingPath = path;
        await expect(
          executeApply(
            {
              ...baseDeps,
              logger: defaultConsolaLogger,
              config: defineConfigForTest({
                database,
                tables: [
                  defineTable(tableName, {
                    id: column("integer", { primaryKey: true }),
                  }),
                ],
              }),
            },
            { plan: false, pretty: false }
          ).then(() => {
            appliedId = id;
          })
        ).rejects.toThrow("auto_increment");
        const table = (await db.introspection.getTables()).find(
          (candidate) => candidate.name === tableName
        );
        expect(table?.columns.map((col) => col.name)).toEqual(["id"]);
      } finally {
        if (appliedId)
          await db
            .deleteFrom(DEFAULT_MIGRATION_TABLE)
            .where("name", "=", appliedId)
            .execute();
        if (pendingPath) await baseDeps.fs.unlink(pendingPath);
        await dropTablesForDialect({ client, tableNames: [tableName] });
      }
    }
  );

  mysqlIt(
    "should reject newly added auto-increment metadata after migration generation",
    async ({ testDB }) => {
      const { client, database, baseDeps, introspector } = testDB;
      const tableName = "validation_drift";
      await using db = client.getDB();
      await db.schema
        .createTable(tableName)
        .addColumn("id", "integer", (col) => col.primaryKey())
        .execute();
      const existingIds = new Set(
        (await getAllMigrations(baseDeps)).map((migration) => migration.id)
      );
      let pendingIds: ReadonlyArray<string> = [];
      let appliedId: string | undefined;
      try {
        const deps = {
          ...baseDeps,
          logger: defaultConsolaLogger,
          config: defineConfigForTest({
            database,
            tables: [
              defineTable(tableName, {
                id: column("bigint", { primaryKey: true }),
              }),
            ],
          }),
        };
        await executeGenerate(deps, { ignorePending: false, dev: false });
        const generated = (await getAllMigrations(baseDeps)).filter(
          (migration) => !existingIds.has(migration.id)
        );
        pendingIds = generated.map((migration) => migration.id);
        expect(generated).toHaveLength(1);
        expect(generated[0].diff.operations).toEqual([
          expect.objectContaining({
            type: "alter_column",
            table: tableName,
            column: "id",
            before: expect.objectContaining({ type: "integer" }),
            after: expect.objectContaining({ type: "bigint" }),
          }),
        ]);
        await db.schema
          .alterTable(tableName)
          .modifyColumn("id", "integer", (col) => col.notNull().autoIncrement())
          .execute();
        await expect(
          executeApply(deps, { plan: false, pretty: false }).then(() => {
            appliedId = generated[0].id;
          })
        ).rejects.toThrow("auto_increment");
        const snapshot = await introspector.introspect(deps.config);
        expect(
          snapshot.tables.find((table) => table.name === tableName)?.columns.id
            .dataType
        ).toBe("integer");
      } finally {
        if (appliedId)
          await db
            .deleteFrom(DEFAULT_MIGRATION_TABLE)
            .where("name", "=", appliedId)
            .execute();
        await Promise.all(
          pendingIds.map((id) =>
            baseDeps.fs.unlink(`${migrationDirName}/${id}.json`)
          )
        );
        await dropTablesForDialect({ client, tableNames: [tableName] });
      }
    }
  );
});
