import type { Kysely } from "kysely";
import type { Operation } from "../operations/executor";
import type { SchemaSnapshot } from "../operations/shared/types";

/** Correlates each optional executor override with its operation payload. */
export type OperationExecutors = {
  [T in Operation["type"]]?: (
    db: Kysely<any>,
    operation: Extract<Operation, { type: T }>
  ) => Promise<void>;
};

/** Current and desired schemas passed to the dialect's comparison policy. */
export type SchemaComparison = {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
};

/** Supplies dialect behavior without exposing database identity to core logic. */
export type SchemaAdapter = {
  operationExecutors: OperationExecutors;
  prepareSchemaComparison: (comparison: SchemaComparison) => SchemaComparison;
  /** Checks executable operations against live database facts before any DDL. */
  validateOperations: (props: {
    db: Kysely<any>;
    operations: ReadonlyArray<Operation>;
  }) => Promise<void>;
};

/** Uses standard operation executors and compares schema snapshots unchanged. */
export const defaultSchemaAdapter: SchemaAdapter = {
  operationExecutors: {},
  prepareSchemaComparison: (comparison) => comparison,
  validateOperations: async () => {},
};
