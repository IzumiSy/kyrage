import { sql } from "kysely";
import { DBClient } from "../client";
import {
  DatabaseColumnInfo,
  DatabaseIndexInfo,
  DatabaseConstraint,
} from "./type";

const nameDict = {
  INTEGER: "integer",
  BIGINT: "bigint",
  VARCHAR: "varchar",
  DECIMAL: "decimal",
  BOOLEAN: "boolean",
  DOUBLE: "double",
  REAL: "real",
  DATE: "date",
  TIMESTAMP: "timestamp",
  TIME: "time",
  FLOAT: "real",
  TINYINT: "smallint",
  SMALLINT: "smallint",
  UBIGINT: "bigint",
  UINTEGER: "integer",
  USMALLINT: "smallint",
  UTINYINT: "smallint",
};

const convertTypeName = (typeName: string) =>
  nameDict[typeName as keyof typeof nameDict] ?? typeName.toLowerCase();

export const duckdbExtraIntrospectorDriver = (props: { client: DBClient }) => {
  const introspectTables = async () => {
    const client = props.client;
    await using db = await client.getDB();

    const { rows } = await sql`
      SELECT 
        schema_name as table_schema,
        table_name,
        column_name,
        column_default,
        character_maximum_length
      FROM duckdb_columns()
      WHERE schema_name = 'main'
        AND NOT internal
      ORDER BY table_name, column_index
    `
      .$castTo<DatabaseColumnInfo>()
      .execute(db);

    return rows.map((row) => ({
      schema: row.table_schema,
      table: row.table_name,
      name: row.column_name,
      default: row.column_default,
      characterMaximumLength: row.character_maximum_length,
    }));
  };

  const introspectIndexes = async () => {
    const client = props.client;
    await using db = await client.getDB();

    const { rows } = await sql`
      SELECT 
        table_name,
        index_name,
        is_unique,
        expressions as column_names
      FROM duckdb_indexes()
      WHERE schema_name = 'main'
        AND NOT is_primary
    `
      .$castTo<DatabaseIndexInfo>()
      .execute(db);

    return rows.map((r) => ({
      table: r.table_name,
      name: r.index_name,
      columns: Array.isArray(r.column_names)
        ? r.column_names
        : [r.column_names],
      unique: r.is_unique,
    }));
  };

  const introspectConstraints = async () => {
    const client = props.client;
    await using db = await client.getDB();

    const { rows } = await sql`
      SELECT 
        schema_name as schema,
        table_name as table,
        constraint_name as name,
        constraint_type as type,
        constraint_column_names as columns,
        -- DuckDBでは外部キー情報は制限的なので、基本情報のみ取得
        NULL as referenced_table,
        NULL as referenced_columns,
        NULL as on_delete,
        NULL as on_update
      FROM duckdb_constraints()
      WHERE schema_name = 'main'
    `
      .$castTo<DatabaseConstraint>()
      .execute(db);

    return {
      primaryKey: rows.filter((row) => row.type === "PRIMARY KEY"),
      unique: rows.filter((row) => row.type === "UNIQUE"),
      foreignKey: rows
        .filter((row) => row.type === "FOREIGN KEY")
        .map((row) => {
          const {
            referenced_table: referencedTable,
            referenced_columns: referencedColumns,
            on_delete: onDelete,
            on_update: onUpdate,
            ...baseConstraint
          } = row;

          return {
            ...baseConstraint,
            referencedTable: referencedTable || "",
            referencedColumns: referencedColumns || [],
            onDelete,
            onUpdate,
          };
        }),
    };
  };

  return {
    introspectTables,
    introspectIndexes,
    introspectConstraints,
    convertTypeName,
  };
};
