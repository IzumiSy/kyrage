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

    const { rows } = await sql`
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        pg_index.indisunique AS is_unique,
        jsonb_agg(a.attname ORDER BY array_position(pg_index.indkey, a.attnum)) AS column_names,
        (pg_index.indisprimary OR EXISTS (
          SELECT 1 FROM pg_constraint con
          WHERE con.conindid = i.oid
          AND con.contype IN ('p', 'u')
        )) AS is_system_generated
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ON pg_index.indrelid = t.oid
      JOIN pg_class i ON i.oid = pg_index.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (pg_index.indkey)
      WHERE t.relkind = 'r'
        AND n.nspname = 'public'
      GROUP BY t.relname, i.relname, pg_index.indisunique, pg_index.indisprimary, i.oid;
    `
      .$castTo<PostgresIndexInfo>()
      .execute(db);
    return rows.map((r) => ({
      table: r.table_name,
      name: r.index_name,
      columns: r.column_names,
      unique: r.is_unique,
      systemGenerated: r.is_system_generated,
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
          array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS columns,
                    -- Determine if constraint is system-generated (from column definitions)
          -- Check if constraint has automatic dependency in pg_depend
          CASE 
              WHEN EXISTS (
                  SELECT 1 FROM pg_depend d
                  WHERE d.objid = c.oid 
                  AND d.deptype = 'a'  -- automatic dependency
                  AND d.classid = 'pg_constraint'::regclass
                  AND d.refclassid = 'pg_class'::regclass
                  AND d.refobjid = t.oid
              ) THEN TRUE
              ELSE FALSE
          END AS is_system_generated
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
        is_system_generated: boolean;
      }>()
      .execute(db);

    return rows.map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      name: row.constraint_name,
      type: row.constraint_type,
      columns: row.columns,
      systemGenerated: row.is_system_generated,
    }));
  };

  return {
    introspectTables,
    introspectIndexes,
    introspectConstraints,
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
  is_system_generated: boolean;
};
