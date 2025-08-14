import { z } from "zod";

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
    type: z.literal("add_column"),
    table: z.string(),
    column: z.string(),
    attributes: tableColumnAttributesSchema,
  }),
  z.object({
    type: z.literal("drop_column"),
    table: z.string(),
    column: z.string(),
    attributes: tableColumnAttributesSchema,
  }),
  z.object({
    type: z.literal("alter_column"),
    table: z.string(),
    column: z.string(),
    before: tableColumnAttributesSchema,
    after: tableColumnAttributesSchema,
  }),

  // Index operations
  z.object({
    type: z.literal("create_index"),
    table: z.string(),
    name: z.string(),
    columns: z.array(z.string()),
    unique: z.boolean(),
  }),
  z.object({
    type: z.literal("drop_index"),
    table: z.string(),
    name: z.string(),
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
  table: z.string(),
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
  systemGenerated: z.boolean().default(false),
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
};
