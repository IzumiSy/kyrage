import { schemaDiffSchema } from "./schema";
import { z } from "zod";
import * as R from "ramda";

// Derive diff-related types from the zod schema (SchemaDiffValue)
export type SchemaDiff = z.infer<typeof schemaDiffSchema>;
export type AddedTable = SchemaDiff["addedTables"][number];
export type RemovedTable = SchemaDiff["removedTables"][number];
export type ChangedTable = SchemaDiff["changedTables"][number];
export type IndexDef = SchemaDiff["addedIndexes"][number];
export type ChangedIndex = SchemaDiff["changedIndexes"][number];
export type TableColumnAttributes = AddedTable["columns"][string];

export type Tables = Array<{
  name: string;
  columns: Record<string, TableColumnAttributes>;
}>;

export type SchemaSnapshot = {
  tables: Tables;
  indexes: IndexDef[];
};

// ヘルパー関数群（Ramdaを使用）
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

// カラム比較関数（型安全に修正）
const columnsEqual = R.curry(
  (col1: TableColumnAttributes, col2: TableColumnAttributes): boolean => {
    return (
      col1.type === col2.type &&
      (col1.notNull ?? false) === (col2.notNull ?? false) &&
      (col1.primaryKey ?? false) === (col2.primaryKey ?? false) &&
      (col1.unique ?? false) === (col2.unique ?? false)
    );
  }
);

export function diffSchema(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): SchemaDiff {
  const { current, ideal } = props;
  const currentTables = current.tables;
  const idealTables = ideal.tables;

  // Ramdaを使用してテーブル名の配列を作成
  const dbTableNames = R.map(getName, currentTables);
  const configTableNames = R.map(getName, idealTables);

  // 追加テーブル: Ramdaのfilterとmapを組み合わせ
  const addedTables = R.pipe(
    R.filter(R.pipe(getName, R.complement(R.includes(R.__, dbTableNames)))),
    R.map((table) => ({
      table: table.name,
      columns: table.columns,
    }))
  )(idealTables);

  // 削除テーブル: Ramdaのpipeを使用
  const removedTables = R.pipe(
    R.filter(R.pipe(getName, R.complement(R.includes(R.__, configTableNames)))),
    R.map(getName)
  )(currentTables);

  // テーブルごとのカラム差分（Ramdaを使いつつ型安全に）
  const changedTables = currentTables.reduce<ChangedTable[]>(
    (acc, currentTable) => {
      const idealTable = idealTables.find((t) => t.name === currentTable.name);
      if (!idealTable) return acc;

      const dbCols = currentTable.columns;
      const configCols = idealTable.columns;
      const dbColNames = Object.keys(dbCols);
      const configColNames = Object.keys(configCols);

      // 追加カラム（Ramdaを使用）
      const addedColumns = R.pipe(
        R.difference(configColNames),
        R.map((column: string) => ({
          column,
          attributes: configCols[column],
        }))
      )(dbColNames);

      // 削除カラム（Ramdaを使用）
      const removedColumns = R.pipe(
        R.difference(dbColNames),
        R.map((column: string) => ({
          column,
          attributes: dbCols[column],
        }))
      )(configColNames);

      // 型変更カラム（Ramdaを使用）
      const changedColumns = R.pipe(
        R.intersection(dbColNames),
        R.filter(
          (column: string) => !columnsEqual(dbCols[column], configCols[column])
        ),
        R.map((column: string) => ({
          column,
          before: dbCols[column],
          after: configCols[column],
        }))
      )(configColNames);

      if (hasColumnChanges({ addedColumns, removedColumns, changedColumns })) {
        acc.push({
          table: currentTable.name,
          addedColumns,
          removedColumns,
          changedColumns,
        });
      }
      return acc;
    },
    []
  );

  // Index diff
  const indexKey = (i: IndexDef) => `${i.table}:${i.name}`;
  const currentIndexMap = new Map(
    current.indexes
      .filter((i) => !i.systemGenerated)
      .map((i) => [indexKey(i), i])
  );
  const idealIndexMap = new Map(
    ideal.indexes.filter((i) => !i.systemGenerated).map((i) => [indexKey(i), i])
  );

  const currentKeys = Array.from(currentIndexMap.keys());
  const idealKeys = Array.from(idealIndexMap.keys());

  // 追加インデックス（Ramdaを使用）
  const addedIndexes = R.pipe(
    R.difference(idealKeys),
    R.map((key: string) => idealIndexMap.get(key)!)
  )(currentKeys);

  // 削除インデックス（Ramdaを使用）
  const removedIndexes = R.pipe(
    R.difference(currentKeys),
    R.map((key: string) => {
      const index = currentIndexMap.get(key)!;
      return { table: index.table, name: index.name };
    })
  )(idealKeys);

  // 変更インデックス（Ramdaを使用）
  const changedIndexes = R.pipe(
    R.intersection(currentKeys),
    R.filter((key: string) => {
      const current = currentIndexMap.get(key)!;
      const ideal = idealIndexMap.get(key)!;
      const sameColumns = R.equals(current.columns, ideal.columns);
      return !sameColumns || current.unique !== ideal.unique;
    }),
    R.map((key: string) => {
      const current = currentIndexMap.get(key)!;
      const ideal = idealIndexMap.get(key)!;
      return {
        table: ideal.table,
        name: ideal.name,
        before: current,
        after: ideal,
      };
    })
  )(idealKeys);

  return {
    addedTables,
    removedTables,
    changedTables,
    addedIndexes,
    removedIndexes,
    changedIndexes,
  };
}
