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
export async function executeOperation(db: Kysely<any>, operation: Operation) {
  const execute = getOperationExecutor(operation.type);
  return await execute(db, operation);
}

function getOperationExecutor<T extends Operation["type"]>(operationType: T) {
  const operation = operations.find((op) => op.typeName === operationType);
  if (!operation) {
    throw new Error(`Unknown operation type: ${operationType}`);
  }

  return operation.execute as (
    db: Kysely<any>,
    operation: Extract<Operation, { type: T }>
  ) => Promise<void>;
}
