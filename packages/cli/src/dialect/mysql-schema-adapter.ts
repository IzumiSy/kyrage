import { sql } from "kysely";
import {
  SchemaOperationValidationError,
  type SchemaAdapter,
  type SchemaComparison,
} from "./schema-adapter";
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
      ]),
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
          candidate.table === key.table && candidate.name === key.name,
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
          (existing) => existing.table === key.table,
        )?.name ?? key.name,
    })),
  },
});

/** An alteration for which the renderer issues a full MODIFY COLUMN definition. */
type ColumnModification = Extract<Operation, { type: "alter_column" }>;

/** Matches the renderer's type/nullability changes, excluding constraint-only no-ops. */
const modifiesColumnDefinition = (
  operation: Operation,
): operation is ColumnModification =>
  operation.type === "alter_column" &&
  (operation.before.type !== operation.after.type ||
    Boolean(operation.before.notNull) !== Boolean(operation.after.notNull));

/** An observed catalog fact or a DDL effect whose required metadata is not predictable. */
type ColumnFact<T> =
  | { kind: "known"; value: T }
  | { kind: "unknown"; reason: string };

/** Only the column state needed to prevent lossy full-definition modifications. */
type ColumnValidationState = {
  type: string;
  notNull: boolean;
  defaultSql: ColumnFact<string | null>;
  unsupportedAttributes: ColumnFact<ReadonlyArray<string>>;
};

/** Matches the executor's desired-default fallback without treating non-strings as SQL. */
const modificationDefault = ({ before, after }: ColumnModification) => {
  const value = after.defaultSql ?? before.defaultSql;
  return typeof value === "string" ? value : null;
};

/** Types whose emitted definitions do not add native attributes implicitly. */
const predictableColumnTypes = new Set([
  "smallint",
  "integer",
  "bigint",
  "int2",
  "int4",
  "int8",
  "boolean",
  "int",
  "tinyint",
  "mediumint",
  "float",
  "double",
  "real",
  "double precision",
  "float4",
  "float8",
  "decimal",
  "numeric",
  "varchar",
  "char",
  "text",
  "binary",
  "varbinary",
  "blob",
  "date",
  "datetime",
  "time",
]);

/** Signed integer limits, including the aliases accepted by the SQL builder. */
const integerLimits: Record<string, readonly [bigint, bigint]> = {
  smallint: [-32768n, 32767n],
  int2: [-32768n, 32767n],
  integer: [-2147483648n, 2147483647n],
  int4: [-2147483648n, 2147483647n],
  bigint: [-9223372036854775808n, 9223372036854775807n],
  int8: [-9223372036854775808n, 9223372036854775807n],
};

/** Recognizes bounded default forms that cannot append native column attributes. */
const hasIsolatedDefault = (value: string | null) =>
  value === null ||
  /^-?\d+(?:\.\d+)?$/.test(value) ||
  /^\(\s*-?\d+(?:\.\d+)?(?:\s*[+*/%-]\s*-?\d+(?:\.\d+)?)*\s*\)$/.test(value) ||
  /^'(?:[^'\\]|'')*'$/.test(value) ||
  /^(true|false|null|current_timestamp(?:\(\d*\))?)$/i.test(value);

