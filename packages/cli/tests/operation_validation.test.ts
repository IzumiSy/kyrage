import { expect, vi } from "vitest";
import { DEFAULT_MIGRATION_TABLE, sql } from "kysely";
import type { CommonDependencies } from "../src/commands/common";
import { executeApply } from "../src/commands/apply";
import { executeGenerate } from "../src/commands/generate";
import { column, defineTable } from "../src";
import { readMysqlColumnMetadata } from "../src/dialect/mysql-column-metadata";
import { nullLogger } from "../src/logger";
import {
  getAllMigrations,
  migrationDirName,
  migrationSchema,
} from "../src/migration";
import { executeOperation, type Operation } from "../src/operations/executor";
import { testForDialects } from "./fixtures";
import { defineConfigForTest } from "./helper";

const it = testForDialects("mysql", "mariadb");

/** Writes a validated migration source without executing any schema operations. */
const writeMigration = async (
  deps: Pick<CommonDependencies, "fs">,
  id: string,
  operations: ReadonlyArray<Operation>,
) => {
  const migration = migrationSchema.parse({
    id,
    version: "1",
    diff: { operations },
  });
  await deps.fs.mkdir(migrationDirName, { recursive: true });
  await deps.fs.writeFile(
    `${migrationDirName}/${id}.json`,
    JSON.stringify(migration),
    { encoding: "utf-8", flag: "wx" },
  );
};

/** Removes only the scenario's schema, migration history, and source files. */
const cleanupScenario = async (
  deps: Pick<CommonDependencies, "client" | "fs">,
  ids: ReadonlyArray<string>,
  tableNames: ReadonlyArray<string>,
) => {
  await using db = deps.client.getDB();
  const tables = await db.introspection.getTables({
    withInternalKyselyTables: true,
  });
  if (
    ids.length &&
    tables.some((table) => table.name === DEFAULT_MIGRATION_TABLE)
  ) {
    await db
      .deleteFrom(DEFAULT_MIGRATION_TABLE)
      .where("name", "in", [...ids])
      .execute();
  }
  for (const table of tableNames) {
    await db.schema.dropTable(table).ifExists().execute();
  }
  const files: ReadonlyArray<string> = await deps.fs
    .readdir(migrationDirName)
    .catch((error: unknown) => {
      if (
        error instanceof Object &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    });
  for (const id of ids) {
    if (files.includes(`${id}.json`)) {
      await deps.fs.unlink(`${migrationDirName}/${id}.json`);
    }
  }
};

it("plans and applies ordered creation and repeated modifications after an applied prefix", async ({
  testDB,
}) => {
  const { client, database, baseDeps } = testDB;
  const table = "validation_sequence";
  const createdTable = "validation_created";
  const logger = { ...nullLogger, stdout: vi.fn() };
  const deps = {
    ...baseDeps,
    logger,
    config: defineConfigForTest({
      database,
      tables: [
        defineTable(table, {
          id: column("integer", { primaryKey: true }),
          amount: column("integer", { defaultSql: "3" }),
        }),
      ],
    }),
  };
  let ids: ReadonlyArray<string> = [];
  try {
    await executeGenerate(deps, { ignorePending: false, dev: false });
    const [prefix] = await getAllMigrations(deps);
    expect(prefix).toBeDefined();
    ids = [
      prefix.id,
      ...[1, 2, 3].map((offset) => String(Number(prefix.id) + offset)),
    ];
    await executeApply(deps, { plan: false, pretty: false });

    await writeMigration(deps, ids[1], [
      {
        type: "create_table",
        table: createdTable,
        columns: { id: { type: "integer" } },
      },
      {
        type: "add_column",
        table,
        column: "added",
        attributes: { type: "integer" },
      },
      {
        type: "alter_column",
        table,
        column: "amount",
        before: { type: "integer", defaultSql: "3" },
        after: { type: "bigint", notNull: true },
      },
    ]);
    await writeMigration(deps, ids[2], [
      {
        type: "alter_column",
        table,
        column: "added",
        before: { type: "integer" },
        after: { type: "bigint" },
      },
      {
        type: "alter_column",
        table,
        column: "amount",
        before: { type: "bigint", notNull: true, defaultSql: "3" },
        after: { type: "bigint", notNull: false },
      },
      {
        type: "create_primary_key_constraint",
        table: createdTable,
        name: "created_pk",
        columns: ["id"],
      },
    ]);
    await writeMigration(deps, ids[3], [
      {
        type: "alter_column",
        table: createdTable,
        column: "id",
        before: { type: "integer", notNull: true },
        after: { type: "bigint", notNull: true },
      },
    ]);

    await executeApply(deps, { plan: true, pretty: false });
    expect(logger.stdout).toHaveBeenCalledWith(
      `alter table \`${table}\` modify column \`amount\` bigint default 3 not null`,
    );
    expect(logger.stdout).not.toHaveBeenCalledWith(
      expect.stringContaining(`create table \`${table}\``),
    );
    await using db = client.getDB();
    const plannedTables = await db.introspection.getTables();
    expect(
      plannedTables.some((candidate) => candidate.name === createdTable),
    ).toBe(false);
    expect(
      plannedTables
        .find((candidate) => candidate.name === table)
        ?.columns.map((col) => col.name),
    ).toEqual(["id", "amount"]);

    await executeApply(deps, { plan: false, pretty: false });
    const metadata = (await readMysqlColumnMetadata(db)).filter(
      (column) =>
        column.table_name === table || column.table_name === createdTable,
    );
    expect(metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: table,
          column_name: "amount",
          column_type: expect.stringMatching(/^bigint/),
          column_default: "3",
          extra: "",
        }),
        expect.objectContaining({
          table_name: table,
          column_name: "added",
          column_type: expect.stringMatching(/^bigint/),
          column_default: null,
          extra: "",
        }),
        expect.objectContaining({
          table_name: createdTable,
          column_name: "id",
          column_type: expect.stringMatching(/^bigint/),
          column_default: null,
          extra: "",
        }),
      ]),
    );
    const appliedTables = await db.introspection.getTables();
    expect(
      appliedTables
        .find((candidate) => candidate.name === createdTable)
        ?.columns.find((col) => col.name === "id")?.isNullable,
    ).toBe(false);
    await db.insertInto(table).values({ id: 1 }).execute();
    const row = await db
      .selectFrom(table)
      .select(["amount", "added"])
      .executeTakeFirstOrThrow();
    expect(Number(row.amount)).toBe(3);
    expect(row.added).toBeNull();

    const finalDeps = {
      ...deps,
      config: defineConfigForTest({
        database,
        tables: [
          defineTable(table, {
            id: column("integer", { primaryKey: true }),
            amount: column("bigint", { defaultSql: "3" }),
            added: column("bigint"),
          }),
          defineTable(createdTable, {
            id: column("bigint", { primaryKey: true }),
          }),
        ],
      }),
    };
    const beforeRegeneration = await getAllMigrations(deps);
    await executeGenerate(finalDeps, { ignorePending: false, dev: false });
    const afterRegeneration = await getAllMigrations(deps);
    ids = afterRegeneration.map((migration) => migration.id);
    expect(afterRegeneration).toEqual(beforeRegeneration);
  } finally {
    await cleanupScenario(baseDeps, ids, [createdTable, table]);
  }
});

