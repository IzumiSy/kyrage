import z from "zod";
import { Kysely } from "kysely";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";

export const dropForeignKeyConstraintSchema = z.object({
  ...tableOpSchemaBase.shape,
  type: z.literal("drop_foreign_key_constraint"),
});

export type DropForeignKeyConstraintOperation = z.infer<
  typeof dropForeignKeyConstraintSchema
>;

export async function executeDropForeignKeyConstraint(
  db: Kysely<any>,
  operation: DropForeignKeyConstraintOperation
) {
  await db.schema
    .alterTable(operation.table)
    .dropConstraint(operation.name)
    .execute();
}

export const dropForeignKeyConstraint = (
  value: TableOpValue
): DropForeignKeyConstraintOperation => ({
  ...value,
  type: "drop_foreign_key_constraint" as const,
});
