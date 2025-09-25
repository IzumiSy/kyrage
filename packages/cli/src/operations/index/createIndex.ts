import z from "zod";
import { tableOpSchemaBase } from "../shared/types";
import { IndexSchema } from "../../config/loader";
import { defineOperation } from "../shared/operation";

export const createIndexOp = defineOperation({
  typeName: "create_index",
  schema: z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("create_index"),
    columns: z.array(z.string()).readonly(),
    unique: z.boolean(),
  }),
  execute: async (db, operation) => {
    let builder = db.schema.createIndex(operation.name).on(operation.table);

    for (const column of operation.columns) {
      builder = builder.column(column);
    }

    if (operation.unique) {
      builder = builder.unique();
    }

    await builder.execute();
  },
});

export const createIndex = (value: IndexSchema) => ({
  ...value,
  type: "create_index" as const,
});