it("rejects a later unsafe pending migration before earlier DDL and preserves live prefix metadata", async ({
  testDB,
}) => {
  const { client, database, baseDeps } = testDB;
  const table = "validation_unsafe";
  const ids = ["001_unsafe", "002_unsafe", "003_unsafe"];
  const logger = { ...nullLogger, stdout: vi.fn() };
  const deps = {
    ...baseDeps,
    logger,
    config: defineConfigForTest({
      database,
      tables: [
        defineTable(table, { id: column("bigint", { primaryKey: true }) }),
      ],
    }),
  };
  try {
    await writeMigration(deps, ids[0], [
      {
        type: "create_table_with_constraints",
        table,
        columns: { id: { type: "integer" } },
        constraints: { primaryKey: { name: "unsafe_pk", columns: ["id"] } },
      },
    ]);
    await executeApply(deps, { plan: false, pretty: false });
    await using db = client.getDB();
    await db.schema
      .alterTable(table)
      .modifyColumn("id", "integer", (col) => col.notNull().autoIncrement())
      .execute();
    await writeMigration(deps, ids[1], [
      {
        type: "add_column",
        table,
        column: "before_failure",
        attributes: { type: "integer" },
      },
    ]);
    await writeMigration(deps, ids[2], [
      {
        type: "alter_column",
        table,
        column: "id",
        before: { type: "integer", notNull: true },
        after: { type: "bigint", notNull: true },
      },
    ]);

    for (const plan of [true, false]) {
      await expect(executeApply(deps, { plan, pretty: false })).rejects.toThrow(
        /migration 003_unsafe, operation 1: .*auto_increment/,
      );
      expect(logger.stdout).not.toHaveBeenCalled();
      expect(
        (await db.introspection.getTables())
          .find((candidate) => candidate.name === table)
          ?.columns.map((col) => col.name),
      ).toEqual(["id"]);
      expect(
        await db.selectFrom(DEFAULT_MIGRATION_TABLE).select("name").execute(),
      ).toEqual([{ name: ids[0] }]);
    }
    const beforeGeneration = await getAllMigrations(deps);
    await expect(
      executeGenerate(deps, { ignorePending: true, dev: false }),
    ).rejects.toThrow("auto_increment");
    expect(await getAllMigrations(deps)).toEqual(beforeGeneration);
  } finally {
    await cleanupScenario(baseDeps, ids, [table]);
  }
});

