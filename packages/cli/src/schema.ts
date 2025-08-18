import { z } from "zod";
import { schemaDiffSchema } from "./operation";

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
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean().default(false),
});
export type IndexValue = z.infer<typeof indexSchema>;

const primaryKeyConstraintSchema = z.object({
  table: z.string(),
  name: z.string(),
  columns: z.array(z.string()),
});

const uniqueConstraintSchema = z.object({
  table: z.string(),
  name: z.string(),
  columns: z.array(z.string()),
});

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
  indexes: z.array(indexSchema),
  primaryKeyConstraints: z.array(primaryKeyConstraintSchema),
  uniqueConstraints: z.array(uniqueConstraintSchema),
});
export type ConfigValue = z.infer<typeof configSchema>;

export const migrationSchema = z.object({
  id: z.string(),
  version: z.string(),
  diff: schemaDiffSchema,
});

export type MigrationValue = z.infer<typeof migrationSchema>;
