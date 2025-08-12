import { z } from "zod";

const columnSchema = z.object({
  type: z.string(),
  primaryKey: z.boolean().optional().default(false),
  notNull: z.boolean().optional().default(false),
  unique: z.boolean().optional().default(false),
  defaultSql: z.string().optional(),
});
export type ColumnValue = z.infer<typeof columnSchema>;

const tableSchema = z.object({
  tableName: z.string(),
  columns: z.record(z.string(), columnSchema),
});

const indexSchema = z.object({
  table: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean().optional(),
});
export type IndexValue = z.infer<typeof indexSchema>;

const dialectEnum = z.enum(["postgres", "cockroachdb", "mysql", "sqlite"]);
export type DialectEnum = z.infer<typeof dialectEnum>;

const databaseSchema = z.object({
  dialect: dialectEnum,
  connectionString: z.string(),
});
export type DatabaseValue = z.infer<typeof databaseSchema>;

export const configSchema = z.object({
  database: databaseSchema,
  tables: z.array(tableSchema),
  indexes: z.array(indexSchema).optional(),
});
export type ConfigValue = z.infer<typeof configSchema>;

export const migrationSchema = z.object({
  id: z.string(),
  version: z.string(),
  diff: z.any(), // Placeholder for TableDiff type
});
