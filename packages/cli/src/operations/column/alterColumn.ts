import z from "zod";
import {
  tableColumnOpSchemaBase,
  tableColumnAttributesSchema,
  TableColumnOpValue,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType } from "../shared/utils";
import { defineOperation } from "../shared/operation";

/** Alters column types and nullability using standard schema operations. */
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

/** Describes a column alteration without applying dialect-specific execution policy. */
export const alterColumn = (
  tableColumn: TableColumnOpValue,
  before: TableColumnAttributes,
  after: TableColumnAttributes
) => {
  return { ...tableColumn, type: "alter_column" as const, before, after };
};
