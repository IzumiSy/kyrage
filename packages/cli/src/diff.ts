import {
  Operation,
  SchemaDiff,
  TableColumnAttributes,
  Tables,
  SchemaSnapshot,
  IndexDef,
  ops,
} from "./operation";
import * as R from "ramda";

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
  diffOps
    .added(dbColNames, configColNames, (column: string) => ({
      column,
      attributes: configCols[column],
    }))
    .forEach((col) => {
      operations.push(
        ops.addColumn(currentTable.name, col.column, col.attributes)
      );
    });

  // 削除カラム
  diffOps
    .removed(dbColNames, configColNames, (column: string) => ({
      column,
      attributes: dbCols[column],
    }))
    .forEach((col) => {
      operations.push(
        ops.dropColumn(currentTable.name, col.column, col.attributes)
      );
    });

  // 変更カラム
  diffOps
    .changed(
      dbColNames,
      configColNames,
      (column: string) => !columnsEqual(dbCols[column], configCols[column]),
      (column: string) => ({
        column,
        before: dbCols[column],
        after: configCols[column],
      })
    )
    .forEach((col) => {
      operations.push(
        ops.alterColumn(currentTable.name, col.column, col.before, col.after)
      );
    });

  return operations;
}

export function diffTables(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const currentNames = R.map(getName, current.tables);
  const idealNames = R.map(getName, ideal.tables);

  // 追加テーブル
  diffOps
    .added(currentNames, idealNames, (name: string) => {
      const table = ideal.tables.find((t) => t.name === name)!;
      return table;
    })
    .forEach((table) => {
      operations.push(ops.createTable(table.name, table.columns));
    });

  // 削除テーブル
  diffOps.removed(currentNames, idealNames, R.identity).forEach((tableName) => {
    operations.push(ops.dropTable(tableName));
  });

  // 変更テーブル（カラム操作）
  R.filter((currentTable: Tables[0]) =>
    ideal.tables.some((t) => t.name === currentTable.name)
  )(current.tables).forEach((currentTable: Tables[0]) => {
    const idealTable = ideal.tables.find((t) => t.name === currentTable.name)!;
    operations.push(...computeTableColumnOperations(currentTable, idealTable));
  });

  return operations;
}

export function diffIndexes(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
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
  diffOps
    .added(currentKeys, idealKeys, (key: string) => idealIndexMap.get(key)!)
    .forEach((index) => {
      operations.push(
        ops.createIndex(index.table, index.name, index.columns, index.unique)
      );
    });

  // 削除インデックス
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const index = currentIndexMap.get(key)!;
      return { table: index.table, name: index.name };
    })
    .forEach((index) => {
      operations.push(ops.dropIndex(index.table, index.name));
    });

  // 変更インデックス（削除→再作成）
  diffOps
    .changed(
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
    )
    .forEach(({ current: currentIndex, ideal: idealIndex }) => {
      // 削除してから再作成
      operations.push(ops.dropIndex(currentIndex.table, currentIndex.name));
      operations.push(
        ops.createIndex(
          idealIndex.table,
          idealIndex.name,
          idealIndex.columns,
          idealIndex.unique
        )
      );
    });

  return operations;
}

export function diffSchema(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): SchemaDiff {
  const tableOperations = diffTables(props);
  const indexOperations = diffIndexes(props);

  return {
    operations: [...tableOperations, ...indexOperations],
  };
}
