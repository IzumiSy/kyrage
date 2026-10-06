import z from "zod";
import {
  tableColumnOpSchemaBase,
  tableColumnAttributesSchema,
  TableColumnOpValue,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType, isMysqlDatabase } from "../shared/utils";
import { sql } from "kysely";
import { defineOperation } from "../shared/operation";

/** Rejects changes that would silently discard attributes not modeled by the schema API. */
const assertColumnModificationAllowed = (
  before: TableColumnAttributes,
  after: TableColumnAttributes
) => {
  if (
    before.alterationBlockedReason &&
    (before.type !== after.type ||
      Boolean(before.notNull) !== Boolean(after.notNull))
  ) {
    throw new Error(
      `Cannot safely modify column: ${before.alterationBlockedReason}`
    );
  }
};

/** Alters column definitions with MODIFY COLUMN on MySQL-compatible databases. */
export const alterColumnOp = defineOperation({
  typeName: "alter_column",
  schema: z.object({
    ...tableColumnOpSchemaBase.shape,
    type: z.literal("alter_column"),
    before: tableColumnAttributesSchema,
    after: tableColumnAttributesSchema,
  }),
  execute: async (db, operation) => {
    const { table, column, before, after } = operation;

    if (isMysqlDatabase(db)) {
      assertColumnModificationAllowed(before, after);
      if (
        before.type === after.type &&
        Boolean(before.notNull) === Boolean(after.notNull)
      )
        return;
      assertDataType(after.type);
      await db.schema
        .alterTable(table)
        .modifyColumn(column, after.type, (col) => {
          let builder = after.notNull ? col.notNull() : col;
          const defaultSql = after.defaultSql ?? before.defaultSql;
          if (typeof defaultSql === "string") {
            builder = builder.defaultTo(sql.raw(defaultSql));
          }
          return builder;
        })
        .execute();
      return;
    }

    // dataType
    if (before.type !== after.type) {
      const dataType = after.type;
      assertDataType(dataType);
      await db.schema
        .alterTable(table)
        .alterColumn(column, (col) => col.setDataType(dataType))
        .execute();
    }

    // notNull
    if (after.notNull !== before.notNull) {
      if (after.notNull) {
        await db.schema
          .alterTable(table)
          .alterColumn(column, (col) => col.setNotNull())
          .execute();
      } else {
        await db.schema
          .alterTable(table)
          .alterColumn(column, (col) => col.dropNotNull())
          .execute();
      }
    }
  },
});

/** Builds an alteration only when existing column attributes can be retained safely. */
export const alterColumn = (
  tableColumn: TableColumnOpValue,
  before: TableColumnAttributes,
  after: TableColumnAttributes
) => {
  assertColumnModificationAllowed(before, after);
  return { ...tableColumn, type: "alter_column" as const, before, after };
};