it("does not project SERIAL as an attribute-free integer", async ({
  testDB,
}) => {
  const { client, database, baseDeps } = testDB;
  const table = "validation_serial";
  const ids = ["001_serial", "002_serial"];
  const logger = { ...nullLogger, stdout: vi.fn() };
  const deps = {
    ...baseDeps,
    logger,
    config: defineConfigForTest({ database, tables: [] }),
  };
  const create: Operation = {
    type: "create_table",
    table,
    columns: { id: { type: "serial" } },
  };
  try {
    await writeMigration(deps, ids[0], [create]);
    await writeMigration(deps, ids[1], [
      {
        type: "alter_column",
        table,
        column: "id",
        before: { type: "serial", notNull: true },
        after: { type: "bigint", notNull: true },
      },
    ]);
    for (const plan of [true, false]) {
      await expect(executeApply(deps, { plan, pretty: false })).rejects.toThrow(
        /migration 002_serial, operation 1: .*auto_increment/,
      );
      expect(logger.stdout).not.toHaveBeenCalled();
      await using db = client.getDB();
      expect(
        (await db.introspection.getTables()).some(
          (candidate) => candidate.name === table,
        ),
      ).toBe(false);
    }

    await using db = client.getDB();
    await executeOperation(
      db,
      create,
      client.getSchemaAdapter().operationExecutors,
    );
    expect(
      (await readMysqlColumnMetadata(db)).find(
        (column) => column.table_name === table,
      ),
    ).toEqual(
      expect.objectContaining({
        column_name: "id",
        column_type: expect.stringContaining("unsigned"),
        extra: "auto_increment",
      }),
    );
  } finally {
    await cleanupScenario(baseDeps, ids, [table]);
  }
});

it("plans and applies table creation, inline primary keys, and column addition followed by modification in one migration", async ({
  testDB,
}) => {
  const { client, database, baseDeps } = testDB;
  const created = "validation_same_created";
  const plain = "validation_same_plain";
  const existing = "validation_same_existing";
  const ids: ReadonlyArray<string> = ["001_same_migration"];
  const logger = { ...nullLogger, stdout: vi.fn() };
  const deps = {
    ...baseDeps,
    logger,
    config: defineConfigForTest({ database, tables: [] }),
  };
  await using db = client.getDB();
  try {
    await db.schema.createTable(existing).addColumn("id", "integer").execute();
    // Deliberately unordered input verifies reconciliation precedes validation and execution.
    await writeMigration(deps, ids[0], [
      {
        type: "alter_column",
        table: created,
        column: "id",
        before: { type: "integer", notNull: true },
        after: { type: "bigint", notNull: true },
      },
      {
        type: "alter_column",
        table: existing,
        column: "amount",
        before: { type: "integer", defaultSql: "3" },
        after: { type: "bigint", notNull: true },
      },
      {
        type: "add_column",
        table: existing,
        column: "amount",
        attributes: { type: "integer", defaultSql: "3" },
      },
      {
        type: "create_table",
        table: created,
        columns: { id: { type: "integer" } },
      },
      {
        type: "create_primary_key_constraint",
        table: created,
        name: "PRIMARY",
        columns: ["id"],
      },
      {
        type: "alter_column",
        table: plain,
        column: "amount",
        before: { type: "integer" },
        after: { type: "bigint" },
      },
      {
        type: "create_table",
        table: plain,
        columns: { amount: { type: "integer" } },
      },
    ]);
    const before = await readMysqlColumnMetadata(db);
    await executeApply(deps, { plan: true, pretty: false });
    expect(logger.stdout.mock.calls.map(([query]) => query)).toEqual([
      `create table \`${created}\` (\`id\` integer, primary key (\`id\`))`,
      `create table \`${plain}\` (\`amount\` integer)`,
      `alter table \`${existing}\` add column \`amount\` integer default 3`,
      `alter table \`${created}\` modify column \`id\` bigint not null`,
      `alter table \`${existing}\` modify column \`amount\` bigint default 3 not null`,
      `alter table \`${plain}\` modify column \`amount\` bigint`,
    ]);
    expect(await readMysqlColumnMetadata(db)).toEqual(before);

    await executeApply(deps, { plan: false, pretty: false });
    expect(await readMysqlColumnMetadata(db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: created,
          column_name: "id",
          column_type: expect.stringMatching(/^bigint/),
          is_nullable: "NO",
          column_default: null,
          extra: "",
        }),
        expect.objectContaining({
          table_name: existing,
          column_name: "amount",
          column_type: expect.stringMatching(/^bigint/),
          is_nullable: "NO",
          column_default: "3",
          extra: "",
        }),
        expect.objectContaining({
          table_name: plain,
          column_name: "amount",
          column_type: expect.stringMatching(/^bigint/),
          is_nullable: "YES",
          column_default: null,
          extra: "",
        }),
      ]),
    );
    expect(
      await db
        .selectFrom(DEFAULT_MIGRATION_TABLE)
        .select("name")
        .where("name", "in", ids)
        .execute(),
    ).toEqual([{ name: ids[0] }]);
  } finally {
    await cleanupScenario(baseDeps, ids, [created, plain, existing]);
  }
});

