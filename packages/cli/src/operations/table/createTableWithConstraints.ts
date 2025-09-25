import z from "zod";
import { Kysely, CreateTableBuilder, sql } from "kysely";
import {
  tableColumnAttributesSchema,
  TableColumnAttributes,
} from "../shared/types";
import { assertDataType } from "../shared/utils";

export const createTableWithConstraintsSchema = z.object({
  type: z.literal("create_table_with_constraints"),
  table: z.string(),
  columns: z.record(z.string(), tableColumnAttributesSchema),
  constraints: z
    .object({
      primaryKey: z
        .object({
          name: z.string(),
          columns: z.array(z.string()).readonly(),
        })
        .optional(),
      unique: z
        .array(
          z.object({
            name: z.string(),
            columns: z.array(z.string()).readonly(),
          })
        )
        .readonly()
        .optional(),
    })
    .optional(),
});

export type CreateTableWithConstraintsOperation = z.infer<
  typeof createTableWithConstraintsSchema
>;

export async function executeCreateTableWithConstraints(
  db: Kysely<any>,
  operation: CreateTableWithConstraintsOperation
) {
  let builder: CreateTableBuilder<string, any> = db.schema.createTable(
    operation.table
  );

  // カラム追加
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

  // Primary KeyとUnique制約のみをInlineで追加
  if (operation.constraints) {
    const { primaryKey, unique } = operation.constraints;

    // Primary Key制約
    if (primaryKey) {
      builder = builder.addPrimaryKeyConstraint(
        primaryKey.name,
        primaryKey.columns as Array<string>
      );
    }

    // Unique制約
    if (unique) {
      for (const uq of unique) {
        builder = builder.addUniqueConstraint(
          uq.name,
          uq.columns as Array<string>
        );
      }
    }
  }

  await builder.execute();
}

export const createTableWithConstraints = (
  table: string,
  columns: Record<string, TableColumnAttributes>,
  constraints?: {
    primaryKey?: { name: string; columns: ReadonlyArray<string> };
    unique?: ReadonlyArray<{ name: string; columns: ReadonlyArray<string> }>;
  }
): CreateTableWithConstraintsOperation => ({
  type: "create_table_with_constraints" as const,
  table,
  columns,
  constraints,
});
