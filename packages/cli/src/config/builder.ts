import { ColumnValue, DatabaseValue } from "../schema";
import { ColumnDataType } from "kysely";

export const column = (
  type: ColumnDataType,
  options?: Partial<Omit<ColumnValue, "type">>
) => ({
  type,
  notNull: options?.notNull,
  primaryKey: options?.primaryKey,
  unique: options?.unique,
  defaultSql: options?.defaultSql,
});

type DefinedColumn = ReturnType<typeof column>;

export const defineTable = <T extends Record<string, DefinedColumn>>(
  name: string,
  columns: T
) => {
  return {
    tableName: name,
    columns,
  };
};

export type DefinedTable = ReturnType<typeof defineTable>;
export type DefinedTables = Array<DefinedTable>;

export type DefineConfigProp = {
  database: DatabaseValue;
  tables: DefinedTables;
};

export const defineConfig = (config: DefineConfigProp) => config;
