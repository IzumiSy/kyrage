import { sql, type Kysely } from "kysely";

/** Native column facts shared by schema introspection and operation validation. */
export type MysqlColumnMetadata = {
  table_schema: string;
  table_name: string;
  column_name: string;
  column_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  character_maximum_length: number | null;
  extra: string;
  column_comment: string;
  custom_collation: number | null;
};

/** Reads current column definitions without deciding whether an operation is safe. */
export const readMysqlColumnMetadata = async (db: Kysely<any>) => {
  const { rows } = await sql`
    SELECT
      c.TABLE_SCHEMA as table_schema,
      c.TABLE_NAME as table_name,
      c.COLUMN_NAME as column_name,
      c.COLUMN_TYPE as column_type,
      c.IS_NULLABLE as is_nullable,
      CASE
        WHEN VERSION() LIKE '%MariaDB%' THEN NULLIF(c.COLUMN_DEFAULT, 'NULL')
        WHEN c.EXTRA LIKE '%DEFAULT_GENERATED%' AND c.COLUMN_DEFAULT IS NOT NULL
          THEN CONCAT('(', c.COLUMN_DEFAULT, ')')
        WHEN c.COLUMN_DEFAULT IS NOT NULL
          AND c.DATA_TYPE IN ('char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext',
                              'binary', 'varbinary', 'date', 'datetime', 'time', 'timestamp')
          THEN QUOTE(c.COLUMN_DEFAULT)
        ELSE c.COLUMN_DEFAULT
      END as column_default,
      c.CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
      c.EXTRA as extra,
      c.COLUMN_COMMENT as column_comment,
      c.COLLATION_NAME != t.TABLE_COLLATION as custom_collation
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
    WHERE c.TABLE_SCHEMA = DATABASE()
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;
  `
    .$castTo<MysqlColumnMetadata>()
    .execute(db);

  return rows;
};
