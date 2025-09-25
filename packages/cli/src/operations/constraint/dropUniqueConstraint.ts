import z from "zod";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";
import { defineOperation } from "../shared/operation";

export const dropUniqueConstraintOp = defineOperation({
  typeName: "drop_unique_constraint",
  schema: z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_unique_constraint"),
  }),
  execute: async (db, operation) => {
    await db.schema
      .alterTable(operation.table)
      .dropConstraint(operation.name)
      .execute();
  },
});

export const dropUniqueConstraint = (value: TableOpValue) => ({
  ...value,
  type: "drop_unique_constraint" as const,
});
