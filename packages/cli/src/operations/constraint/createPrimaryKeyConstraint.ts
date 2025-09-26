import z from "zod";
import {
  primaryKeyConstraintSchema,
  PrimaryKeyConstraintSchema,
} from "../shared/types";
import { defineOperation, InferOpSchema } from "../shared/operation";

export const createPrimaryKeyConstraintOp = defineOperation({
  typeName: "create_primary_key_constraint",
  schema: z.object({
    ...primaryKeyConstraintSchema.shape,
    type: z.literal("create_primary_key_constraint"),
  }),
  execute: async (db, operation) => {
    await db.schema
      .alterTable(operation.table)
      .addPrimaryKeyConstraint(
        operation.name,
        operation.columns as Array<string>
      )
      .execute();
  },
});

export type CreatePrimaryKeyConstraintOp = InferOpSchema<
  typeof createPrimaryKeyConstraintOp
>;

export const createPrimaryKeyConstraint = (
  value: PrimaryKeyConstraintSchema
) => ({
  ...value,
  type: "create_primary_key_constraint" as const,
});
