import z from "zod";
import { tableOpSchemaBase, TableOpValue } from "../shared/types";
import { defineOperation } from "../shared/operation";
import { sql } from "kysely";
import { isMysqlDatabase } from "../shared/utils";

/** Drops a primary key using the database's supported syntax. */
export const dropPrimaryKeyConstraintOp = defineOperation({
  typeName: "drop_primary_key_constraint",
  schema: z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_primary_key_constraint"),
  }),
  execute: async (db, operation) => {
    if (isMysqlDatabase(db)) {
      await sql`alter table ${sql.table(operation.table)} drop primary key`.execute(
        db,
      );
      return;
    }
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
