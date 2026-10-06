import z from "zod";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";
import { defineOperation } from "../shared/operation";
import { isMysqlDatabase } from "../shared/utils";

/** Drops an index, qualifying its table when MySQL requires it. */
export const dropIndexOp = defineOperation({
  typeName: "drop_index",
  schema: z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_index"),
  }),
  execute: async (db, operation) => {
    let builder = db.schema.dropIndex(operation.name);
    if (isMysqlDatabase(db)) builder = builder.on(operation.table);
    await builder.execute();
  },
});

export const dropIndex = (value: TableOpValue) => ({
  ...value,
  type: "drop_index" as const,
});
