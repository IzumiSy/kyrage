import { sql } from "kysely";
import type { SchemaAdapter, SchemaComparison } from "./schema-adapter";
import type {
  ForeignKeyConstraintSchema,
  Tables,
} from "../operations/shared/types";
import {
  assertColumnModificationAllowed,
  assertDataType,
} from "../operations/shared/utils";
import { createTableWithConstraintsOp } from "../operations/table/createTableWithConstraints";

/** PRIMARY is a catalog identifier, not a valid explicit MariaDB index name. */
const primaryKeySqlName = (name: string) =>
  name.toUpperCase() === "PRIMARY" ? "" : name;

/** Canonicalizes omitted type parameters and equivalent MySQL numeric aliases. */
const normalizeColumnType = (type: string) => {
  const defaults: Record<string, string> = {
    decimal: "decimal(10, 0)",
    numeric: "decimal(10, 0)",
    binary: "binary(1)",
    char: "char(1)",
  };
  return (
    defaults[type] ??
    type
      .replace(/^numeric\(/, "decimal(")
      .replace(/^(datetime|time|timestamp)\(0\)$/, "$1")
  );
};

/** Retains all column attributes while canonicalizing physical type spellings. */
const normalizeTables = (tables: Tables) =>
  tables.map((table) => ({
    ...table,
    columns: Object.fromEntries(
      Object.entries(table.columns).map(([name, column]) => [
        name,
        { ...column, type: normalizeColumnType(column.type) },
      ])
    ),
  }));

/** MySQL treats an omitted action, NO ACTION, and RESTRICT identically. */
const normalizeAction = (action: ForeignKeyConstraintSchema["onDelete"]) =>
  !action || action === "no action" ? "restrict" : action;

/** Aligns primary-key names with catalog identity and retains declared foreign-key actions. */
const prepareSchemaComparison = ({ current, ideal }: SchemaComparison) => ({
  current: {
    ...current,
    tables: normalizeTables(current.tables),
    foreignKeyConstraints: current.foreignKeyConstraints.map((key) => {
      const desired = ideal.foreignKeyConstraints.find(
        (candidate) =>
          candidate.table === key.table && candidate.name === key.name
      );
      return {
        ...key,
        onDelete:
          desired &&
          normalizeAction(key.onDelete) === normalizeAction(desired.onDelete)
            ? desired.onDelete
            : key.onDelete,
        onUpdate:
          desired &&
          normalizeAction(key.onUpdate) === normalizeAction(desired.onUpdate)
            ? desired.onUpdate
            : key.onUpdate,
      };
    }),
  },
  ideal: {
    ...ideal,
    tables: normalizeTables(ideal.tables),
    primaryKeyConstraints: ideal.primaryKeyConstraints.map((key) => ({
      ...key,
      name:
        current.primaryKeyConstraints.find(
          (existing) => existing.table === key.table
        )?.name ?? key.name,
    })),
  },
});

/** Shares MySQL/MariaDB comparison rules and nonstandard schema-operation SQL. */
export const mysqlSchemaAdapter: SchemaAdapter = {
  prepareSchemaComparison,
  operationExecutors: {
    create_primary_key_constraint: async (db, operation) => {
      await db.schema
        .alterTable(operation.table)
        .addPrimaryKeyConstraint(primaryKeySqlName(operation.name), [
          ...operation.columns,
        ])
        .execute();
    },
    create_table_with_constraints: async (db, operation) => {
      const primaryKey = operation.constraints?.primaryKey;
      await createTableWithConstraintsOp.execute(db, {
        ...operation,
        constraints: operation.constraints && {
          ...operation.constraints,
          primaryKey: primaryKey && {
            ...primaryKey,
            name: primaryKeySqlName(primaryKey.name),
          },
        },
      });
    },
    drop_primary_key_constraint: async (db, operation) => {
      await sql`alter table ${sql.table(operation.table)} drop primary key`.execute(
        db
      );
    },
    drop_foreign_key_constraint: async (db, operation) => {
      await sql`alter table ${sql.table(operation.table)} drop foreign key ${sql.id(operation.name)}`.execute(
        db
      );
    },
    drop_unique_constraint: async (db, operation) => {
      await db.schema
        .alterTable(operation.table)
        .dropIndex(operation.name)
        .execute();
    },
    drop_index: async (db, operation) => {
      await db.schema.dropIndex(operation.name).on(operation.table).execute();
    },
    alter_column: async (db, operation) => {
      const { table, column, before, after } = operation;
      assertColumnModificationAllowed(before, after);
      if (
        before.type === after.type &&
        Boolean(before.notNull) === Boolean(after.notNull)
      )
        return;
      assertDataType(after.type);
      await db.schema
        .alterTable(table)
        .modifyColumn(column, after.type, (col) => {
          let builder = after.notNull ? col.notNull() : col;
          const defaultSql = after.defaultSql ?? before.defaultSql;
          if (typeof defaultSql === "string")
            builder = builder.defaultTo(sql.raw(defaultSql));
          return builder;
        })
        .execute();
    },
  },
};
