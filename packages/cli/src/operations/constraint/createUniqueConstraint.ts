import z from "zod";
import { Kysely } from "kysely";
import {
  uniqueConstraintSchema,
  UniqueConstraintSchema,
} from "../shared/types";

export const createUniqueConstraintSchema = z.object({
  ...uniqueConstraintSchema.shape,
  type: z.literal("create_unique_constraint"),
});

export type CreateUniqueConstraintOperation = z.infer<
  typeof createUniqueConstraintSchema
>;

export async function executeCreateUniqueConstraint(
  db: Kysely<any>,
  operation: CreateUniqueConstraintOperation
) {
  await db.schema
    .alterTable(operation.table)
    .addUniqueConstraint(operation.name, operation.columns as Array<string>)
    .execute();
}

export const createUniqueConstraint = (
  value: UniqueConstraintSchema
): CreateUniqueConstraintOperation => ({
  ...value,
  type: "create_unique_constraint" as const,
});
