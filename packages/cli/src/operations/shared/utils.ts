import { ColumnDataType, isColumnDataType, Kysely, MysqlAdapter } from "kysely";

/** Detects MySQL-compatible SQL behavior, including MariaDB and plan mode. */
export const isMysqlDatabase = (db: Kysely<unknown>) =>
  db.getExecutor().adapter instanceof MysqlAdapter;

export const assertDataType: (
  dataType: string
) => asserts dataType is ColumnDataType = (dataType) => {
  if (!isColumnDataType(dataType)) {
    throw new Error(`Unsupported data type: ${dataType}`);
  }
};
