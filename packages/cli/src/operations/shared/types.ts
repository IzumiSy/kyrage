import z from "zod";
import { IndexSchema } from "../../config/loader";

export const tableColumnAttributesSchema = z
  .object({
    type: z.string(),
  })
  .catchall(z.any());

export type TableColumnAttributes = z.infer<typeof tableColumnAttributesSchema>;

export type Tables = ReadonlyArray<{
  name: string;
  columns: Record<string, TableColumnAttributes>;
}>;

export type SchemaSnapshot = {
  tables: Tables;
  indexes: ReadonlyArray<IndexSchema>;
  primaryKeyConstraints: ReadonlyArray<PrimaryKeyConstraintSchema>;
  uniqueConstraints: ReadonlyArray<UniqueConstraintSchema>;
  foreignKeyConstraints: ReadonlyArray<ForeignKeyConstraintSchema>;
};

export const tableOpSchemaBase = z.object({
  table: z.string(),
  name: z.string(),
});
export type TableOpValue = z.infer<typeof tableOpSchemaBase>;

export const tableColumnOpSchemaBase = z.object({
  table: z.string(),
  column: z.string(),
});
export type TableColumnOpValue = z.infer<typeof tableColumnOpSchemaBase>;

export const primaryKeyConstraintSchema = z.object({
  ...tableOpSchemaBase.shape,
  columns: z.array(z.string()).readonly(),
});
export type PrimaryKeyConstraintSchema = z.infer<
  typeof primaryKeyConstraintSchema
>;

export const uniqueConstraintSchema = z.object({
  ...tableOpSchemaBase.shape,
  columns: z.array(z.string()).readonly(),
});
export type UniqueConstraintSchema = z.infer<typeof uniqueConstraintSchema>;

export const referentialActionsSchema = z.enum([
  "cascade",
  "set null",
  "set default",
  "restrict",
  "no action",
]);
export type ReferentialActions = z.infer<typeof referentialActionsSchema>;

export const foreignKeyConstraintSchema = z.object({
  ...tableOpSchemaBase.shape,
  columns: z.array(z.string()).readonly(),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()).readonly(),
  onDelete: referentialActionsSchema.optional(),
  onUpdate: referentialActionsSchema.optional(),
});
export type ForeignKeyConstraintSchema = z.infer<
  typeof foreignKeyConstraintSchema
>;
