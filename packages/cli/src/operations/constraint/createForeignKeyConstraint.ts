import z from "zod";
import {
  foreignKeyConstraintSchema,
  TableOpValue,
  ReferentialActions,
} from "../shared/types";
import { defineOperation } from "../shared/operation";

export const createForeignKeyConstraintOp = defineOperation({
  typeName: "create_foreign_key_constraint",
  schema: z.object({
    ...foreignKeyConstraintSchema.shape,
    type: z.literal("create_foreign_key_constraint"),
  }),
  execute: async (db, operation) => {
    let builder = db.schema
      .alterTable(operation.table)
      .addForeignKeyConstraint(
        operation.name,
        operation.columns as Array<string>,
        operation.referencedTable,
        operation.referencedColumns as Array<string>
      );

    if (operation.onDelete) {
      builder = builder.onDelete(operation.onDelete);
    }
    if (operation.onUpdate) {
      builder = builder.onUpdate(operation.onUpdate);
    }

    await builder.execute();
  },
});

export const createForeignKeyConstraint = (
  tableOpValue: TableOpValue,
  options: {
    columns: ReadonlyArray<string>;
    referencedTable: string;
    referencedColumns: ReadonlyArray<string>;
    onDelete?: ReferentialActions;
    onUpdate?: ReferentialActions;
    inline?: boolean;
  }
) => ({
  ...tableOpValue,
  ...options,
  type: "create_foreign_key_constraint" as const,
});
