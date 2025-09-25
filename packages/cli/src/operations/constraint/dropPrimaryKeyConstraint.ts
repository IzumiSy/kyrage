import z from "zod";
import { Kysely } from "kysely";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";

export const dropPrimaryKeyConstraintSchema = z.object({
  ...tableOpSchemaBase.shape,
  type: z.literal("drop_primary_key_constraint"),
});

export type DropPrimaryKeyConstraintOperation = z.infer<
  typeof dropPrimaryKeyConstraintSchema
>;

export async function executeDropPrimaryKeyConstraint(
  db: Kysely<any>,
  operation: DropPrimaryKeyConstraintOperation
) {
  await db.schema
    .alterTable(operation.table)
    .dropConstraint(operation.name)
    .execute();
}

export const dropPrimaryKeyConstraint = (
  value: TableOpValue
): DropPrimaryKeyConstraintOperation => ({
  ...value,
  type: "drop_primary_key_constraint" as const,
});
