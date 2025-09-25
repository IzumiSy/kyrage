import z from "zod";
import { Kysely, sql } from "kysely";
import {
  tableColumnOpSchemaBase,
  tableColumnAttributesSchema,
  TableColumnOpValue,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType } from "../shared/utils";

export const addColumnSchema = z.object({
  ...tableColumnOpSchemaBase.shape,
  type: z.literal("add_column"),
  attributes: tableColumnAttributesSchema,
});

export type AddColumnOperation = z.infer<typeof addColumnSchema>;

export async function executeAddColumn(
  db: Kysely<any>,
  operation: AddColumnOperation
) {
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
}

export const addColumn = (
  tableColumn: TableColumnOpValue,
  attributes: TableColumnAttributes
): AddColumnOperation => ({
  ...tableColumn,
  type: "add_column" as const,
  attributes,
});
