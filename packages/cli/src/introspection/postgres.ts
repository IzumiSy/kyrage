import { sql } from "kysely";
import { DBClient } from "../client";

const nameDict = {
  bool: "boolean",
  int2: "smallint",
  int4: "integer",
  int8: "bigint",
};

const convertTypeName = (typeName: string) =>
  nameDict[typeName as keyof typeof nameDict] ?? typeName;

export const postgresExtraIntrospectorDriver = (props: {
  client: DBClient;
}) => {
  const introspectTables = async () => {
    const client = props.client;
    await using db = client.getDB();
    const { rows } = await sql`
      SELECT
        n.nspname AS table_schema,
        c.relname AS table_name,
        a.attname AS column_name,
        pg_get_expr(d.adbin, d.adrelid) AS column_default,
        CASE 
          WHEN t.typname = 'varchar' OR t.typname = 'char' THEN a.atttypmod - 4
          ELSE NULL 
        END AS character_maximum_length
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      JOIN pg_type t ON t.oid = a.atttypid
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum;
    `
      .$castTo<PostgresColumnInfo>()
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
    await using db = client.getDB();

    const { rows } = await sql`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        pg_index.indisunique AS is_unique,
        jsonb_agg(a.attname ORDER BY array_position(pg_index.indkey, a.attnum)) AS column_names
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ON pg_index.indrelid = t.oid
      JOIN pg_class i ON i.oid = pg_index.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (pg_index.indkey)
      WHERE t.relkind = 'r'
        AND n.nspname = 'public'
        AND NOT pg_index.indisprimary
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
          WHERE con.conindid = i.oid
          AND con.contype IN ('p', 'u')
        )
      GROUP BY t.relname, i.relname, pg_index.indisunique, pg_index.indisprimary, i.oid;
    `
      .$castTo<PostgresIndexInfo>()
      .execute(db);
    return rows.map((r) => ({
      table: r.table_name,
      name: r.index_name,
      columns: r.column_names,
      unique: r.is_unique,
    }));
  };

  const introspectConstraints = async () => {
    const client = props.client;
    await using db = client.getDB();
    const { rows } = await sql`
      SELECT
          n.nspname AS schema_name,
          t.relname AS table_name,
          c.conname AS constraint_name,
          CASE c.contype
              WHEN 'p' THEN 'PRIMARY KEY'
              WHEN 'u' THEN 'UNIQUE'
          END AS constraint_type,
          jsonb_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS columns
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      WHERE c.contype IN ('p', 'u')  -- primary key and unique constraints
          AND n.nspname = 'public'
          AND NOT a.attisdropped
      GROUP BY n.nspname, t.relname, c.conname, c.contype, c.oid, c.conkey, t.oid
      ORDER BY t.relname, c.conname;
    `
      .$castTo<{
        schema_name: string;
        table_name: string;
        constraint_name: string;
        constraint_type: "PRIMARY KEY" | "UNIQUE";
        columns: string[];
      }>()
      .execute(db);

    return rows.map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      name: row.constraint_name,
      type: row.constraint_type,
      columns: row.columns,
    }));
  };

  return {
    introspectTables,
    introspectIndexes,
    introspectConstraints,
    convertTypeName,
  };
};

export type PostgresColumnInfo = {
  table_schema: string;
  table_name: string;
  column_name: string;
  column_default: string | null;
  character_maximum_length: number | null;
};

type PostgresIndexInfo = {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  column_names: string[];
};

export type PostgresConstraint = {
  schema: string;
  table: string;
  name: string;
  type: "PRIMARY KEY" | "UNIQUE";
  columns: string[];
};

export type PostgresConstraints = {
  primaryKey: PostgresConstraint[];
  unique: PostgresConstraint[];
};
