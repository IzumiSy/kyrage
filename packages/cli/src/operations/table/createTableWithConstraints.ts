import z from "zod";
import { CreateTableBuilder } from "kysely";
import {
  tableColumnAttributesSchema,
  TableColumnAttributes,
  referentialActionsSchema,
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
        foreignKeys: z
          .array(
            z.object({
              name: z.string(),
              columns: z.array(z.string()).readonly(),
              referencedTable: z.string(),
              referencedColumns: z.array(z.string()).readonly(),
              onDelete: referentialActionsSchema.optional(),
              onUpdate: referentialActionsSchema.optional(),
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

    // Primary KeyとUnique制約、Foreign Key制約をInlineで追加
    if (operation.constraints) {
      const { primaryKey, unique, foreignKeys } = operation.constraints;

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

      // Foreign Key制約
      if (foreignKeys) {
        for (const fk of foreignKeys) {
          builder = builder.addForeignKeyConstraint(
            fk.name,
            fk.columns as Array<string>,
            fk.referencedTable,
            fk.referencedColumns as Array<string>,
            (constraint) => {
              let c = constraint;
              if (fk.onDelete) c = c.onDelete(fk.onDelete);
              if (fk.onUpdate) c = c.onUpdate(fk.onUpdate);
              
              // Deferrable制約を追加（MySQLでは無視され、PostgreSQLでは順序問題を解決）
              return c.deferrable().initiallyDeferred();
            }
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
    foreignKeys?: ReadonlyArray<{
      name: string;
      columns: ReadonlyArray<string>;
      referencedTable: string;
      referencedColumns: ReadonlyArray<string>;
      onDelete?: string;
      onUpdate?: string;
    }>;
  }
) => ({
  type: "create_table_with_constraints" as const,
  table,
  columns,
  constraints,
});
