import z from "zod";
import type { Kysely } from "kysely";
import type { OperationExecutors } from "../dialect/schema-adapter";
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

/**
 * All available operations
 */
const operations = [
  createTableWithConstraintsOp,
  createTableOp,
  dropTableOp,
  addColumnOp,
  dropColumnOp,
  alterColumnOp,
  createIndexOp,
  dropIndexOp,
  createPrimaryKeyConstraintOp,
  dropPrimaryKeyConstraintOp,
  createUniqueConstraintOp,
  dropUniqueConstraintOp,
  createForeignKeyConstraintOp,
  dropForeignKeyConstraintOp,
] as const;

export const operationSchema = z.union(operations.map((s) => s.schema));
export type Operation = z.infer<typeof operationSchema>;
/** Executes an injected override or the registered standard operation implementation. */
export const executeOperation = async (
  db: Kysely<any>,
  operation: Operation,
  executors: OperationExecutors = {}
) => {
  const execute = getOperationExecutor(operation.type, executors);
  return await execute(db, operation);
};

/** Resolves a typed executor without inspecting the database's identity. */
const getOperationExecutor = <T extends Operation["type"]>(
  operationType: T,
  executors: OperationExecutors
) => {
  const operation = operations.find((op) => op.typeName === operationType);
  if (!operation) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  return (executors[operationType] ?? operation.execute) as (
    db: Kysely<any>,
    operation: Extract<Operation, { type: T }>
  ) => Promise<void>;
};
