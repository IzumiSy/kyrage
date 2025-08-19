import { z } from "zod";
import {
  ForeignKeyConstraint,
  foreignKeyConstraintSchema,
  PrimaryKeyConstraint,
  primaryKeyConstraintSchema,
  ReferentialActions,
  tableColumnOpSchemaBase,
  tableOpSchemaBase,
  UniqueConstraint,
  uniqueConstraintSchema,
} from "./schema";

// TableColumnAttributesのスキーマを直接定義
const tableColumnAttributesSchema = z
  .object({
    type: z.string(),
  })
  .catchall(z.any());

export type TableColumnAttributes = z.infer<typeof tableColumnAttributesSchema>;

// Operation型定義
export const operationSchema = z.discriminatedUnion("type", [
  // Table operations
  z.object({
    type: z.literal("create_table"),
    table: z.string(),
    columns: z.record(z.string(), tableColumnAttributesSchema),
  }),
  z.object({
    type: z.literal("drop_table"),
    table: z.string(),
  }),

  // Column operations
  z.object({
    ...tableColumnOpSchemaBase,
    type: z.literal("add_column"),
    attributes: tableColumnAttributesSchema,
  }),
  z.object({
    ...tableColumnOpSchemaBase,
    type: z.literal("drop_column"),
    attributes: tableColumnAttributesSchema,
  }),
  z.object({
    ...tableColumnOpSchemaBase,
    type: z.literal("alter_column"),
    before: tableColumnAttributesSchema,
    after: tableColumnAttributesSchema,
  }),

  // Index operations
  z.object({
    ...tableOpSchemaBase,
    type: z.literal("create_index"),
    columns: z.array(z.string()),
    unique: z.boolean(),
  }),
  z.object({
    ...tableOpSchemaBase,
    type: z.literal("drop_index"),
  }),

  // Primary key constraint operations
  z.object({
    ...primaryKeyConstraintSchema.shape,
    type: z.literal("create_primary_key_constraint"),
  }),
  z.object({
    ...tableOpSchemaBase,
    type: z.literal("drop_primary_key_constraint"),
  }),

  // Unique constraint operations
  z.object({
    ...uniqueConstraintSchema.shape,
    type: z.literal("create_unique_constraint"),
  }),
  z.object({
    ...tableOpSchemaBase,
    type: z.literal("drop_unique_constraint"),
  }),

  // Foreign key constraint operations
  z.object({
    ...foreignKeyConstraintSchema.shape,
    type: z.literal("create_foreign_key_constraint"),
  }),
  z.object({
    ...tableOpSchemaBase,
    type: z.literal("drop_foreign_key_constraint"),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;

// 新しいSchemaDiff型
export const schemaDiffSchema = z.object({
  operations: z.array(operationSchema),
});

export type SchemaDiff = z.infer<typeof schemaDiffSchema>;

// Index定義型
export const indexDefSchema = z.object({
  ...tableOpSchemaBase,
  columns: z.array(z.string()),
  unique: z.boolean(),
});

export type IndexDef = z.infer<typeof indexDefSchema>;

// Tables型定義
export type Tables = Array<{
  name: string;
  columns: Record<string, TableColumnAttributes>;
}>;

export type SchemaSnapshot = {
  tables: Tables;
  indexes: IndexDef[];
  primaryKeyConstraints: PrimaryKeyConstraint[];
  uniqueConstraints: UniqueConstraint[];
  foreignKeyConstraints: ForeignKeyConstraint[];
};

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
    table: string,
    column: string,
    attributes: TableColumnAttributes
  ) => ({
    type: "add_column" as const,
    table,
    column,
    attributes,
  }),

  dropColumn: (
    table: string,
    column: string,
    attributes: TableColumnAttributes
  ) => ({
    type: "drop_column" as const,
    table,
    column,
    attributes,
  }),

  alterColumn: (
    table: string,
    column: string,
    before: TableColumnAttributes,
    after: TableColumnAttributes
  ) => ({
    type: "alter_column" as const,
    table,
    column,
    before,
    after,
  }),

  createIndex: (
    table: string,
    name: string,
    columns: string[],
    unique: boolean
  ) => ({
    type: "create_index" as const,
    table,
    name,
    columns,
    unique,
  }),

  dropIndex: (table: string, name: string) => ({
    type: "drop_index" as const,
    table,
    name,
  }),

  createPrimaryKeyConstraint: (
    table: string,
    name: string,
    columns: string[]
  ) => ({
    type: "create_primary_key_constraint" as const,
    table,
    name,
    columns,
  }),

  dropPrimaryKeyConstraint: (table: string, name: string) => ({
    type: "drop_primary_key_constraint" as const,
    table,
    name,
  }),

  createUniqueConstraint: (table: string, name: string, columns: string[]) => ({
    type: "create_unique_constraint" as const,
    table,
    name,
    columns,
  }),

  dropUniqueConstraint: (table: string, name: string) => ({
    type: "drop_unique_constraint" as const,
    table,
    name,
  }),

  createForeignKeyConstraint: (
    table: string,
    name: string,
    columns: string[],
    referencedTable: string,
    referencedColumns: string[],
    onDelete?: ReferentialActions,
    onUpdate?: ReferentialActions
  ) => ({
    type: "create_foreign_key_constraint" as const,
    table,
    name,
    columns,
    referencedTable,
    referencedColumns,
    onDelete,
    onUpdate,
  }),

  dropForeignKeyConstraint: (table: string, name: string) => ({
    type: "drop_foreign_key_constraint" as const,
    table,
    name,
  }),
};
