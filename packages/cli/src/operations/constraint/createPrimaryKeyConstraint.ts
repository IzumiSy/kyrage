import z from "zod";
import { Kysely } from "kysely";
import {
  primaryKeyConstraintSchema,
  PrimaryKeyConstraintSchema,
} from "../shared/types";

export const createPrimaryKeyConstraintSchema = z.object({
  ...primaryKeyConstraintSchema.shape,
  type: z.literal("create_primary_key_constraint"),
});

export type CreatePrimaryKeyConstraintOperation = z.infer<
  typeof createPrimaryKeyConstraintSchema
>;

export async function executeCreatePrimaryKeyConstraint(
  db: Kysely<any>,
  operation: CreatePrimaryKeyConstraintOperation
) {
  await db.schema
    .alterTable(operation.table)
    .addPrimaryKeyConstraint(operation.name, operation.columns as Array<string>)
    .execute();
}

export const createPrimaryKeyConstraint = (
  value: PrimaryKeyConstraintSchema
): CreatePrimaryKeyConstraintOperation => ({
  ...value,
  type: "create_primary_key_constraint" as const,
});