/** Projects only proven catalog effects, never arbitrary server default-expression normalization. */
const projectColumn = (props: {
  type: string;
  notNull: boolean;
  defaultSql: string | null;
}): ColumnValidationState => {
  const baseType = props.type.replace(/\(.*$/, "");
  const predictable = predictableColumnTypes.has(baseType);
  let defaultSql: ColumnFact<string | null> = {
    kind: "unknown",
    reason: `future default metadata cannot be established for ${props.type}`,
  };
  if (predictable && props.defaultSql === null) {
    defaultSql = { kind: "known", value: null };
  } else if (
    predictable &&
    props.defaultSql !== null &&
    integerLimits[baseType] &&
    /^-?(0|[1-9]\d*)$/.test(props.defaultSql)
  ) {
    const value = BigInt(props.defaultSql);
    const [min, max] = integerLimits[baseType];
    if (value >= min && value <= max && String(value) === props.defaultSql) {
      defaultSql = { kind: "known", value: props.defaultSql };
    }
  }
  return {
    type: props.type,
    notNull: props.notNull,
    defaultSql,
    // ponytail: classify bounded defaults only; add proven expression forms instead of a SQL parser.
    unsupportedAttributes:
      predictable && hasIsolatedDefault(props.defaultSql)
        ? { kind: "known", value: [] }
        : baseType === "serial"
          ? { kind: "known", value: ["auto_increment"] }
          : {
              kind: "unknown",
              reason: predictable
                ? "future native attributes cannot be established from raw default SQL"
                : `future native attributes cannot be established for ${props.type}`,
            },
  };
};

/** Checks the facts required by the existing renderer before replacing a column definition. */
const validateModification = (
  operation: ColumnModification,
  column: ColumnValidationState | undefined,
) => {
  const name = `${operation.table}.${operation.column}`;
  if (!column) {
    throw new Error(
      `Cannot validate modification of ${name}: column is missing at this point in execution`,
    );
  }
  if (column.unsupportedAttributes.kind === "unknown") {
    throw new Error(
      `Cannot validate modification of ${name}: ${column.unsupportedAttributes.reason}`,
    );
  }
  if (column.unsupportedAttributes.value.length > 0) {
    throw new Error(
      `Cannot safely modify column ${name}: ${column.unsupportedAttributes.value.join(", ")}`,
    );
  }
  // Only an explicit desired default authorizes replacing an unknown or drifted default.
  if (typeof operation.after.defaultSql === "string") return;
  if (column.defaultSql.kind === "unknown") {
    throw new Error(
      `Cannot validate modification of ${name}: ${column.defaultSql.reason}`,
    );
  }
  if (modificationDefault(operation) !== column.defaultSql.value) {
    throw new Error(
      `Cannot safely modify column ${name}: default changed since generation`,
    );
  }
};

/** Refuses unsafe or genuinely unknown modifications using each operation's preceding state. */
const validateOperations: SchemaAdapter["validateOperations"] = async ({
  db,
  operations,
}) => {
  if (!operations.some(modifiesColumnDefinition)) return;
  for (const [index, operation] of operations.entries()) {
    if (!modifiesColumnDefinition(operation)) continue;
    try {
      assertDataType(operation.after.type);
    } catch (error) {
      throw new SchemaOperationValidationError(
        index,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const rows = await readMysqlColumnMetadata(db);
  const tables = new Map<string, Map<string, ColumnValidationState>>();
  for (const row of rows) {
    const columns =
      tables.get(row.table_name) ?? new Map<string, ColumnValidationState>();
    columns.set(row.column_name, {
      type: row.column_type,
      notNull: row.is_nullable === "NO",
      defaultSql: { kind: "known", value: row.column_default },
      unsupportedAttributes: {
        kind: "known",
        value: [
          (row.extra ?? "").replace(/\bDEFAULT_GENERATED\b/g, "").trim(),
          row.column_comment ? "column comment" : "",
          row.custom_collation ? "custom collation" : "",
        ].filter(Boolean),
      },
    });
    tables.set(row.table_name, columns);
  }

  /** Accounts for implicit NOT NULL without guessing temporal or unusual native effects. */
  const applyPrimaryKey = (table: string, names: ReadonlyArray<string>) => {
    for (const name of names) {
      const column = tables.get(table)?.get(name);
      if (!column || column.notNull) continue;
      column.notNull = true;
      if (!predictableColumnTypes.has(column.type.replace(/\(.*$/, ""))) {
        column.defaultSql = {
          kind: "unknown",
          reason:
            "future default metadata cannot be established after primary-key creation",
        };
        if (
          column.unsupportedAttributes.kind === "known" &&
          column.unsupportedAttributes.value.length === 0
        ) {
          column.unsupportedAttributes = {
            kind: "unknown",
            reason:
              "future native attributes cannot be established after primary-key creation",
          };
        }
      }
    }
  };

  for (const [index, operation] of operations.entries()) {
    try {
      switch (operation.type) {
        case "create_table":
        case "create_table_with_constraints": {
          tables.set(
            operation.table,
            new Map(
              Object.entries(operation.columns).map(([name, attributes]) => [
                name,
                projectColumn({
                  type: attributes.type,
                  notNull: Boolean(attributes.notNull),
                  defaultSql:
                    typeof attributes.defaultSql === "string"
                      ? attributes.defaultSql
                      : null,
                }),
              ]),
            ),
          );
          if (
            operation.type === "create_table_with_constraints" &&
            operation.constraints?.primaryKey
          ) {
            applyPrimaryKey(
              operation.table,
              operation.constraints.primaryKey.columns,
            );
          }
          break;
        }
        case "drop_table":
          tables.delete(operation.table);
          break;
        case "add_column": {
          const columns =
            tables.get(operation.table) ??
            new Map<string, ColumnValidationState>();
          columns.set(
            operation.column,
            projectColumn({
              type: operation.attributes.type,
              notNull: Boolean(operation.attributes.notNull),
              defaultSql:
                typeof operation.attributes.defaultSql === "string"
                  ? operation.attributes.defaultSql
                  : null,
            }),
          );
          tables.set(operation.table, columns);
          break;
        }
        case "drop_column":
          tables.get(operation.table)?.delete(operation.column);
          break;
        case "alter_column":
          if (modifiesColumnDefinition(operation)) {
            const columns = tables.get(operation.table);
            validateModification(operation, columns?.get(operation.column));
            columns?.set(
              operation.column,
              projectColumn({
                type: operation.after.type,
                notNull: Boolean(operation.after.notNull),
                defaultSql: modificationDefault(operation),
              }),
            );
          }
          break;
        case "create_primary_key_constraint":
          applyPrimaryKey(operation.table, operation.columns);
          break;
      }
    } catch (error) {
      throw new SchemaOperationValidationError(
        index,
        error instanceof Error ? error.message : String(error),
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
        db,
      );
    },
    drop_foreign_key_constraint: async (db, operation) => {
      await sql`alter table ${sql.table(operation.table)} drop foreign key ${sql.id(operation.name)}`.execute(
        db,
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
      const { table, column, after } = operation;
      if (!modifiesColumnDefinition(operation)) return;
      assertDataType(after.type);
      await db.schema
        .alterTable(table)
        .modifyColumn(column, after.type, (col) => {
          let builder = after.notNull ? col.notNull() : col;
          const defaultSql = modificationDefault(operation);
          if (typeof defaultSql === "string")
            builder = builder.defaultTo(sql.raw(defaultSql));
          return builder;
        })
        .execute();
    },
  },
};
