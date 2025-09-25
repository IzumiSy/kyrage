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

export async function executeCreateTable(
  db: Kysely<any>,
  operation: CreateTableOperation
) {
  let builder: CreateTableBuilder<string, any> = db.schema.createTable(
    operation.table
  );

  for (const [colName, colDef] of Object.entries(operation.columns)) {
    const dataType = colDef.type;
    assertDataType(dataType);
    builder = builder.addColumn(colName, dataType, (col) => {
      let c = col;
      if (colDef.notNull) c = c.notNull();
      if (typeof colDef.defaultSql === "string") {
        c = c.defaultTo(sql.raw(colDef.defaultSql));
      }
      return c;
    });
  }

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
