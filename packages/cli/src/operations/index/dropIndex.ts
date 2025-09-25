import z from "zod";
import { Kysely } from "kysely";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";

export const dropIndexSchema = z.object({
  ...tableOpSchemaBase.shape,
  type: z.literal("drop_index"),
});

export type DropIndexOperation = z.infer<typeof dropIndexSchema>;

export async function executeDropIndex(
  db: Kysely<any>,
  operation: DropIndexOperation
) {
  await db.schema.dropIndex(operation.name).execute();
}

export const dropIndex = (value: TableOpValue): DropIndexOperation => ({
  ...value,
  type: "drop_index" as const,
});
