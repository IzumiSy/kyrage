import z from "zod";
import { Kysely } from "kysely";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";

export const dropUniqueConstraintSchema = z.object({
  ...tableOpSchemaBase.shape,
  type: z.literal("drop_unique_constraint"),
});

export type DropUniqueConstraintOperation = z.infer<
  typeof dropUniqueConstraintSchema
>;

export async function executeDropUniqueConstraint(
  db: Kysely<any>,
  operation: DropUniqueConstraintOperation
) {
  await db.schema
    .alterTable(operation.table)
    .dropConstraint(operation.name)
    .execute();
}

export const dropUniqueConstraint = (
  value: TableOpValue
): DropUniqueConstraintOperation => ({
  ...value,
  type: "drop_unique_constraint" as const,
});
