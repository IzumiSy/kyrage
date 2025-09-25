import z from "zod";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";
import { defineOperation } from "../shared/operation";

export const dropPrimaryKeyConstraintOp = defineOperation({
  typeName: "drop_primary_key_constraint",
  schema: z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_primary_key_constraint"),
  }),
  execute: async (db, operation) => {
    await db.schema
      .alterTable(operation.table)
      .dropConstraint(operation.name)
      .execute();
  },
});

export const dropPrimaryKeyConstraint = (value: TableOpValue) => ({
  ...value,
  type: "drop_primary_key_constraint" as const,
});
