import z from "zod";
import { loadConfig } from "c12";
import {
  tableOpSchemaBase,
  primaryKeyConstraintSchema,
  uniqueConstraintSchema,
  foreignKeyConstraintSchema,
} from "../operations/shared/types";
import { buildContainerDevDatabaseConfigSchema } from "../dev/providers/container";

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
  ...tableOpSchemaBase.shape,
  columns: z.array(z.string()).readonly(),
  unique: z.boolean().default(false),
});
export type IndexSchema = z.infer<typeof indexSchema>;

const dialectEnum = z.enum(["postgres", "cockroachdb"]);
export type DialectEnum = z.infer<typeof dialectEnum>;

const databaseSchema = z.object({
  dialect: dialectEnum,
  connectionString: z.string(),
});
export type DatabaseValue = z.infer<typeof databaseSchema>;

const devDatabaseSchema = z.union([
  // Container-based configuration
  buildContainerDevDatabaseConfigSchema({ defaultImage: "" }),
]);
export type DevDatabaseValue = z.infer<typeof devDatabaseSchema>;

export const configSchema = z.object({
  database: databaseSchema,
  dev: devDatabaseSchema.optional(),
  tables: z.array(tableSchema).readonly(),
  indexes: z.array(indexSchema).readonly(),
  primaryKeyConstraints: z.array(primaryKeyConstraintSchema).readonly(),
  uniqueConstraints: z.array(uniqueConstraintSchema).readonly(),
  foreignKeyConstraints: z.array(foreignKeyConstraintSchema).readonly(),
});
export type ConfigValue = z.infer<typeof configSchema>;

export const loadConfigFile = async () => {
  const loadedConfig = await loadConfig<ConfigValue>({
    name: "kyrage",
  });
  return configSchema.parse(loadedConfig.config);
};
