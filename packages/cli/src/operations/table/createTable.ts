import z from "zod";
import { Kysely, CreateTableBuilder, sql } from "kysely";
import {
  tableColumnAttributesSchema,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType } from "../shared/utils";

export const createTableSchema = z.object({
  type: z.literal("create_table"),
  table: z.string(),
  columns: z.record(z.string(), tableColumnAttributesSchema),
});

export type CreateTableOperation = z.infer<typeof createTableSchema>;

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

export async function executeCreateTable(
  db: Kysely<any>,
  operation: CreateTableOperation
) {
  let builder: CreateTableBuilder<string, any> = db.schema.createTable(
    operation.table
  );

  builder = addColumnsToTableBuilder(builder, operation.columns);

  await builder.execute();
}

export const createTable = (
  table: string,
  columns: Record<string, TableColumnAttributes>
): CreateTableOperation => ({
  type: "create_table" as const,
  table,
  columns,
});
