import { describe, expect, it, vi } from "vitest";
import { getClient } from "../client";
import { getDialect } from "./factory";
import type { MysqlColumnMetadata } from "./mysql-column-metadata";
import type { Operation } from "../operations/executor";

const column: MysqlColumnMetadata = {
  table_schema: "test",
  table_name: "orders",
  column_name: "amount",
  column_type: "int",
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
  rows: ReadonlyArray<MysqlColumnMetadata> = [column]
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

const earlierChanges: ReadonlyArray<Operation> = [
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
  { type: "drop_table", table: "orders" },
  {
    type: "add_column",
    table: "orders",
    column: "amount",
    attributes: { type: "integer" },
  },
  {
    type: "drop_column",
    table: "orders",
    column: "amount",
    attributes: { type: "integer" },
  },
  modification,
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
          adapter.validateOperations({ db, operations: [modification] })
        ).rejects.toThrow(reason);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0].sql.trim()).toMatch(/^SELECT/);
        expect(db.getPlannedQueries()).toEqual([]);
      }
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
        adapter.validateOperations({ db, operations: [expressionModification] })
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
          })
        ).rejects.toThrow("default changed since generation");
        expect(query).toHaveBeenCalledTimes(1);
        expect(db.getPlannedQueries()).toEqual([]);
      }
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
        adapter.validateOperations({ db, operations: [modification] })
      ).rejects.toThrow(
        "orders.amount: column is missing from the current database"
      );
      expect(query).toHaveBeenCalledTimes(1);
      expect(db.getPlannedQueries()).toEqual([]);
    });

    it.each(earlierChanges)(
      "rejects unknown future state after $type before querying metadata",
      async (earlier) => {
        const { db: metadataDB, query } = createMetadataDB(dialect);
        await using db = metadataDB;
        await expect(
          adapter.validateOperations({
            db,
            operations: [earlier, modification],
          })
        ).rejects.toThrow("orders.amount: state depends on earlier operations");
        expect(query).not.toHaveBeenCalled();
        expect(db.getPlannedQueries()).toEqual([]);
      }
    );

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
        })
      ).rejects.toThrow("Unsupported data type");
      expect(query).not.toHaveBeenCalled();
    });
  }
);
