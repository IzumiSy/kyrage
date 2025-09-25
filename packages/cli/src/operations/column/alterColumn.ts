import z from "zod";
import { Kysely } from "kysely";
import {
  tableColumnOpSchemaBase,
  tableColumnAttributesSchema,
  TableColumnOpValue,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType } from "../shared/utils";

export const alterColumnSchema = z.object({
  ...tableColumnOpSchemaBase.shape,
  type: z.literal("alter_column"),
  before: tableColumnAttributesSchema,
  after: tableColumnAttributesSchema,
});

export type AlterColumnOperation = z.infer<typeof alterColumnSchema>;

export async function executeAlterColumn(
  db: Kysely<any>,
  operation: AlterColumnOperation
) {
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
}

export const alterColumn = (
  tableColumn: TableColumnOpValue,
  before: TableColumnAttributes,
  after: TableColumnAttributes
): AlterColumnOperation => ({
  ...tableColumn,
  type: "alter_column" as const,
  before,
  after,
});
