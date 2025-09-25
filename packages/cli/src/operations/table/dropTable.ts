import z from "zod";
import { defineOperation } from "../shared/operation";

export const dropTableOp = defineOperation({
  typeName: "drop_table",
  schema: z.object({
    type: z.literal("drop_table"),
    table: z.string(),
  }),
  execute: async (db, operation) => {
    await db.schema.dropTable(operation.table).execute();
  },
});

export const dropTable = (table: string) => ({
  type: "drop_table" as const,
  table,
});
