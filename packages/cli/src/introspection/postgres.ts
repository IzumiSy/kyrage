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

export const postgresExtraIntrospector = (props: { client: DBClient }) => {
  const introspectTables = async () => {
    const client = props.client;
    await using db = client.getDB();
    const { rows } = await sql`
      SELECT
          c.table_schema,
          c.table_name,
          c.column_name,
          c.column_default,
          c.character_maximum_length,
          tc.constraint_name,
          tc.constraint_type
      FROM information_schema.columns c
      JOIN information_schema.key_column_usage kcu
          ON c.table_name = kcu.table_name
          AND c.column_name = kcu.column_name
          AND c.table_schema = kcu.table_schema
      JOIN information_schema.table_constraints tc
          ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
          AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position;
    `
      .$castTo<PostgresColumnConstraintInfo>()
      .execute(db);

    return rows.map((row) => ({
      schema: row.table_schema,
      table: row.table_name,
      name: row.column_name,
      default: row.column_default,
      characterMaximumLength: row.character_maximum_length,
      constraint: {
        name: row.constraint_name,
        type: row.constraint_type,
      },
    }));
  };

  const introspectIndexes = async () => {
    const client = props.client;
    await using db = client.getDB();
    // NOTE: Exclude primary key physical indexes; keep unique ones.
    const { rows } = await sql`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        pg_index.indisunique AS is_unique,
        array_agg(a.attname ORDER BY array_position(pg_index.indkey, a.attnum)) AS column_names
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ON pg_index.indrelid = t.oid
      JOIN pg_class i ON i.oid = pg_index.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (pg_index.indkey)
      WHERE t.relkind = 'r'
        AND n.nspname = 'public'
        AND NOT i.relname LIKE '%_pkey'
      GROUP BY t.relname, i.relname, pg_index.indisunique;
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

  return {
    introspectTables,
    introspectIndexes,
    convertTypeName,
  };
};

export type PostgresColumnConstraintInfo = {
  table_schema: string;
  table_name: string;
  column_name: string;
  column_default: string | null;
  character_maximum_length: number | null;
  constraint_name: string;
  constraint_type: "UNIQUE" | "PRIMARY KEY";
};

type PostgresIndexInfo = {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  column_names: string[];
};
