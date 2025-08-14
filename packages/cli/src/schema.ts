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
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean().default(false),
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
  indexes: z.array(indexSchema),
});
export type ConfigValue = z.infer<typeof configSchema>;

// ---- Migration diff (SchemaDiff) zod schema ----
// Column attributes inside diff (open for future extension)
const tableColumnAttributesSchema = z
  .object({
    type: z.string(),
  })
  .catchall(z.any());

// Added/Removed/Changed tables
const addedTableSchema = z.object({
  table: z.string(),
  columns: z.record(z.string(), tableColumnAttributesSchema),
});
const removedTableSchema = z.string();

const addedColumnSchema = z.object({
  column: z.string(),
  attributes: tableColumnAttributesSchema,
});
const removedColumnSchema = z.object({
  column: z.string(),
  attributes: tableColumnAttributesSchema,
});
const changedColumnSchema = z.object({
  column: z.string(),
  before: tableColumnAttributesSchema,
  after: tableColumnAttributesSchema,
});
const changedTableSchema = z.object({
  table: z.string(),
  addedColumns: z.array(addedColumnSchema),
  removedColumns: z.array(removedColumnSchema),
  changedColumns: z.array(changedColumnSchema),
});

// Index diff schemas
const indexDefSchema = z.object({
  table: z.string(),
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
  systemGenerated: z.boolean().default(false),
});
const changedIndexSchema = z.object({
  table: z.string(),
  name: z.string(),
  before: indexDefSchema,
  after: indexDefSchema,
});

// Removed indexes keep table + name for safe dropping
const removedIndexSchema = z.object({ table: z.string(), name: z.string() });

export const schemaDiffSchema = z.object({
  addedTables: z.array(addedTableSchema),
  removedTables: z.array(removedTableSchema),
  changedTables: z.array(changedTableSchema),
  addedIndexes: z.array(indexDefSchema),
  removedIndexes: z.array(removedIndexSchema),
  changedIndexes: z.array(changedIndexSchema),
});
export type SchemaDiffValue = z.infer<typeof schemaDiffSchema>;

export const migrationSchema = z.object({
  id: z.string(),
  version: z.string(),
  diff: schemaDiffSchema,
});

export type MigrationValue = z.infer<typeof migrationSchema>;
