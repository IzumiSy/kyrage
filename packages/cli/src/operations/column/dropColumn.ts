import z from "zod";
import { Kysely } from "kysely";
import {
  tableColumnOpSchemaBase,
  tableColumnAttributesSchema,
  TableColumnOpValue,
  TableColumnAttributes,
} from "../shared/types";

export const dropColumnSchema = z.object({
  ...tableColumnOpSchemaBase.shape,
  type: z.literal("drop_column"),
  attributes: tableColumnAttributesSchema,
});

export type DropColumnOperation = z.infer<typeof dropColumnSchema>;

export async function executeDropColumn(
  db: Kysely<any>,
  operation: DropColumnOperation
) {
  await db.schema
    .alterTable(operation.table)
    .dropColumn(operation.column)
    .execute();
}

export const dropColumn = (
  tableColumn: TableColumnOpValue,
  attributes: TableColumnAttributes
): DropColumnOperation => ({
  ...tableColumn,
  type: "drop_column" as const,
  attributes,
});
