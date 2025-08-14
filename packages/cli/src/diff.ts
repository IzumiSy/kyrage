import { schemaDiffSchema } from "./schema";
import { z } from "zod";

// Derive diff-related types from the zod schema (SchemaDiffValue)
export type SchemaDiff = z.infer<typeof schemaDiffSchema>;
export type AddedTable = SchemaDiff["addedTables"][number];
export type RemovedTable = SchemaDiff["removedTables"][number];
export type ChangedTable = SchemaDiff["changedTables"][number];
export type IndexDef = SchemaDiff["addedIndexes"][number];
export type ChangedIndex = SchemaDiff["changedIndexes"][number];
export type TableColumnAttributes = AddedTable["columns"][string];

// Local types still needed for diff input (introspection snapshot) -----------------
export type TableDef = {
  name: string;
  columns: Record<string, TableColumnAttributes>;
};
export type Tables = Array<TableDef>;

export type SchemaSnapshot = {
  tables: Tables;
  indexes: IndexDef[];
};

export function diffSchema(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): SchemaDiff {
  const { current, ideal } = props;
  const currentTables = current.tables;
  const idealTables = ideal.tables;
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

  // Index diff - system-generatedなindexを除外
  const userDefinedCurrentIndexes = current.indexes.filter(
    (i) => !i.systemGenerated
  );
  const userDefinedIdealIndexes = ideal.indexes.filter(
    (i) => !i.systemGenerated
  );

  const key = (i: IndexDef) => `${i.table}:${i.name}`;
  const currentIndexMap = new Map(
    userDefinedCurrentIndexes.map((i) => [key(i), i] as const)
  );
  const idealIndexMap = new Map(
    userDefinedIdealIndexes.map((i) => [key(i), i] as const)
  );

  const addedIndexes: IndexDef[] = [];
  const removedIndexes: SchemaDiff["removedIndexes"] = [];
  const changedIndexes: ChangedIndex[] = [];

  // Determine added & changed
  for (const [k, idealIndex] of idealIndexMap.entries()) {
    const cur = currentIndexMap.get(k);
    if (!cur) {
      addedIndexes.push(idealIndex);
      continue;
    }
    const sameColumns =
      cur.columns.length === idealIndex.columns.length &&
      cur.columns.every((c, idx) => c === idealIndex.columns[idx]);
    if (!sameColumns || cur.unique !== idealIndex.unique) {
      changedIndexes.push({
        table: idealIndex.table,
        name: idealIndex.name,
        before: cur,
        after: idealIndex,
      });
    }
  }
  // Determine removed
  for (const [k, cur] of currentIndexMap.entries()) {
    if (!idealIndexMap.has(k)) {
      removedIndexes.push({ table: cur.table, name: cur.name });
    }
  }

  return {
    addedTables,
    removedTables,
    changedTables,
    addedIndexes,
    removedIndexes,
    changedIndexes,
  };
}
