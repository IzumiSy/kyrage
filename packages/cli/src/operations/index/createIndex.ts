import z from "zod";
import { Kysely } from "kysely";
import { tableOpSchemaBase } from "../shared/types";
import { IndexSchema } from "../../config/loader";

export const createIndexSchema = z.object({
  ...tableOpSchemaBase.shape,
  type: z.literal("create_index"),
  columns: z.array(z.string()).readonly(),
  unique: z.boolean(),
});

export type CreateIndexOperation = z.infer<typeof createIndexSchema>;

export async function executeCreateIndex(
  db: Kysely<any>,
  operation: CreateIndexOperation
) {
  let builder = db.schema.createIndex(operation.name).on(operation.table);

  for (const column of operation.columns) {
    builder = builder.column(column);
  }

  if (operation.unique) {
    builder = builder.unique();
  }

  await builder.execute();
}

export const createIndex = (value: IndexSchema): CreateIndexOperation => ({
  ...value,
  type: "create_index" as const,
});
