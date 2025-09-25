import z from "zod";
import { Kysely } from "kysely";

export const dropTableSchema = z.object({
  type: z.literal("drop_table"),
  table: z.string(),
});

export type DropTableOperation = z.infer<typeof dropTableSchema>;

export async function executeDropTable(
  db: Kysely<any>,
  operation: DropTableOperation
) {
  await db.schema.dropTable(operation.table).execute();
}

export const dropTable = (table: string): DropTableOperation => ({
  type: "drop_table" as const,
  table,
});