it("forgets old table and column attributes across drop, recreation, and modification migrations", async ({
  testDB,
}) => {
  const { client, database, baseDeps } = testDB;
  const table = "validation_recreated_table";
  const columnTable = "validation_recreated_column";
  const ids: ReadonlyArray<string> = [
    "001_recreate",
    "002_recreate",
    "003_recreate",
  ];
  const logger = { ...nullLogger, stdout: vi.fn() };
  const deps = {
    ...baseDeps,
    logger,
    config: defineConfigForTest({ database, tables: [] }),
  };
  await using db = client.getDB();
  try {
    await db.schema
      .createTable(table)
      .addColumn("id", "integer", (col) =>
        col.notNull().autoIncrement().primaryKey(),
      )
      .execute();
    await db.schema
      .createTable(columnTable)
      .addColumn("id", "integer")
      .addColumn("amount", "integer", (col) => col.defaultTo(5))
      .execute();
    await sql`alter table ${sql.table(columnTable)} modify column ${sql.id("amount")} integer default 5 comment 'legacy'`.execute(
      db,
    );
    await db.insertInto(columnTable).values({ id: 1 }).execute();
    const before = await readMysqlColumnMetadata(db);
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: table,
          column_name: "id",
          extra: "auto_increment",
        }),
        expect.objectContaining({
          table_name: columnTable,
          column_name: "amount",
          column_default: "5",
          column_comment: "legacy",
        }),
      ]),
    );

    await writeMigration(deps, ids[0], [
      { type: "drop_table", table },
      {
        type: "drop_column",
        table: columnTable,
        column: "amount",
        attributes: { type: "integer", defaultSql: "5" },
      },
    ]);
    await writeMigration(deps, ids[1], [
      { type: "create_table", table, columns: { id: { type: "integer" } } },
      {
        type: "add_column",
        table: columnTable,
        column: "amount",
        attributes: { type: "integer", defaultSql: "3" },
      },
    ]);
    await writeMigration(deps, ids[2], [
      {
        type: "alter_column",
        table,
        column: "id",
        before: { type: "integer" },
        after: { type: "bigint" },
      },
      {
        type: "alter_column",
        table: columnTable,
        column: "amount",
        before: { type: "integer", defaultSql: "3" },
        after: { type: "bigint", notNull: true },
      },
    ]);
    await executeApply(deps, { plan: true, pretty: false });
    expect(logger.stdout).toHaveBeenCalledWith(`drop table \`${table}\``);
    expect(logger.stdout).toHaveBeenCalledWith(
      `alter table \`${columnTable}\` drop column \`amount\``,
    );
    expect(logger.stdout).toHaveBeenCalledWith(
      `alter table \`${columnTable}\` modify column \`amount\` bigint default 3 not null`,
    );
    expect(await readMysqlColumnMetadata(db)).toEqual(before);

    await executeApply(deps, { plan: false, pretty: false });
    expect(await readMysqlColumnMetadata(db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: table,
          column_name: "id",
          column_type: expect.stringMatching(/^bigint/),
          is_nullable: "YES",
          column_default: null,
          extra: "",
          column_comment: "",
        }),
        expect.objectContaining({
          table_name: columnTable,
          column_name: "amount",
          column_type: expect.stringMatching(/^bigint/),
          is_nullable: "NO",
          column_default: "3",
          extra: "",
          column_comment: "",
        }),
      ]),
    );
    const row = await db
      .selectFrom(columnTable)
      .select(["id", "amount"])
      .executeTakeFirstOrThrow();
    expect(Number(row.id)).toBe(1);
    expect(Number(row.amount)).toBe(3);
    expect(
      (
        await db
          .selectFrom(DEFAULT_MIGRATION_TABLE)
          .select("name")
          .where("name", "in", ids)
          .execute()
      )
        .map(({ name }) => name)
        .sort(),
    ).toEqual(ids);
  } finally {
    await cleanupScenario(baseDeps, ids, [table, columnTable]);
  }
});

