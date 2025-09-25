import z from "zod";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";
import { defineOperation } from "../shared/operation";

export const dropIndexOp = defineOperation({
  typeName: "drop_index",
  schema: z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_index"),
  }),
  execute: async (db, operation) => {
    await db.schema.dropIndex(operation.name).execute();
  },
});

export const dropIndex = (value: TableOpValue) => ({
  ...value,
  type: "drop_index" as const,
});
