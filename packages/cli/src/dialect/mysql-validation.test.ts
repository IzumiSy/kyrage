import { describe, expect, it, vi } from "vitest";
import { getClient } from "../client";
import { getDialect } from "./factory";
import type { MysqlColumnMetadata } from "./mysql-column-metadata";
import type { Operation } from "../operations/executor";
import { SchemaOperationValidationError } from "./schema-adapter";

const column: MysqlColumnMetadata = {
  table_schema: "test",
  table_name: "orders",
  column_name: "amount",
  column_type: "int",
  is_nullable: "YES",
  column_default: null,
  character_maximum_length: null,
  extra: "",
  column_comment: "",
  custom_collation: null,
};
const modification: Extract<Operation, { type: "alter_column" }> = {
  type: "alter_column",
  table: "orders",
  column: "amount",
  before: { type: "integer", notNull: false },
  after: { type: "bigint", notNull: false },
};

/** Provides fake live catalog rows without opening a database connection. */
const createMetadataDB = (
  dialect: "mysql" | "mariadb",
  rows: ReadonlyArray<MysqlColumnMetadata> = [column],
) => {
  const db = getClient({
    database: {
      dialect,
      connectionString: `${dialect}://localhost/test`,
    },
  }).getDB({ plan: true });
  const query = vi
    .spyOn(db.getExecutor(), "executeQuery")
    .mockResolvedValue({ rows: [...rows] });
  return { db, query };
};

