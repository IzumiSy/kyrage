import { sql } from "kysely";
import { DBClient } from "../client";

export const postgresColumnExtraIntrospector = (props: {
  client: DBClient;
}) => {
  const introspect = async () => {
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

  return {
    introspect,
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
