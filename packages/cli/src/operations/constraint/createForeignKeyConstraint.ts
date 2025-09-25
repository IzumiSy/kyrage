import z from "zod";
import { Kysely } from "kysely";
import {
  foreignKeyConstraintSchema,
  TableOpValue,
  ReferentialActions,
} from "../shared/types";

export const createForeignKeyConstraintSchema = z.object({
  ...foreignKeyConstraintSchema.shape,
  type: z.literal("create_foreign_key_constraint"),
});

export type CreateForeignKeyConstraintOperation = z.infer<
  typeof createForeignKeyConstraintSchema
>;

export async function executeCreateForeignKeyConstraint(
  db: Kysely<any>,
  operation: CreateForeignKeyConstraintOperation
) {
  let builder = db.schema
    .alterTable(operation.table)
    .addForeignKeyConstraint(
      operation.name,
      operation.columns as Array<string>,
      operation.referencedTable,
      operation.referencedColumns as Array<string>
    );

  if (operation.onDelete) {
    builder = builder.onDelete(operation.onDelete);
  }
  if (operation.onUpdate) {
    builder = builder.onUpdate(operation.onUpdate);
  }

  await builder.execute();
}

export const createForeignKeyConstraint = (
  tableOpValue: TableOpValue,
  options: {
    columns: ReadonlyArray<string>;
    referencedTable: string;
    referencedColumns: ReadonlyArray<string>;
    onDelete?: ReferentialActions;
    onUpdate?: ReferentialActions;
  }
): CreateForeignKeyConstraintOperation => ({
  ...tableOpValue,
  ...options,
  type: "create_foreign_key_constraint" as const,
});
