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

describe(`${dialectName} introspector driver`, async () => {
  it("should introspect table columns correctly", async () => {
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable("test_table", {
          id: column("uuid", { primaryKey: true }),
          name: column("varchar(255)", { notNull: true }),
          age: column("int8", { defaultSql: "0" }),
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
            dataType: "uuid",
            notNull: true,
            default: null,
            characterMaximumLength: null,
          }),
          name: expect.objectContaining({
            dataType: "varchar",
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

    await dropTablesForDialect({
      client,
      tableNames: ["test_table"],
    });
  });

  it("should introspect indexes correctly", async () => {
    const deps = await applyTable(baseDeps, {
      database,
      tables: [
        defineTable(
          "test_table_with_indexes",
          {
            id: column("uuid", { primaryKey: true }),
            email: column("text"),
            alias: column("text", { unique: true }),
            name: column("text"),
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
});
