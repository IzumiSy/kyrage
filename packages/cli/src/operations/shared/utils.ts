import { ColumnDataType, isColumnDataType } from "kysely";
import type { TableColumnAttributes } from "./types";

/** Rejects changes that would discard unsupported attributes reported by introspection. */
export const assertColumnModificationAllowed = (
  before: TableColumnAttributes,
  after: TableColumnAttributes
) => {
  if (
    before.alterationBlockedReason &&
    (before.type !== after.type ||
      Boolean(before.notNull) !== Boolean(after.notNull))
  ) {
    throw new Error(
      `Cannot safely modify column: ${before.alterationBlockedReason}`
    );
  }
};

export const assertDataType: (
  dataType: string
) => asserts dataType is ColumnDataType = (dataType) => {
  if (!isColumnDataType(dataType)) {
    throw new Error(`Unsupported data type: ${dataType}`);
  }
};
