import z from "zod";
import { IndexSchema } from "./config/loader";
import { createTableOp } from "./operations/table/createTable";

const tableColumnAttributesSchema = z
  .object({
    type: z.string(),
  })
  .catchall(z.any());

export type TableColumnAttributes = z.infer<typeof tableColumnAttributesSchema>;

// Tables型定義
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

const referentialActionsSchema = z.enum([
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

// create_table_with_constraints用のスキーマ定義
export const createTableWithConstraintsSchema = z.object({
  type: z.literal("create_table_with_constraints"),
  table: z.string(),
  columns: z.record(z.string(), tableColumnAttributesSchema),
  constraints: z
    .object({
      primaryKey: z
        .object({
          name: z.string(),
          columns: z.array(z.string()).readonly(),
        })
        .optional(),
      unique: z
        .array(
          z.object({
            name: z.string(),
            columns: z.array(z.string()).readonly(),
          })
        )
        .readonly()
        .optional(),
    })
    .optional(),
});

// Operation型定義
export const operationSchema = z.discriminatedUnion("type", [
  // Table operations with constraints
  createTableWithConstraintsSchema,
  // Table operations
  createTableOp.schema,
  z.object({
    type: z.literal("drop_table"),
    table: z.string(),
  }),

  // Column operations
  z.object({
    ...tableColumnOpSchemaBase.shape,
    type: z.literal("add_column"),
    attributes: tableColumnAttributesSchema,
  }),
  z.object({
    ...tableColumnOpSchemaBase.shape,
    type: z.literal("drop_column"),
    attributes: tableColumnAttributesSchema,
  }),
  z.object({
    ...tableColumnOpSchemaBase.shape,
    type: z.literal("alter_column"),
    before: tableColumnAttributesSchema,
    after: tableColumnAttributesSchema,
  }),

  // Index operations
  z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("create_index"),
    columns: z.array(z.string()).readonly(),
    unique: z.boolean(),
  }),
  z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_index"),
  }),

  // Primary key constraint operations
  z.object({
    ...primaryKeyConstraintSchema.shape,
    type: z.literal("create_primary_key_constraint"),
  }),
  z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_primary_key_constraint"),
  }),

  // Unique constraint operations
  z.object({
    ...uniqueConstraintSchema.shape,
    type: z.literal("create_unique_constraint"),
  }),
  z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_unique_constraint"),
  }),

  // Foreign key constraint operations
  z.object({
    ...foreignKeyConstraintSchema.shape,
    type: z.literal("create_foreign_key_constraint"),
  }),
  z.object({
    ...tableOpSchemaBase.shape,
    type: z.literal("drop_foreign_key_constraint"),
  }),
]);
export type Operation = z.infer<typeof operationSchema>;

// Operation creation helpers namespace
export const ops = {
  createTable: (
    table: string,
    columns: Record<string, TableColumnAttributes>
  ) => ({
    type: "create_table" as const,
    table,
    columns,
  }),

  dropTable: (table: string) => ({
    type: "drop_table" as const,
    table,
  }),

  addColumn: (
    tableColumn: TableColumnOpValue,
    attributes: TableColumnAttributes
  ) => ({
    ...tableColumn,
    type: "add_column" as const,
    attributes,
  }),

  dropColumn: (
    tableColumn: TableColumnOpValue,
    attributes: TableColumnAttributes
  ) => ({
    ...tableColumn,
    type: "drop_column" as const,
    attributes,
  }),

  alterColumn: (
    tableColumn: TableColumnOpValue,
    before: TableColumnAttributes,
    after: TableColumnAttributes
  ) => ({
    ...tableColumn,
    type: "alter_column" as const,
    before,
    after,
  }),

  createIndex: (value: IndexSchema) => ({
    ...value,
    type: "create_index" as const,
  }),

  dropIndex: (value: TableOpValue) => ({
    ...value,
    type: "drop_index" as const,
  }),

  createPrimaryKeyConstraint: (value: PrimaryKeyConstraintSchema) => ({
    ...value,
    type: "create_primary_key_constraint" as const,
  }),

  dropPrimaryKeyConstraint: (value: TableOpValue) => ({
    ...value,
    type: "drop_primary_key_constraint" as const,
  }),

  createUniqueConstraint: (value: UniqueConstraintSchema) => ({
    ...value,
    type: "create_unique_constraint" as const,
  }),

  dropUniqueConstraint: (value: TableOpValue) => ({
    ...value,
    type: "drop_unique_constraint" as const,
  }),

  createForeignKeyConstraint: (
    tableOpValue: TableOpValue,
    options: {
      columns: ReadonlyArray<string>;
      referencedTable: string;
      referencedColumns: ReadonlyArray<string>;
      onDelete?: ReferentialActions;
      onUpdate?: ReferentialActions;
    }
  ) => ({
    ...tableOpValue,
    ...options,
    type: "create_foreign_key_constraint" as const,
  }),

  dropForeignKeyConstraint: (value: TableOpValue) => ({
    ...value,
    type: "drop_foreign_key_constraint" as const,
  }),

  createTableWithConstraints: (
    table: string,
    columns: Record<string, TableColumnAttributes>,
    constraints?: {
      primaryKey?: { name: string; columns: ReadonlyArray<string> };
      unique?: ReadonlyArray<{ name: string; columns: ReadonlyArray<string> }>;
    }
  ) => ({
    type: "create_table_with_constraints" as const,
    table,
    columns,
    constraints,
  }),
};
