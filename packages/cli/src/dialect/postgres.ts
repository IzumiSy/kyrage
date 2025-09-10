import { PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { KyrageDialectInterface } from "./types";
import { DBClient } from "../client";
import { ReferentialActions } from "../operation";

export class PostgresKyrageDialect implements KyrageDialectInterface {
  getName() {
    return "postgres" as const;
  }

  createKyselyDialect(connectionString: string) {
    return new PostgresDialect({
      pool: new Pool({ connectionString }),
    });
  }

  createIntrospectionDriver(client: DBClient) {
    return postgresExtraIntrospectorDriver({ client });
  }

  createDevContainer(image: string, name?: string) {
    const container = new PostgreSqlContainer(image);
    if (name) {
      container.withName(name);
    }
    return container;
  }

  getDefaultImage() {
    return "postgres:16";
  }
}

export const postgresExtraIntrospectorDriver = (props: {
  client: DBClient;
}) => {
  const nameDict = {
    bool: "boolean",
    int2: "smallint",
    int4: "integer",
    int8: "bigint",
  };

  const convertTypeName = (typeName: string) =>
    nameDict[typeName as keyof typeof nameDict] ?? typeName;

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
          n.nspname AS schema,
          t.relname AS table,
          c.conname AS name,
          CASE c.contype
              WHEN 'p' THEN 'PRIMARY KEY'
              WHEN 'u' THEN 'UNIQUE'
              WHEN 'f' THEN 'FOREIGN KEY'
          END AS type,
          jsonb_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS columns,
          -- Foreign Key専用の情報
          CASE 
              WHEN c.contype = 'f' THEN rt.relname 
              ELSE NULL 
          END AS referenced_table,
          CASE 
              WHEN c.contype = 'f' THEN jsonb_agg(ra.attname ORDER BY array_position(c.confkey, ra.attnum))
              ELSE NULL 
          END AS referenced_columns,
          CASE 
              WHEN c.contype = 'f' THEN 
                  CASE c.confdeltype
                      WHEN 'c' THEN 'cascade'
                      WHEN 'n' THEN 'set null'
                      WHEN 'd' THEN 'set default'
                      WHEN 'r' THEN 'restrict'
                      WHEN 'a' THEN 'no action'
                  END
              ELSE NULL
          END AS on_delete,
          CASE 
              WHEN c.contype = 'f' THEN 
                  CASE c.confupdtype
                      WHEN 'c' THEN 'cascade'
                      WHEN 'n' THEN 'set null'
                      WHEN 'd' THEN 'set default'
                      WHEN 'r' THEN 'restrict'
                      WHEN 'a' THEN 'no action'
                  END
              ELSE NULL
          END AS on_update
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      -- Foreign Key用のJOIN
      LEFT JOIN pg_class rt ON c.confrelid = rt.oid
      LEFT JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = ANY(c.confkey)
      WHERE c.contype IN ('p', 'u', 'f')  -- primary key, unique, foreign key constraints
          AND n.nspname = 'public'
          AND NOT a.attisdropped
          AND (c.contype != 'f' OR NOT ra.attisdropped)  -- Foreign Key用の条件
      GROUP BY n.nspname, t.relname, c.conname, c.contype, c.oid, c.conkey, t.oid, 
               rt.relname, c.confkey, c.confdeltype, c.confupdtype
      ORDER BY t.relname, c.conname;
    `
      .$castTo<PostgresConstraint>()
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
            ...columns
          } = row;

          return {
            ...columns,
            referencedTable,
            referencedColumns,
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

type PostgresColumnInfo = {
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
  column_names: ReadonlyArray<string>;
};

type PostgresConstraintBase = {
  schema: string;
  table: string;
  name: string;
  columns: ReadonlyArray<string>;
};

type PostgresForeignKeyConstraint = {
  referenced_table: string;
  referenced_columns: ReadonlyArray<string>;
  on_delete?: ReferentialActions;
  on_update?: ReferentialActions;
};

type PostgresConstraint =
  | (PostgresConstraintBase & {
      type: "PRIMARY KEY";
    })
  | (PostgresConstraintBase & {
      type: "UNIQUE";
    })
  | (PostgresConstraintBase &
      PostgresForeignKeyConstraint & {
        type: "FOREIGN KEY";
      });
