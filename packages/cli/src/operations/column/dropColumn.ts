import z from "zod";
import {
  tableColumnOpSchemaBase,
  tableColumnAttributesSchema,
  TableColumnOpValue,
  TableColumnAttributes,
} from "../shared/types";
import { defineOperation } from "../shared/operation";

export const dropColumnOp = defineOperation({
  typeName: "drop_column",
  schema: z.object({
    ...tableColumnOpSchemaBase.shape,
    type: z.literal("drop_column"),
    attributes: tableColumnAttributesSchema,
  }),
  execute: async (db, operation) => {
    await db.schema
      .alterTable(operation.table)
      .dropColumn(operation.column)
      .execute();
  },
});

export const dropColumn = (
  tableColumn: TableColumnOpValue,
  attributes: TableColumnAttributes
) => ({
  ...tableColumn,
  type: "drop_column" as const,
  attributes,
});
