import { schemaDiffSchema } from "./schema";
import { z } from "zod";
import * as R from "ramda";

// Derive diff-related types from the zod schema (SchemaDiffValue)
export type SchemaDiff = z.infer<typeof schemaDiffSchema>;
type AddedTable = SchemaDiff["addedTables"][number];
type RemovedTable = SchemaDiff["removedTables"][number];
type ChangedTable = SchemaDiff["changedTables"][number];
type IndexDef = SchemaDiff["addedIndexes"][number];
type ChangedIndex = SchemaDiff["changedIndexes"][number];
type TableColumnAttributes = AddedTable["columns"][string];

export type Tables = Array<{
  name: string;
  columns: Record<string, TableColumnAttributes>;
}>;

export type SchemaSnapshot = {
  tables: Tables;
  indexes: IndexDef[];
};

export type TableDiff = {
  addedTables: AddedTable[];
  removedTables: RemovedTable[];
  changedTables: ChangedTable[];
};

export type IndexDiff = {
  addedIndexes: IndexDef[];
  removedIndexes: { table: string; name: string }[];
  changedIndexes: ChangedIndex[];
};

// 汎用的なdiff演算子
const createDiffOperations = <K>() => ({
  added: <T>(currentKeys: K[], idealKeys: K[], mapper: (key: K) => T): T[] =>
    R.pipe(R.difference(idealKeys), R.map(mapper))(currentKeys),
  removed: <T>(currentKeys: K[], idealKeys: K[], mapper: (key: K) => T): T[] =>
    R.pipe(R.difference(currentKeys), R.map(mapper))(idealKeys),
  changed: <T>(
    currentKeys: K[],
    idealKeys: K[],
    predicate: (key: K) => boolean,
    mapper: (key: K) => T
  ): T[] =>
    R.pipe(
      R.intersection(currentKeys),
      R.filter(predicate),
      R.map(mapper)
    )(idealKeys),
});

const getName = R.prop("name");
const hasColumnChanges = (changes: {
  addedColumns: unknown[];
  removedColumns: unknown[];
  changedColumns: unknown[];
}) =>
  R.any(R.pipe(R.length, R.gt(R.__, 0)), [
    changes.addedColumns,
    changes.removedColumns,
    changes.changedColumns,
  ]);

// カラム属性を比較用の配列に変換
const columnsEqual = R.eqBy((col: TableColumnAttributes) => [
  col.type,
  col.notNull ?? false,
  col.primaryKey ?? false,
  col.unique ?? false,
]);

// カラム差分計算のヘルパー関数
function computeTableColumnDiffs(
  currentTable: Tables[0],
  idealTable: Tables[0]
): ChangedTable | null {
  const diffOps = createDiffOperations<string>();
  const dbCols = currentTable.columns;
  const configCols = idealTable.columns;
  const dbColNames = Object.keys(dbCols);
  const configColNames = Object.keys(configCols);

  const addedColumns = diffOps.added(
    dbColNames,
    configColNames,
    (column: string) => ({ column, attributes: configCols[column] })
  );

  const removedColumns = diffOps.removed(
    dbColNames,
    configColNames,
    (column: string) => ({ column, attributes: dbCols[column] })
  );

  const changedColumns = diffOps.changed(
    dbColNames,
    configColNames,
    (column: string) => !columnsEqual(dbCols[column], configCols[column]),
    (column: string) => ({
      column,
      before: dbCols[column],
      after: configCols[column],
    })
  );

  if (hasColumnChanges({ addedColumns, removedColumns, changedColumns })) {
    return {
      table: currentTable.name,
      addedColumns,
      removedColumns,
      changedColumns,
    };
  }
  return null;
}

export function diffTables(current: Tables, ideal: Tables): TableDiff {
  const diffOps = createDiffOperations<string>();
  const currentNames = R.map(getName, current);
  const idealNames = R.map(getName, ideal);

  return {
    addedTables: diffOps.added(currentNames, idealNames, (name: string) => {
      const table = ideal.find((t) => t.name === name)!;
      return { table: table.name, columns: table.columns };
    }),
    removedTables: diffOps.removed(currentNames, idealNames, R.identity),
    changedTables: R.pipe(
      R.filter((currentTable: Tables[0]) =>
        ideal.some((t) => t.name === currentTable.name)
      ),
      R.map((currentTable: Tables[0]) => {
        const idealTable = ideal.find((t) => t.name === currentTable.name)!;
        return computeTableColumnDiffs(currentTable, idealTable);
      }),
      R.filter(
        (result: ChangedTable | null): result is ChangedTable => result !== null
      )
    )(current),
  };
}

export function diffIndexes(current: IndexDef[], ideal: IndexDef[]): IndexDiff {
  const diffOps = createDiffOperations<string>();
  const indexKey = (i: IndexDef) => `${i.table}:${i.name}`;

  // システム生成でないインデックスのみを対象
  const nonSystemGenerated = (i: IndexDef) => !i.systemGenerated;
  const currentIndexMap = new Map(
    current.filter(nonSystemGenerated).map((i) => [indexKey(i), i])
  );
  const idealIndexMap = new Map(
    ideal.filter(nonSystemGenerated).map((i) => [indexKey(i), i])
  );

  const currentKeys = Array.from(currentIndexMap.keys());
  const idealKeys = Array.from(idealIndexMap.keys());

  return {
    addedIndexes: diffOps.added(
      currentKeys,
      idealKeys,
      (key: string) => idealIndexMap.get(key)!
    ),
    removedIndexes: diffOps.removed(currentKeys, idealKeys, (key: string) => {
      const index = currentIndexMap.get(key)!;
      return { table: index.table, name: index.name };
    }),
    changedIndexes: diffOps.changed(
      currentKeys,
      idealKeys,
      (key: string) => {
        const current = currentIndexMap.get(key)!;
        const ideal = idealIndexMap.get(key)!;
        const sameColumns = R.equals(current.columns, ideal.columns);
        return !sameColumns || current.unique !== ideal.unique;
      },
      (key: string) => {
        const current = currentIndexMap.get(key)!;
        const ideal = idealIndexMap.get(key)!;
        return {
          table: ideal.table,
          name: ideal.name,
          before: current,
          after: ideal,
        };
      }
    ),
  };
}

export function diffSchema(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): SchemaDiff {
  const { current, ideal } = props;

  const tableDiff = diffTables(current.tables, ideal.tables);
  const indexDiff = diffIndexes(current.indexes, ideal.indexes);

  return {
    ...tableDiff,
    ...indexDiff,
  };
}
