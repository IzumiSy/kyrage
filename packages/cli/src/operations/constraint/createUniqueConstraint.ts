import z from "zod";
import {
  uniqueConstraintSchema,
  UniqueConstraintSchema,
} from "../shared/types";
import { defineOperation, InferOpSchema } from "../shared/operation";

export const createUniqueConstraintOp = defineOperation({
  typeName: "create_unique_constraint",
  schema: z.object({
    ...uniqueConstraintSchema.shape,
    type: z.literal("create_unique_constraint"),
  }),
  execute: async (db, operation) => {
    await db.schema
      .alterTable(operation.table)
      .addUniqueConstraint(operation.name, operation.columns as Array<string>)
      .execute();
  },
});

export type CreateUniqueConstraintOp = InferOpSchema<
  typeof createUniqueConstraintOp
>;

export const createUniqueConstraint = (value: UniqueConstraintSchema) => ({
  ...value,
  type: "create_unique_constraint" as const,
});
