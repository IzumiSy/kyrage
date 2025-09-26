import * as R from "ramda";
import { Operation } from "./executor";
import { createTableWithConstraints } from "./table/createTableWithConstraints";
import { CreateForeignKeyConstraintOp } from "./constraint/createForeignKeyConstraint";
import { CreateUniqueConstraintOp } from "./constraint/createUniqueConstraint";
import { CreatePrimaryKeyConstraintOp } from "./constraint/createPrimaryKeyConstraint";

/**
 * Filters out operations that target tables which are dropped earlier in the sequence
 */
const filterOperationsForDroppedTables = (
  operations: ReadonlyArray<Operation>
): ReadonlyArray<Operation> => {
  const droppedTables = new Set<string>();
  operations.forEach((operation) => {
    if (operation.type === "drop_table") {
      droppedTables.add(operation.table);
    }
  });

  if (droppedTables.size === 0) {
    return operations;
  }

  return operations.filter((operation) => {
    if (operation.type === "drop_table") {
      return true;
    }
    if (droppedTables.has(operation.table)) {
      return false;
    }
    return true;
  });
};

/**
 * Merges `CREATE TABLE` operations with their associated constraints
 * into a single create_table_with_constraints operation.
 * Now supports Primary Key, Unique, and Foreign Key constraints.
 *
 * Foreign Key constraints are merged if:
 * - The table is being created in the same migration
 * - The inline option is not explicitly set to false
 * - The required columns exist in the source table
 *
 * Use inline: false for cross-table foreign keys that need specific ordering.
 */
export const mergeTableCreationWithConstraints = (
  operations: ReadonlyArray<Operation>
): ReadonlyArray<Operation> => {
  const createTableTables = new Set<string>();
  operations.forEach((op) => {
    if (op.type === "create_table") {
      createTableTables.add(op.table);
    }
  });

  if (createTableTables.size === 0) {
    return operations;
  }

  const createTableOps = new Map<
    string,
    Extract<Operation, { type: "create_table" }>
  >();
  const constraintOpsForTables = new Map<string, Array<Operation>>();
  const remainingOps: Array<Operation> = [];

  // 1段階目：create table操作の収集
  operations.forEach((op) => {
    if (op.type === "create_table") {
      createTableOps.set(op.table, op);
    }
  });

  // 2段階目：制約操作の分類
  operations.forEach((op) => {
    switch (op.type) {
      case "create_table":
        return;
      case "create_primary_key_constraint":
      case "create_unique_constraint":
        if (createTableTables.has(op.table)) {
          const existing = constraintOpsForTables.get(op.table) || [];
          constraintOpsForTables.set(op.table, [...existing, op]);
        } else {
          remainingOps.push(op);
        }
        break;
      case "create_foreign_key_constraint":
        if (createTableTables.has(op.table) && op.inline !== false) {
          const sourceTable = createTableOps.get(op.table)!;
          const missingColumns = op.columns.filter(
            (col) => !(col in sourceTable.columns)
          );
          if (missingColumns.length > 0) {
            throw new Error(
              `Foreign key constraint "${op.name}" references non-existent columns: ${missingColumns.join(", ")}`
            );
          }

          const existing = constraintOpsForTables.get(op.table) || [];
          constraintOpsForTables.set(op.table, [...existing, op]);
        } else {
          remainingOps.push(op);
        }
        break;
      default:
        remainingOps.push(op);
        break;
    }
  });

  const mergedOps: Array<Operation> = [];

  createTableOps.forEach((createTableOp, tableName) => {
    const tableConstraints = constraintOpsForTables.get(tableName) || [];
    if (tableConstraints.length === 0) {
      mergedOps.push(createTableOp);
      return;
    }

    const constraints: {
      primaryKey?: CreatePrimaryKeyConstraintOp;
      unique: Array<CreateUniqueConstraintOp>;
      foreignKeys: Array<CreateForeignKeyConstraintOp>;
    } = {
      unique: [],
      foreignKeys: [],
    };

    tableConstraints.forEach((constraint) => {
      switch (constraint.type) {
        case "create_primary_key_constraint":
          constraints.primaryKey = constraint;
          break;
        case "create_unique_constraint":
          constraints.unique.push(constraint);
          break;
        case "create_foreign_key_constraint":
          constraints.foreignKeys.push(constraint);
          break;
      }
    });

    mergedOps.push(
      createTableWithConstraints(
        createTableOp.table,
        createTableOp.columns,
        constraints
      )
    );
  });

  return [...mergedOps, ...remainingOps];
};

/**
 * Filters out DROP INDEX operations that are redundant because the index
 * would be automatically dropped when the associated constraint is dropped.
 */
const filterRedundantDropIndexOperations = (
  operations: ReadonlyArray<Operation>
): ReadonlyArray<Operation> => {
  const droppedConstraintIndexes = new Set<string>();

  operations.forEach((operation) => {
    if (
      operation.type === "drop_unique_constraint" ||
      operation.type === "drop_primary_key_constraint"
    ) {
      droppedConstraintIndexes.add(`${operation.table}.${operation.name}`);
    }
  });

  return operations.filter((operation) => {
    if (operation.type === "drop_index") {
      const indexKey = `${operation.table}.${operation.name}`;
      if (droppedConstraintIndexes.has(indexKey)) {
        return false;
      }
    }
    return true;
  });
};

/**
 * Sorts operations to ensure that dependencies are respected during execution.
 */
export const sortOperationsByDependency = (
  operations: ReadonlyArray<Operation>
) =>
  operations.slice().sort((a, b) => {
    const priorityA = OPERATION_PRIORITY[a.type];
    const priorityB = OPERATION_PRIORITY[b.type];

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    return a.table.localeCompare(b.table);
  });

// Operation priority for dependency sorting
const OPERATION_PRIORITY = {
  drop_foreign_key_constraint: 0,
  drop_unique_constraint: 1,
  drop_primary_key_constraint: 2,
  drop_index: 3,
  drop_column: 4,
  drop_table: 5,
  create_table_with_constraints: 6,
  create_table: 7,
  add_column: 8,
  alter_column: 9,
  create_index: 10,
  create_primary_key_constraint: 11,
  create_unique_constraint: 12,
  create_foreign_key_constraint: 13,
} as const;

export const buildReconciledOperations = R.pipe(
  filterOperationsForDroppedTables,
  mergeTableCreationWithConstraints,
  filterRedundantDropIndexOperations,
  sortOperationsByDependency
);
