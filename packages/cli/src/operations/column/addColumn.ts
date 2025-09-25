import z from "zod";
import { sql } from "kysely";
import {
  tableColumnOpSchemaBase,
  tableColumnAttributesSchema,
  TableColumnOpValue,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType } from "../shared/utils";
import { defineOperation } from "../shared/operation";

export const addColumnOp = defineOperation({
  typeName: "add_column",
  schema: z.object({
    ...tableColumnOpSchemaBase.shape,
    type: z.literal("add_column"),
    attributes: tableColumnAttributesSchema,
  }),
  execute: async (db, operation) => {
    const dataType = operation.attributes.type;
    assertDataType(dataType);

    await db.schema
      .alterTable(operation.table)
      .addColumn(operation.column, dataType, (col) => {
        let c = col;
        if (operation.attributes.notNull) c = c.notNull();
        if (typeof operation.attributes.defaultSql === "string") {
          c = c.defaultTo(sql.raw(operation.attributes.defaultSql));
        }
        return c;
      })
      .execute();
  },
});

export const addColumn = (
  tableColumn: TableColumnOpValue,
  attributes: TableColumnAttributes
) => ({
  ...tableColumn,
  type: "add_column" as const,
  attributes,
});
