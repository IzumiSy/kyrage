import { sql } from "kysely";
import type { SchemaAdapter, SchemaComparison } from "./schema-adapter";
import type {
  ForeignKeyConstraintSchema,
  Tables,
} from "../operations/shared/types";
import { assertDataType } from "../operations/shared/utils";
import type { Operation } from "../operations/executor";
import { readMysqlColumnMetadata } from "./mysql-column-metadata";
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

/** An alteration for which the renderer issues a full MODIFY COLUMN definition. */
type ColumnModification = Extract<Operation, { type: "alter_column" }>;

/** Matches the renderer's type/nullability changes, excluding constraint-only no-ops. */
const modifiesColumnDefinition = (
  operation: Operation
): operation is ColumnModification =>
  operation.type === "alter_column" &&
  (operation.before.type !== operation.after.type ||
    Boolean(operation.before.notNull) !== Boolean(operation.after.notNull));

/** Refuses unsafe or unverifiable full-definition changes before any operation executes. */
const validateOperations: SchemaAdapter["validateOperations"] = async ({
  db,
  operations,
}) => {
  const modifications = operations.filter(modifiesColumnDefinition);
  if (modifications.length === 0) return;

  const changedTables = new Set<string>();
  const changedColumns = new Set<string>();
  for (const operation of operations) {
    if (modifiesColumnDefinition(operation)) {
      const key = JSON.stringify([operation.table, operation.column]);
      if (changedTables.has(operation.table) || changedColumns.has(key)) {
        throw new Error(
          `Cannot validate modification of ${operation.table}.${operation.column}: state depends on earlier operations`
        );
      }
      assertDataType(operation.after.type);
      changedColumns.add(key);
    } else if (
      operation.type === "create_table" ||
      operation.type === "create_table_with_constraints" ||
      operation.type === "drop_table"
    ) {
      changedTables.add(operation.table);
    } else if (
      operation.type === "add_column" ||
      operation.type === "drop_column"
    ) {
      changedColumns.add(JSON.stringify([operation.table, operation.column]));
    }
  }

  const rows = await readMysqlColumnMetadata(db);
  const columns = new Map(
    rows.map((row) => [JSON.stringify([row.table_name, row.column_name]), row])
  );
  for (const operation of modifications) {
    const column = columns.get(
      JSON.stringify([operation.table, operation.column])
    );
    if (!column) {
      throw new Error(
        `Cannot validate modification of ${operation.table}.${operation.column}: column is missing from the current database`
      );
    }
    const extra = (column.extra ?? "")
      .replace(/\bDEFAULT_GENERATED\b/g, "")
      .trim();
    const unsupported = [
      extra,
      column.column_comment ? "column comment" : "",
      column.custom_collation ? "custom collation" : "",
    ]
      .filter(Boolean)
      .join(", ");
    if (unsupported) {
      throw new Error(
        `Cannot safely modify column ${operation.table}.${operation.column}: ${unsupported}`
      );
    }
    // An omitted desired default must preserve the live default, not an older snapshot.
    const defaultSql =
      operation.after.defaultSql ?? operation.before.defaultSql;
    const renderedDefault = typeof defaultSql === "string" ? defaultSql : null;
    if (
      typeof operation.after.defaultSql !== "string" &&
      renderedDefault !== column.column_default
    ) {
      throw new Error(
        `Cannot safely modify column ${operation.table}.${operation.column}: default changed since generation`
      );
    }
  }
};

/** Shares MySQL/MariaDB comparison rules and nonstandard schema-operation SQL. */
export const mysqlSchemaAdapter: SchemaAdapter = {
  prepareSchemaComparison,
  validateOperations,
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
      if (!modifiesColumnDefinition(operation)) return;
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