const unsupportedCases: ReadonlyArray<{
  reason: string;
  attributes: Partial<MysqlColumnMetadata>;
}> = [
  { reason: "auto_increment", attributes: { extra: "auto_increment" } },
  { reason: "VIRTUAL GENERATED", attributes: { extra: "VIRTUAL GENERATED" } },
  {
    reason: "on update CURRENT_TIMESTAMP",
    attributes: { extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP" },
  },
  {
    reason: "column comment",
    attributes: { column_comment: "keep this comment" },
  },
  { reason: "custom collation", attributes: { custom_collation: 1 } },
];

const changedDefaultCases: ReadonlyArray<{
  label: string;
  beforeDefault?: string;
  liveDefault: string;
  extra: string;
}> = [
  { label: "missing", liveDefault: "(1 + 2)", extra: "DEFAULT_GENERATED" },
  { label: "stale", beforeDefault: "3", liveDefault: "5", extra: "" },
];

const earlierDefinitions: ReadonlyArray<Operation> = [
  {
    type: "create_table",
    table: "orders",
    columns: { amount: { type: "integer" } },
  },
  {
    type: "create_table_with_constraints",
    table: "orders",
    columns: { amount: { type: "integer" } },
  },
  {
    type: "add_column",
    table: "orders",
    column: "amount",
    attributes: { type: "integer" },
  },
];

const drops: ReadonlyArray<Operation> = [
  { type: "drop_table", table: "orders" },
  {
    type: "drop_column",
    table: "orders",
    column: "amount",
    attributes: { type: "integer" },
  },
];

describe.each(["mysql", "mariadb"] as const)(
  "%s operation validation",
  (dialect) => {
    const adapter = getDialect(dialect).createSchemaAdapter();

    it.each(unsupportedCases)(
      "rejects live $reason without issuing DDL",
      async ({ attributes, reason }) => {
        const { db: metadataDB, query } = createMetadataDB(dialect, [
          { ...column, ...attributes },
        ]);
        await using db = metadataDB;
        await expect(
          adapter.validateOperations({ db, operations: [modification] }),
        ).rejects.toThrow(reason);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0].sql.trim()).toMatch(/^SELECT/);
        expect(db.getPlannedQueries()).toEqual([]);
      },
    );

    it("allows supported expression defaults and reads current facts on every validation", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect, [
        { ...column, extra: "DEFAULT_GENERATED", column_default: "(1 + 2)" },
      ]);
      await using db = metadataDB;
      const expressionModification = {
        ...modification,
        before: { ...modification.before, defaultSql: "(1 + 2)" },
      };
      await adapter.validateOperations({
        db,
        operations: [expressionModification],
      });
      query.mockResolvedValueOnce({
        rows: [{ ...column, extra: "auto_increment" }],
      });
      await expect(
        adapter.validateOperations({
          db,
          operations: [expressionModification],
        }),
      ).rejects.toThrow("auto_increment");
      expect(query).toHaveBeenCalledTimes(2);
      expect(db.getPlannedQueries()).toEqual([]);
    });

    it.each(changedDefaultCases)(
      "rejects a $label baseline default instead of discarding the live default",
      async ({ beforeDefault, liveDefault, extra }) => {
        const { db: metadataDB, query } = createMetadataDB(dialect, [
          { ...column, column_default: liveDefault, extra },
        ]);
        await using db = metadataDB;
        await expect(
          adapter.validateOperations({
            db,
            operations: [
              {
                ...modification,
                before: { ...modification.before, defaultSql: beforeDefault },
              },
            ],
          }),
        ).rejects.toThrow("default changed since generation");
        expect(query).toHaveBeenCalledTimes(1);
        expect(db.getPlannedQueries()).toEqual([]);
      },
    );

    it("allows an explicit desired default even when the live default changed", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect, [
        { ...column, column_default: "5" },
      ]);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          {
            ...modification,
            before: { ...modification.before, defaultSql: "3" },
            after: { ...modification.after, defaultSql: "7" },
          },
        ],
      });
      expect(query).toHaveBeenCalledTimes(1);
      expect(db.getPlannedQueries()).toEqual([]);
    });

    it("validates nullability-only changes", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          {
            ...modification,
            after: { type: "integer", notNull: true },
          },
        ],
      });
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("skips metadata reads for unchanged definitions and intentional drops", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect, [
        { ...column, extra: "auto_increment" },
      ]);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          {
            ...modification,
            after: { type: "integer", notNull: false, unique: true },
          },
          {
            type: "drop_column",
            table: "orders",
            column: "amount",
            attributes: { type: "integer" },
          },
          { type: "drop_table", table: "orders" },
        ],
      });
      expect(query).not.toHaveBeenCalled();
    });

    it("rejects absent live columns instead of treating them as safe", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect, []);
      await using db = metadataDB;
      await expect(
        adapter.validateOperations({ db, operations: [modification] }),
      ).rejects.toThrow(
        "orders.amount: column is missing at this point in execution",
      );
      expect(query).toHaveBeenCalledTimes(1);
      expect(db.getPlannedQueries()).toEqual([]);
    });

    it.each(earlierDefinitions)(
      "validates future columns established by $type without existing catalog rows",
      async (earlier) => {
        const { db: metadataDB, query } = createMetadataDB(dialect, []);
        await using db = metadataDB;
        await adapter.validateOperations({
          db,
          operations: [earlier, modification],
        });
        expect(query).toHaveBeenCalledTimes(1);
        expect(db.getPlannedQueries()).toEqual([]);
      },
    );

    it.each(drops)(
      "rejects a modification after $type as missing",
      async (drop) => {
        const { db: metadataDB } = createMetadataDB(dialect);
        await using db = metadataDB;
        await expect(
          adapter.validateOperations({ db, operations: [drop, modification] }),
        ).rejects.toThrow("column is missing at this point in execution");
      },
    );

    it.each(drops)(
      "forgets old defaults and native attributes after $type and recreation",
      async (drop) => {
        const { db: metadataDB } = createMetadataDB(dialect, [
          { ...column, column_default: "5", extra: "auto_increment" },
        ]);
        await using db = metadataDB;
        const recreate: Operation =
          drop.type === "drop_table"
            ? {
                type: "create_table",
                table: "orders",
                columns: { amount: { type: "integer" } },
              }
            : {
                type: "add_column",
                table: "orders",
                column: "amount",
                attributes: { type: "integer" },
              };
        await adapter.validateOperations({
          db,
          operations: [drop, recreate, modification],
        });
      },
    );

    it.each([
      ["smallint", "-32768"],
      ["smallint", "32767"],
      ["integer", "-2147483648"],
      ["integer", "2147483647"],
      ["bigint", "-9223372036854775808"],
      ["bigint", "9223372036854775807"],
      ["integer", "0"],
      ["integer", "3"],
    ])(
      "predicts the catalog default for %s DEFAULT %s",
      async (type, defaultSql) => {
        const { db: metadataDB } = createMetadataDB(dialect, []);
        await using db = metadataDB;
        await adapter.validateOperations({
          db,
          operations: [
            {
              type: "create_table",
              table: "orders",
              columns: { amount: { type, defaultSql } },
            },
            {
              ...modification,
              before: { type, defaultSql },
              after: { type, notNull: true },
            },
          ],
        });
      },
    );

    it.each([
      ["smallint", "32768"],
      ["integer", "2147483648"],
      ["bigint", "9223372036854775808"],
      ["integer", "-0"],
      ["integer", "03"],
      ["integer", "3.0"],
      ["integer", "(1 + 2)"],
      ["decimal(10, 2)", "3"],
      ["varchar(32)", "'value'"],
    ])(
      "does not guess the catalog default for %s DEFAULT %s",
      async (type, defaultSql) => {
        const { db: metadataDB } = createMetadataDB(dialect, []);
        await using db = metadataDB;
        await expect(
          adapter.validateOperations({
            db,
            operations: [
              {
                type: "create_table",
                table: "orders",
                columns: { amount: { type, defaultSql } },
              },
              {
                ...modification,
                before: { type, defaultSql },
                after: { type, notNull: true },
              },
            ],
          }),
        ).rejects.toThrow("future default metadata cannot be established");
      },
    );

    it("uses rendered defaults across repeated modifications and detects stale later snapshots", async () => {
      const { db: metadataDB } = createMetadataDB(dialect, [
        { ...column, column_default: "3" },
      ]);
      await using db = metadataDB;
      const first = {
        ...modification,
        before: { type: "integer", defaultSql: "3" },
      };
      const second = {
        ...modification,
        before: { type: "bigint", defaultSql: "3" },
        after: { type: "bigint", notNull: true },
      };
      await adapter.validateOperations({ db, operations: [first, second] });
      await expect(
        adapter.validateOperations({
          db,
          operations: [
            { ...first, after: { type: "bigint", defaultSql: "7" } },
            second,
          ],
        }),
      ).rejects.toThrow("default changed since generation");
    });

    it("allows explicit default replacement but keeps the resulting expression state unknown", async () => {
      const { db: metadataDB } = createMetadataDB(dialect, []);
      await using db = metadataDB;
      const create: Operation = {
        type: "create_table",
        table: "orders",
        columns: { amount: { type: "integer", defaultSql: "(1 + 2)" } },
      };
      const replacement = {
        ...modification,
        after: { type: "bigint", defaultSql: "(2 + 3)" },
      };
      await adapter.validateOperations({
        db,
        operations: [create, replacement],
      });
      await expect(
        adapter.validateOperations({
          db,
          operations: [
            create,
            replacement,
            {
              ...modification,
              before: { type: "bigint", defaultSql: "(2 + 3)" },
              after: { type: "bigint", notNull: true },
            },
          ],
        }),
      ).rejects.toThrow("future default metadata cannot be established");
    });

    it.each([
      {
        type: "timestamp",
        reason: "future native attributes cannot be established",
      },
      {
        type: "json",
        reason: "future native attributes cannot be established",
      },
      { type: "serial", reason: "auto_increment" },
    ])(
      "does not bypass $type attributes with an explicit desired default",
      async ({ type, reason }) => {
        const { db: metadataDB } = createMetadataDB(dialect, []);
        await using db = metadataDB;
        await expect(
          adapter.validateOperations({
            db,
            operations: [
              {
                type: "create_table",
                table: "orders",
                columns: { amount: { type } },
              },
              {
                ...modification,
                before: { type },
                after: { type: "bigint", defaultSql: "7" },
              },
            ],
          }),
        ).rejects.toThrow(reason);
      },
    );

    it.each([
      "0 COMMENT 'must-preserve'",
      "0 /*!80000 COMMENT 'must-preserve' */",
      "'value' COMMENT 'must-preserve'",
      "0) -- ",
      "0-- ",
      "0/* */",
      "some_function()",
    ])(
      "does not let an explicit default bypass unclassified raw SQL: %s",
      async (defaultSql) => {
        const { db: metadataDB } = createMetadataDB(dialect, []);
        await using db = metadataDB;
        await expect(
          adapter.validateOperations({
            db,
            operations: [
              {
                type: "create_table",
                table: "orders",
                columns: { amount: { type: "integer", defaultSql } },
              },
              { ...modification, after: { type: "bigint", defaultSql: "1" } },
            ],
          }),
        ).rejects.toThrow(
          "future native attributes cannot be established from raw default SQL",
        );
      },
    );

    it.each([
      ["decimal(10, 2)", "3.00", "1"],
      ["integer", "(1 + 2)", "1"],
      ["varchar(32)", "'value'", "'replacement'"],
      ["varchar(32)", "'can''t'", "'replacement'"],
      ["boolean", "true", "false"],
      ["datetime(6)", "CURRENT_TIMESTAMP(6)", "'2020-01-01 00:00:00.000000'"],
    ])(
      "allows explicit replacement of bounded %s DEFAULT %s",
      async (type, defaultSql, desiredDefault) => {
        const { db: metadataDB } = createMetadataDB(dialect, []);
        await using db = metadataDB;
        await adapter.validateOperations({
          db,
          operations: [
            {
              type: "create_table",
              table: "orders",
              columns: { amount: { type, defaultSql } },
            },
            {
              ...modification,
              before: { type },
              after: { type, notNull: true, defaultSql: desiredDefault },
            },
          ],
        });
      },
    );

    it("does not reject unknown facts unless a later modification needs them", async () => {
      const { db: metadataDB } = createMetadataDB(dialect);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          {
            type: "add_column",
            table: "orders",
            column: "unrelated",
            attributes: { type: "timestamp" },
          },
          modification,
        ],
      });
    });

    it("tracks implicit primary-key nullability without guessing temporal effects", async () => {
      const primaryKey: Operation = {
        type: "create_primary_key_constraint",
        table: "orders",
        name: "pk_orders",
        columns: ["amount"],
      };
      const { db: metadataDB, query } = createMetadataDB(dialect);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          primaryKey,
          { ...modification, after: { type: "bigint", notNull: true } },
        ],
      });
      query.mockResolvedValueOnce({
        rows: [{ ...column, column_type: "timestamp" }],
      });
      await expect(
        adapter.validateOperations({
          db,
          operations: [
            primaryKey,
            {
              ...modification,
              before: { type: "timestamp", notNull: true },
              after: {
                type: "datetime",
                notNull: true,
                defaultSql: "CURRENT_TIMESTAMP",
              },
            },
          ],
        }),
      ).rejects.toThrow("after primary-key creation");
    });

    it("keeps defaults unchanged for definition no-ops, even when after contains a different default", async () => {
      const { db: metadataDB } = createMetadataDB(dialect, [
        { ...column, column_default: "3" },
      ]);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          { ...modification, after: { type: "integer", defaultSql: "7" } },
          { ...modification, before: { type: "integer", defaultSql: "3" } },
        ],
      });
    });

    it("reports the original operation position when a later modification is rejected", async () => {
      const { db: metadataDB } = createMetadataDB(dialect, [
        { ...column, extra: "auto_increment" },
      ]);
      await using db = metadataDB;
      const result = adapter.validateOperations({
        db,
        operations: [
          {
            type: "add_column",
            table: "orders",
            column: "other",
            attributes: { type: "integer" },
          },
          modification,
        ],
      });
      await expect(result).rejects.toBeInstanceOf(
        SchemaOperationValidationError,
      );
      await expect(result).rejects.toMatchObject({ operationIndex: 1 });
    });

    it("does not invalidate metadata for unrelated changes or definition no-ops", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          {
            type: "add_column",
            table: "orders",
            column: "other",
            attributes: { type: "integer" },
          },
          {
            ...modification,
            after: { type: "integer", notNull: false, unique: true },
          },
          modification,
        ],
      });
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("keeps comma-containing table and column identities distinct", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect, [
        { ...column, table_name: "orders,archive", column_name: "amount,net" },
      ]);
      await using db = metadataDB;
      await adapter.validateOperations({
        db,
        operations: [
          {
            ...modification,
            table: "orders,archive",
            column: "amount,net",
          },
        ],
      });
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid modification types before metadata reads", async () => {
      const { db: metadataDB, query } = createMetadataDB(dialect);
      await using db = metadataDB;
      await expect(
        adapter.validateOperations({
          db,
          operations: [
            {
              ...modification,
              after: { type: "integer; drop table orders" },
            },
          ],
        }),
      ).rejects.toThrow("Unsupported data type");
      expect(query).not.toHaveBeenCalled();
    });
  },
);
