import { sql } from "kysely";
import { PlannableKysely } from "../client";
import { ReferentialActions } from "../operation";
import { ConfigValue } from "../config/loader";
import { IndexAttributes, ConstraintAttributes } from "./types";
import * as R from "ramda";

export const introspectGenericTables = async (db: PlannableKysely) => {
  const { rows } = await sql`
    SELECT
      table_schema,
      table_name,
      column_name,
      column_default,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
      )
    ORDER BY table_name, ordinal_position;
  `
    .$castTo<InformationSchemaColumn>()
    .execute(db);

  return rows.map((row) => ({
    schema: row.table_schema,
    table: row.table_name,
    name: row.column_name,
    default: row.column_default,
    characterMaximumLength: row.character_maximum_length
      ? Number(row.character_maximum_length)
      : null,
  }));
};

type InformationSchemaColumn = {
  table_schema: string;
  table_name: string;
  column_name: string;
  column_default: string | null;
  character_maximum_length: number | null;
};

export const introspectGenericConstraints = async (db: PlannableKysely) => {
  const { rows } = await sql`
    -- Primary Key & Unique制約
    SELECT
      tc.constraint_schema AS schema,
      tc.table_name AS "table",
      tc.constraint_name AS name,
      tc.constraint_type AS type,
      jsonb_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
      NULL::text AS referenced_table,
      NULL::jsonb AS referenced_columns,
      NULL::text AS on_delete,
      NULL::text AS on_update
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    GROUP BY tc.constraint_schema, tc.table_name, tc.constraint_name, tc.constraint_type

    UNION ALL

    -- Foreign Key制約
    SELECT
      tc.constraint_schema AS schema,
      tc.table_name AS "table",
      tc.constraint_name AS name,
      tc.constraint_type AS type,
      jsonb_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
      kcu_ref.table_name AS referenced_table,
      jsonb_agg(kcu_ref.column_name ORDER BY kcu_ref.ordinal_position) AS referenced_columns,
      CASE rc.delete_rule
        WHEN 'CASCADE' THEN 'cascade'
        WHEN 'SET NULL' THEN 'set null'
        WHEN 'SET DEFAULT' THEN 'set default'
        WHEN 'RESTRICT' THEN 'restrict'
        WHEN 'NO ACTION' THEN 'no action'
        ELSE NULL
      END AS on_delete,
      CASE rc.update_rule
        WHEN 'CASCADE' THEN 'cascade'
        WHEN 'SET NULL' THEN 'set null'
        WHEN 'SET DEFAULT' THEN 'set default'
        WHEN 'RESTRICT' THEN 'restrict'
        WHEN 'NO ACTION' THEN 'no action'
        ELSE NULL
      END AS on_update
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.key_column_usage kcu_ref
      ON rc.unique_constraint_name = kcu_ref.constraint_name
      AND rc.unique_constraint_schema = kcu_ref.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
    GROUP BY tc.constraint_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
             kcu_ref.table_name, rc.delete_rule, rc.update_rule
    ORDER BY "table", name;
  `
    .$castTo<InformationSchemaConstraint>()
    .execute(db);

  return {
    primaryKey: rows
      .filter((row) => row.type === "PRIMARY KEY")
      .map((row) => ({
        name: row.name,
        schema: row.schema,
        table: row.table,
        type: row.type as "PRIMARY KEY",
        columns: row.columns,
      })),
    unique: rows
      .filter((row) => row.type === "UNIQUE")
      .map((row) => ({
        name: row.name,
        schema: row.schema,
        table: row.table,
        type: row.type as "UNIQUE",
        columns: row.columns,
      })),
    foreignKey: rows
      .filter((row) => row.type === "FOREIGN KEY")
      .map((row) => ({
        schema: row.schema,
        table: row.table,
        name: row.name,
        type: row.type as "FOREIGN KEY",
        columns: row.columns,
        referencedTable: row.referenced_table!,
        referencedColumns: row.referenced_columns!,
        onDelete: row.on_delete || undefined,
        onUpdate: row.on_update || undefined,
      })),
  };
};

type InformationSchemaConstraint = {
  schema: string;
  table: string;
  name: string;
  type: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY";
  columns: ReadonlyArray<string>;
  referenced_table: string | null;
  referenced_columns: ReadonlyArray<string> | null;
  on_delete: ReferentialActions | null;
  on_update: ReferentialActions | null;
};

/*
 * Some databases automatically creates unique constraints for unique indexes, and vice versa (e.g., CockroachDB),
 * and there is no way to distinguish between automatically generated unique constraints and user-defined unique constraints.
 * This function searches for user-defined unique constraints and indexes in the configuration and adopts what is present in the configuration.
 * If neither exists, it treats them as a difference.
 */
export const computeAutoGeneratedIndexesAndConstraints = (
  config: ConfigValue,
  props: {
    indexes: IndexAttributes;
    constraints: ConstraintAttributes;
  }
) => {
  const sameNameOnTable =
    (t: ReadonlyArray<unknown>) => (c: { name: string; table: string }) =>
      R.any(R.whereEq({ name: c.name, table: c.table }), t);
  const [adoptedUniqueConstraints, unconfiguredUniqueConstraints] = R.partition(
    sameNameOnTable(config.uniqueConstraints),
    props.constraints.unique
  );
  const [adoptedUniqueIndexes, unconfiguredUniqueIndexes] = R.partition(
    sameNameOnTable(config.indexes),
    props.indexes
  );
  const unrelatedUniqueConstraints = R.reject(
    sameNameOnTable(adoptedUniqueIndexes),
    unconfiguredUniqueConstraints
  );
  const unrelatedUniqueIndexes = R.reject(
    sameNameOnTable(adoptedUniqueConstraints),
    unconfiguredUniqueIndexes
  );

  return {
    indexes: [...adoptedUniqueIndexes, ...unrelatedUniqueIndexes],
    uniqueConstraints: [
      ...adoptedUniqueConstraints,
      ...unrelatedUniqueConstraints,
    ],
  };
};
