import z from "zod";
import { CreateTableBuilder, sql } from "kysely";
import {
  tableColumnAttributesSchema,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType } from "../shared/utils";
import { defineOperation } from "../shared/operation";

export const createTableOp = defineOperation({
  typeName: "create_table",
  schema: z.object({
    type: z.literal("create_table"),
    table: z.string(),
    columns: z.record(z.string(), tableColumnAttributesSchema),
  }),
  execute: async (db, operation) => {
    let builder = db.schema.createTable(operation.table);
    builder = addColumnsToTableBuilder(builder, operation.columns);
    await builder.execute();
  },
});

export const createTable = (
  table: string,
  columns: Record<string, TableColumnAttributes>
) => ({
  type: "create_table" as const,
  table,
  columns,
});

// カラム追加の共通処理
export function addColumnsToTableBuilder(
  builder: CreateTableBuilder<string, any>,
  columns: Record<string, TableColumnAttributes>
): CreateTableBuilder<string, any> {
  let result = builder;
  for (const [colName, colDef] of Object.entries(columns)) {
    const dataType = colDef.type;
    assertDataType(dataType);
    result = result.addColumn(colName, dataType, (col) => {
      let c = col;
      if (colDef.notNull) c = c.notNull();
      if (typeof colDef.defaultSql === "string") {
        c = c.defaultTo(sql.raw(colDef.defaultSql));
      }
      return c;
    });
  }
  return result;
}
