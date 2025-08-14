import {
  Operation,
  SchemaDiff,
  TableColumnAttributes,
  Tables,
  SchemaSnapshot,
  IndexDef,
} from "./operation";
import * as R from "ramda";

// Re-export for backward compatibility during migration
export type {
  SchemaDiff,
  Tables,
  SchemaSnapshot,
  TableColumnAttributes,
  IndexDef,
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

// カラム属性を比較用の配列に変換
const columnsEqual = R.eqBy((col: TableColumnAttributes) => [
  col.type,
  col.notNull ?? false,
  col.primaryKey ?? false,
  col.unique ?? false,
]);

// カラム差分計算のヘルパー関数
function computeTableColumnOperations(
  currentTable: Tables[0],
  idealTable: Tables[0]
): Operation[] {
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const dbCols = currentTable.columns;
  const configCols = idealTable.columns;
  const dbColNames = Object.keys(dbCols);
  const configColNames = Object.keys(configCols);

  // 追加カラム
  const addedColumns = diffOps.added(
    dbColNames,
    configColNames,
    (column: string) => ({ column, attributes: configCols[column] })
  );

  addedColumns.forEach((col) => {
    operations.push({
      type: "add_column",
      table: currentTable.name,
      column: col.column,
      attributes: col.attributes,
    });
  });

  // 削除カラム
  const removedColumns = diffOps.removed(
    dbColNames,
    configColNames,
    (column: string) => ({ column, attributes: dbCols[column] })
  );

  removedColumns.forEach((col) => {
    operations.push({
      type: "drop_column",
      table: currentTable.name,
      column: col.column,
      attributes: col.attributes,
    });
  });

  // 変更カラム
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

  changedColumns.forEach((col) => {
    operations.push({
      type: "alter_column",
      table: currentTable.name,
      column: col.column,
      before: col.before,
      after: col.after,
    });
  });

  return operations;
}

export function diffSchema(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): SchemaDiff {
  const { current, ideal } = props;
  const operations: Operation[] = [];

  // 1. テーブル操作
  const diffOps = createDiffOperations<string>();
  const currentNames = R.map(getName, current.tables);
  const idealNames = R.map(getName, ideal.tables);

  // 追加テーブル
  const addedTables = diffOps.added(
    currentNames,
    idealNames,
    (name: string) => {
      const table = ideal.tables.find((t) => t.name === name)!;
      return table;
    }
  );

  addedTables.forEach((table) => {
    operations.push({
      type: "create_table",
      table: table.name,
      columns: table.columns,
    });
  });

  // 削除テーブル
  const removedTables = diffOps.removed(currentNames, idealNames, R.identity);

  removedTables.forEach((tableName) => {
    operations.push({
      type: "drop_table",
      table: tableName,
    });
  });

  // 変更テーブル（カラム操作）
  const tablesForColumnCheck = R.filter((currentTable: Tables[0]) =>
    ideal.tables.some((t) => t.name === currentTable.name)
  )(current.tables);

  tablesForColumnCheck.forEach((currentTable: Tables[0]) => {
    const idealTable = ideal.tables.find((t) => t.name === currentTable.name)!;
    const columnOperations = computeTableColumnOperations(
      currentTable,
      idealTable
    );
    operations.push(...columnOperations);
  });

  // 2. インデックス操作
  const indexKey = (i: IndexDef) => `${i.table}:${i.name}`;

  // システム生成でないインデックスのみを対象
  const nonSystemGenerated = (i: IndexDef) => !i.systemGenerated;
  const currentIndexMap = new Map(
    current.indexes.filter(nonSystemGenerated).map((i) => [indexKey(i), i])
  );
  const idealIndexMap = new Map(
    ideal.indexes.filter(nonSystemGenerated).map((i) => [indexKey(i), i])
  );

  const currentKeys = Array.from(currentIndexMap.keys());
  const idealKeys = Array.from(idealIndexMap.keys());

  // 追加インデックス
  const addedIndexes = diffOps.added(
    currentKeys,
    idealKeys,
    (key: string) => idealIndexMap.get(key)!
  );

  addedIndexes.forEach((index) => {
    operations.push({
      type: "create_index",
      table: index.table,
      name: index.name,
      columns: index.columns,
      unique: index.unique,
    });
  });

  // 削除インデックス
  const removedIndexes = diffOps.removed(
    currentKeys,
    idealKeys,
    (key: string) => {
      const index = currentIndexMap.get(key)!;
      return { table: index.table, name: index.name };
    }
  );

  removedIndexes.forEach((index) => {
    operations.push({
      type: "drop_index",
      table: index.table,
      name: index.name,
    });
  });

  // 変更インデックス（削除→再作成）
  const changedIndexes = diffOps.changed(
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
      return { current, ideal };
    }
  );

  changedIndexes.forEach(({ current: currentIndex, ideal: idealIndex }) => {
    // 削除してから再作成
    operations.push({
      type: "drop_index",
      table: currentIndex.table,
      name: currentIndex.name,
    });
    operations.push({
      type: "create_index",
      table: idealIndex.table,
      name: idealIndex.name,
      columns: idealIndex.columns,
      unique: idealIndex.unique,
    });
  });

  return { operations };
}
