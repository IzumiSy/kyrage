export type TableColumnAttributes = {
  type: string;
  [key: string]: unknown;
};

export type TableDef = {
  name: string;
  columns: Record<string, TableColumnAttributes>;
};
export type Tables = Array<TableDef>;

// 追加テーブル
export type AddedTable = {
  table: string;
  columns: Record<string, TableColumnAttributes>;
};

// 削除テーブル（テーブル名のみでOK）
export type RemovedTable = string;

// 追加カラム
export type AddedColumn = {
  column: string;
  attributes: TableColumnAttributes;
};

// 削除カラム
export type RemovedColumn = {
  column: string;
  attributes: TableColumnAttributes;
};

// 型変更カラム
export type ChangedColumn = {
  column: string;
  before: TableColumnAttributes;
  after: TableColumnAttributes;
};

// テーブルごとの変更
export type ChangedTable = {
  table: string;
  addedColumns: AddedColumn[];
  removedColumns: RemovedColumn[];
  changedColumns: ChangedColumn[];
};

// 全体のdiff
export type TableDiff = {
  addedTables: AddedTable[];
  removedTables: RemovedTable[];
  changedTables: ChangedTable[];
};

export function diffTables(props: {
  current: Tables;
  ideal: Tables;
}): TableDiff {
  const { current: currentTables, ideal: idealTables } = props;
  const dbTableNames = currentTables.map((t) => t.name);
  const configTableNames = idealTables.map((t) => t.name);

  // 追加テーブル: テーブル名＋カラム定義
  const addedTables = idealTables
    .filter((t) => !dbTableNames.includes(t.name))
    .map((table) => ({
      table: table.name,
      columns: table.columns,
    }));

  // 削除テーブル: テーブル名のみ
  const removedTables = currentTables
    .filter((t) => !configTableNames.includes(t.name))
    .map((t) => t.name);

  // テーブルごとのカラム差分
  const changedTables = currentTables.reduce<ChangedTable[]>(
    (acc, currentTable) => {
      const idealTable = idealTables.find((t) => t.name === currentTable.name);
      if (!idealTable) return acc;

      const dbCols = currentTable.columns;
      const configCols = idealTable.columns;
      const dbColNames = Object.keys(dbCols);
      const configColNames = Object.keys(configCols);

      // 追加カラム: カラム名＋型情報
      const addedColumns = configColNames
        .filter((c) => !dbColNames.includes(c))
        .map((column) => ({
          column,
          attributes: configCols[column],
        }));

      // 削除カラム: カラム名＋型情報（削除前の型）
      const removedColumns = dbColNames
        .filter((c) => !configColNames.includes(c))
        .map((column) => ({
          column,
          attributes: dbCols[column],
        }));

      // 型変更カラム: before/after型情報
      const changedColumns = dbColNames
        .filter(
          (c) =>
            configColNames.includes(c) &&
            (dbCols[c].type !== configCols[c].type ||
              dbCols[c].notNull !== configCols[c].notNull ||
              dbCols[c].primaryKey !== configCols[c].primaryKey ||
              dbCols[c].unique !== configCols[c].unique)
        )
        .map((column) => ({
          column,
          before: dbCols[column],
          after: configCols[column],
        }));

      if (
        addedColumns.length > 0 ||
        removedColumns.length > 0 ||
        changedColumns.length > 0
      ) {
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

  return {
    addedTables,
    removedTables,
    changedTables,
  };
}
