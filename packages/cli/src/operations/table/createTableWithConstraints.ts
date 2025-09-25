import z from "zod";
import { CreateTableBuilder } from "kysely";
import {
  tableColumnAttributesSchema,
  TableColumnAttributes,
} from "../shared/types";
import { addColumnsToTableBuilder } from "./createTable";
import { defineOperation } from "../shared/operation";

export const createTableWithConstraintsOp = defineOperation({
  typeName: "create_table_with_constraints",
  schema: z.object({
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
  }),
  execute: async (db, operation) => {
    let builder: CreateTableBuilder<string, any> = db.schema.createTable(
      operation.table
    );

    // カラム追加（共通関数を使用）
    builder = addColumnsToTableBuilder(builder, operation.columns);

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
  },
});

export const createTableWithConstraints = (
  table: string,
  columns: Record<string, TableColumnAttributes>,
  constraints?: {
    primaryKey?: { name: string; columns: ReadonlyArray<string> };
    unique?: ReadonlyArray<{ name: string; columns: ReadonlyArray<string> }>;
  }
) => ({
  type: "create_table_with_constraints" as const,
  table,
  columns,
  constraints,
});