for (const explicitDefault of [false, true]) {
  it(`${explicitDefault ? "allows explicit replacement" : "rejects implicit preservation"} of an unknown future expression default`, async ({
    testDB,
  }) => {
    const { client, database, baseDeps } = testDB;
    const suffix = explicitDefault ? "explicit" : "implicit";
    const table = `validation_default_${suffix}`;
    const ids: ReadonlyArray<string> = [
      `001_default_${suffix}`,
      `002_default_${suffix}`,
    ];
    const logger = { ...nullLogger, stdout: vi.fn() };
    const deps = {
      ...baseDeps,
      logger,
      config: defineConfigForTest({ database, tables: [] }),
    };
    await using db = client.getDB();
    try {
      await writeMigration(deps, ids[0], [
        {
          type: "create_table",
          table,
          columns: {
            id: { type: "integer" },
            amount: { type: "integer", defaultSql: "(1 + 2)" },
          },
        },
      ]);
      await writeMigration(deps, ids[1], [
        {
          type: "alter_column",
          table,
          column: "amount",
          before: { type: "integer", defaultSql: "(1 + 2)" },
          after: {
            type: "bigint",
            ...(explicitDefault ? { defaultSql: "7" } : {}),
          },
        },
      ]);
      const before = (await readMysqlColumnMetadata(db)).filter(
        (column) => !column.table_name.startsWith("kysely_"),
      );
      const sources = await getAllMigrations(deps);
      if (!explicitDefault) {
        for (const plan of [true, false]) {
          await expect(
            executeApply(deps, { plan, pretty: false }),
          ).rejects.toThrow(
            `migration ${ids[1]}, operation 1: Cannot validate modification of ${table}.amount: future default metadata cannot be established`,
          );
          expect(logger.stdout).not.toHaveBeenCalled();
          expect(
            (await readMysqlColumnMetadata(db)).filter(
              (column) => !column.table_name.startsWith("kysely_"),
            ),
          ).toEqual(before);
          const tables = await db.introspection.getTables({
            withInternalKyselyTables: true,
          });
          expect(tables.some((candidate) => candidate.name === table)).toBe(
            false,
          );
          if (
            tables.some(
              (candidate) => candidate.name === DEFAULT_MIGRATION_TABLE,
            )
          ) {
            expect(
              await db
                .selectFrom(DEFAULT_MIGRATION_TABLE)
                .select("name")
                .where("name", "in", ids)
                .execute(),
            ).toEqual([]);
          }
          expect(await getAllMigrations(deps)).toEqual(sources);
        }
      } else {
        await executeApply(deps, { plan: true, pretty: false });
        expect(logger.stdout).toHaveBeenCalledWith(
          `alter table \`${table}\` modify column \`amount\` bigint default 7`,
        );
        expect(
          (await readMysqlColumnMetadata(db)).filter(
            (column) => !column.table_name.startsWith("kysely_"),
          ),
        ).toEqual(before);
        await executeApply(deps, { plan: false, pretty: false });
        expect(
          (await readMysqlColumnMetadata(db)).find(
            (column) =>
              column.table_name === table && column.column_name === "amount",
          ),
        ).toEqual(
          expect.objectContaining({
            column_type: expect.stringMatching(/^bigint/),
            column_default: "7",
            extra: "",
          }),
        );
        await db.insertInto(table).values({ id: 1 }).execute();
        const row = await db
          .selectFrom(table)
          .select("amount")
          .executeTakeFirstOrThrow();
        expect(Number(row.amount)).toBe(7);
        expect(
          (
            await db
              .selectFrom(DEFAULT_MIGRATION_TABLE)
              .select("name")
              .where("name", "in", ids)
              .execute()
          )
            .map(({ name }) => name)
            .sort(),
        ).toEqual(ids);
        expect(await getAllMigrations(deps)).toEqual(sources);
      }
    } finally {
      await cleanupScenario(baseDeps, ids, [table]);
    }
  });
}
