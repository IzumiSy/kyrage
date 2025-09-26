import * as R from "ramda";
import toposort from "toposort";
import { Operation } from "./executor";
import { createTableWithConstraints } from "./table/createTableWithConstraints";
import { CreateForeignKeyConstraintOp } from "./constraint/createForeignKeyConstraint";
import { CreateUniqueConstraintOp } from "./constraint/createUniqueConstraint";
import { CreatePrimaryKeyConstraintOp } from "./constraint/createPrimaryKeyConstraint";

/**
 * Extracts foreign key relationships from an operation
 */
const extractForeignKeys = (
  op: Operation
): Array<{ table: string; referencedTable: string }> => {
  switch (op.type) {
    case "create_foreign_key_constraint":
      return [{ table: op.table, referencedTable: op.referencedTable }];
    case "create_table_with_constraints":
      return (op.constraints?.foreignKeys || []).map((fk) => ({
        table: op.table,
        referencedTable: fk.referencedTable,
      }));
    default:
      return [];
  }
};

/**
 * Gets the table name from an operation if it has one
 */
const getOperationTable = (operation: Operation): string | null => {
  return "table" in operation ? operation.table : null;
};

/**
 * Resolves cyclic foreign key dependencies by setting inline: false
 * for foreign key constraints involved in cycles
 */
const resolveCyclicForeignKeys = (
  operations: ReadonlyArray<Operation>,
  edges: Array<[string, string]>
): ReadonlyArray<Operation> => {
  // Detect bidirectional edges which indicate cycles
  const edgeSet = new Set(edges.map(([a, b]) => `${a}->${b}`));
  const cyclicPairs = new Set<string>();

  edges.forEach(([a, b]) => {
    if (edgeSet.has(`${b}->${a}`)) {
      cyclicPairs.add(`${a}-${b}`);
      cyclicPairs.add(`${b}-${a}`);
    }
  });

  if (cyclicPairs.size === 0) return operations;

  const cyclicTables = new Set<string>();
  cyclicPairs.forEach((pair) => {
    const [a, b] = pair.split("-");
    cyclicTables.add(a);
    cyclicTables.add(b);
  });

  return operations.map((op) => {
    if (
      op.type === "create_foreign_key_constraint" &&
      cyclicTables.has(op.table) &&
      cyclicTables.has(op.referencedTable)
    ) {
      return { ...op, inline: false };
    }
    return op;
  });
};

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
 * Uses topological sorting to handle foreign key dependencies between tables.
 */
export const sortOperationsByDependency = (
  operations: ReadonlyArray<Operation>
): ReadonlyArray<Operation> => {
  // Build foreign key dependency edges [referencedTable, table]
  const edges: Array<[string, string]> = [];
  const allTables = new Set<string>();

  // Collect all table names
  operations.forEach((op) => {
    const tableName = getOperationTable(op);
    if (tableName) {
      allTables.add(tableName);
    }
  });

  // Extract foreign key dependencies
  let resolvedOperations = operations;
  operations.forEach((op) => {
    const foreignKeys = extractForeignKeys(op);
    foreignKeys.forEach((fk) => {
      if (fk.table !== fk.referencedTable) {
        // referencedTable should be created before table
        edges.push([fk.referencedTable, fk.table]);
        allTables.add(fk.table);
        allTables.add(fk.referencedTable);
      }
    });
  });

  let sortedTables: string[];

  try {
    // Attempt topological sort
    sortedTables = toposort(edges);

    // Add tables that have no dependencies
    const tablesInSort = new Set(sortedTables);
    for (const table of allTables) {
      if (!tablesInSort.has(table)) {
        sortedTables.unshift(table); // Add at the beginning as they have no dependencies
      }
    }
  } catch (error) {
    // Circular dependency detected, resolve by setting inline: false
    console.warn(
      "Circular dependency detected in foreign keys, resolving by separating constraints"
    );
    resolvedOperations = resolveCyclicForeignKeys(operations, edges);

    // Try topological sort again after resolving cycles
    const resolvedEdges: Array<[string, string]> = [];
    resolvedOperations.forEach((op) => {
      const foreignKeys = extractForeignKeys(op);
      foreignKeys.forEach((fk) => {
        // Only add edges for inline foreign keys
        const isInline =
          op.type === "create_foreign_key_constraint"
            ? op.inline !== false
            : true;
        if (fk.table !== fk.referencedTable && isInline) {
          resolvedEdges.push([fk.referencedTable, fk.table]);
        }
      });
    });

    try {
      sortedTables = toposort(resolvedEdges);
      const tablesInSort = new Set(sortedTables);
      for (const table of allTables) {
        if (!tablesInSort.has(table)) {
          sortedTables.unshift(table);
        }
      }
    } catch {
      // Fallback to alphabetical sorting
      sortedTables = Array.from(allTables).sort();
    }
  }

  // Create table order map for sorting
  const tableOrderMap = new Map(
    sortedTables.map((table, index) => [table, index])
  );

  return resolvedOperations.slice().sort((a, b) => {
    // 1. Sort by operation priority
    const priorityA = OPERATION_PRIORITY[a.type];
    const priorityB = OPERATION_PRIORITY[b.type];

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // 2. Sort by table dependency order for same priority
    const tableA = getOperationTable(a);
    const tableB = getOperationTable(b);

    if (tableA && tableB) {
      const orderA = tableOrderMap.get(tableA) ?? Number.MAX_SAFE_INTEGER;
      const orderB = tableOrderMap.get(tableB) ?? Number.MAX_SAFE_INTEGER;

      if (orderA !== orderB) {
        return orderA - orderB;
      }
    }

    // 3. Finally, sort alphabetically by table name
    return (tableA || "").localeCompare(tableB || "");
  });
};

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
