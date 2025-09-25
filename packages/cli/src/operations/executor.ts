import z from "zod";
import { Kysely } from "kysely";
import { createTableWithConstraintsOp } from "./table/createTableWithConstraints";
import { dropTableOp } from "./table/dropTable";
import { addColumnOp } from "./column/addColumn";
import { dropColumnOp } from "./column/dropColumn";
import { alterColumnOp } from "./column/alterColumn";
import { createIndexOp } from "./index/createIndex";
import { dropIndexOp } from "./index/dropIndex";
import { createPrimaryKeyConstraintOp } from "./constraint/createPrimaryKeyConstraint";
import { dropPrimaryKeyConstraintOp } from "./constraint/dropPrimaryKeyConstraint";
import { createUniqueConstraintOp } from "./constraint/createUniqueConstraint";
import { dropUniqueConstraintOp } from "./constraint/dropUniqueConstraint";
import { createForeignKeyConstraintOp } from "./constraint/createForeignKeyConstraint";
import { dropForeignKeyConstraintOp } from "./constraint/dropForeignKeyConstraint";
import { createTableOp } from "./table/createTable";

// ===== SCHEMA DEFINITIONS =====
export const operationSchema = z.discriminatedUnion("type", [
  createTableWithConstraintsOp.schema,
  createTableOp.schema,
  dropTableOp.schema,
  addColumnOp.schema,
  dropColumnOp.schema,
  alterColumnOp.schema,
  createIndexOp.schema,
  dropIndexOp.schema,
  createPrimaryKeyConstraintOp.schema,
  dropPrimaryKeyConstraintOp.schema,
  createUniqueConstraintOp.schema,
  dropUniqueConstraintOp.schema,
  createForeignKeyConstraintOp.schema,
  dropForeignKeyConstraintOp.schema,
]);

export type Operation = z.infer<typeof operationSchema>;

// ===== EXECUTION LOGIC =====
export async function executeOperation(db: Kysely<any>, operation: Operation) {
  switch (operation.type) {
    case "create_table_with_constraints":
      return createTableWithConstraintsOp.execute(db, operation);
    case "create_table":
      return createTableOp.execute(db, operation);
    case "drop_table":
      return dropTableOp.execute(db, operation);
    case "add_column":
      return addColumnOp.execute(db, operation);
    case "drop_column":
      return dropColumnOp.execute(db, operation);
    case "alter_column":
      return alterColumnOp.execute(db, operation);
    case "create_index":
      return createIndexOp.execute(db, operation);
    case "drop_index":
      return dropIndexOp.execute(db, operation);
    case "create_primary_key_constraint":
      return createPrimaryKeyConstraintOp.execute(db, operation);
    case "drop_primary_key_constraint":
      return dropPrimaryKeyConstraintOp.execute(db, operation);
    case "create_unique_constraint":
      return createUniqueConstraintOp.execute(db, operation);
    case "drop_unique_constraint":
      return dropUniqueConstraintOp.execute(db, operation);
    case "create_foreign_key_constraint":
      return createForeignKeyConstraintOp.execute(db, operation);
    case "drop_foreign_key_constraint":
      return dropForeignKeyConstraintOp.execute(db, operation);
    default:
      throw new Error(`Unknown operation type: ${(operation as any).type}`);
  }
}

// ===== PIPELINE PROCESSING =====

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

export const filterOperationsForDroppedTables = (
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

export const filterRedundantDropIndexOperations = (
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

  operations.forEach((op) => {
    if (op.type === "create_table") {
      createTableOps.set(op.table, op);
    } else if (
      (op.type === "create_primary_key_constraint" ||
        op.type === "create_unique_constraint") &&
      createTableTables.has(op.table)
    ) {
      const existing = constraintOpsForTables.get(op.table) || [];
      constraintOpsForTables.set(op.table, [...existing, op]);
    } else {
      remainingOps.push(op);
    }
  });

  const mergedOps: Array<Operation> = [];

  createTableOps.forEach((createTableOp, tableName) => {
    const tableConstraints = constraintOpsForTables.get(tableName) || [];

    if (tableConstraints.length === 0) {
      mergedOps.push(createTableOp);
    } else {
      const constraints: any = {};

      tableConstraints.forEach((constraint) => {
        if (constraint.type === "create_primary_key_constraint") {
          constraints.primaryKey = {
            name: constraint.name,
            columns: constraint.columns,
          };
        } else if (constraint.type === "create_unique_constraint") {
          if (!constraints.unique) constraints.unique = [];
          constraints.unique.push({
            name: constraint.name,
            columns: constraint.columns,
          });
        }
      });

      mergedOps.push({
        type: "create_table_with_constraints" as const,
        table: createTableOp.table,
        columns: createTableOp.columns,
        constraints,
      });
    }
  });

  return [...mergedOps, ...remainingOps];
};
