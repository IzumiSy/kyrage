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

export const tableOpSchemaBase = {
  table: z.string(),
  name: z.string(),
};
export const tableColumnOpSchemaBase = {
  table: z.string(),
  column: z.string(),
};

const indexSchema = z.object({
  ...tableOpSchemaBase,
  columns: z.array(z.string()),
  unique: z.boolean().default(false),
});
export type IndexValue = z.infer<typeof indexSchema>;

export const primaryKeyConstraintSchema = z.object({
  ...tableOpSchemaBase,
  columns: z.array(z.string()),
});
export type PrimaryKeyConstraint = z.infer<typeof primaryKeyConstraintSchema>;

export const uniqueConstraintSchema = z.object({
  ...tableOpSchemaBase,
  columns: z.array(z.string()),
});
export type UniqueConstraint = z.infer<typeof uniqueConstraintSchema>;

const referentialActionsSchema = z.enum([
  "cascade",
  "set null",
  "set default",
  "restrict",
  "no action",
]);
export type ReferentialActions = z.infer<typeof referentialActionsSchema>;

export const foreignKeyConstraintSchema = z.object({
  ...tableOpSchemaBase,
  columns: z.array(z.string()),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()),
  onDelete: referentialActionsSchema.optional(),
  onUpdate: referentialActionsSchema.optional(),
});
export type ForeignKeyConstraint = z.infer<typeof foreignKeyConstraintSchema>;

export type ForeignKeyConstraintValue = z.infer<
  typeof foreignKeyConstraintSchema
>;

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
  foreignKeyConstraints: z.array(foreignKeyConstraintSchema),
});
export type ConfigValue = z.infer<typeof configSchema>;

export const migrationSchema = z.object({
  id: z.string(),
  version: z.string(),
  diff: schemaDiffSchema,
});

export type MigrationValue = z.infer<typeof migrationSchema>;
