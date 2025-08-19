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
import {
  PrimaryKeyConstraint,
  UniqueConstraint,
  ForeignKeyConstraint,
} from "./schema";

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
  current: Tables;
  ideal: Tables;
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const currentNames = R.map(getName, current);
  const idealNames = R.map(getName, ideal);

  // 追加テーブル
  diffOps
    .added(currentNames, idealNames, (name: string) => {
      const table = ideal.find((t) => t.name === name)!;
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
    ideal.some((t) => t.name === currentTable.name)
  )(current).forEach((currentTable: Tables[0]) => {
    const idealTable = ideal.find((t) => t.name === currentTable.name)!;
    operations.push(...computeTableColumnOperations(currentTable, idealTable));
  });

  return operations;
}

export function diffIndexes(props: {
  current: IndexDef[];
  ideal: IndexDef[];
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const indexKey = (i: IndexDef) => `${i.table}:${i.name}`;

  // SQLレベルでシステム生成のインデックスは除外済みなので、すべてを対象とする
  const currentIndexMap = new Map(current.map((i) => [indexKey(i), i]));
  const idealIndexMap = new Map(ideal.map((i) => [indexKey(i), i]));

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

export function diffPrimaryKeyConstraints(props: {
  current: PrimaryKeyConstraint[];
  ideal: PrimaryKeyConstraint[];
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const constraintKey = (pk: PrimaryKeyConstraint) => `${pk.table}:${pk.name}`;

  const currentPKMap = new Map(current.map((pk) => [constraintKey(pk), pk]));
  const idealPKMap = new Map(ideal.map((pk) => [constraintKey(pk), pk]));

  const currentKeys = Array.from(currentPKMap.keys());
  const idealKeys = Array.from(idealPKMap.keys());

  // 追加制約
  diffOps
    .added(currentKeys, idealKeys, (key: string) => idealPKMap.get(key)!)
    .forEach((constraint) => {
      operations.push(
        ops.createPrimaryKeyConstraint(
          constraint.table,
          constraint.name,
          constraint.columns
        )
      );
    });

  // 削除制約
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const constraint = currentPKMap.get(key)!;
      return { table: constraint.table, name: constraint.name };
    })
    .forEach((constraint) => {
      operations.push(
        ops.dropPrimaryKeyConstraint(constraint.table, constraint.name)
      );
    });

  // 変更制約（カラムが変更された場合は削除→再作成）
  diffOps
    .changed(
      currentKeys,
      idealKeys,
      (key: string) => {
        const current = currentPKMap.get(key)!;
        const ideal = idealPKMap.get(key)!;
        return !R.equals(current.columns, ideal.columns);
      },
      (key: string) => {
        const current = currentPKMap.get(key)!;
        const ideal = idealPKMap.get(key)!;
        return { current, ideal };
      }
    )
    .forEach(({ current: currentConstraint, ideal: idealConstraint }) => {
      // 削除してから再作成
      operations.push(
        ops.dropPrimaryKeyConstraint(
          currentConstraint.table,
          currentConstraint.name
        )
      );
      operations.push(
        ops.createPrimaryKeyConstraint(
          idealConstraint.table,
          idealConstraint.name,
          idealConstraint.columns
        )
      );
    });

  return operations;
}

export function diffUniqueConstraints(props: {
  current: UniqueConstraint[];
  ideal: UniqueConstraint[];
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const constraintKey = (uq: UniqueConstraint) => `${uq.table}:${uq.name}`;

  const currentUQMap = new Map(current.map((uq) => [constraintKey(uq), uq]));
  const idealUQMap = new Map(ideal.map((uq) => [constraintKey(uq), uq]));

  const currentKeys = Array.from(currentUQMap.keys());
  const idealKeys = Array.from(idealUQMap.keys());

  // 追加制約
  diffOps
    .added(currentKeys, idealKeys, (key: string) => idealUQMap.get(key)!)
    .forEach((constraint) => {
      operations.push(
        ops.createUniqueConstraint(
          constraint.table,
          constraint.name,
          constraint.columns
        )
      );
    });

  // 削除制約
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const constraint = currentUQMap.get(key)!;
      return { table: constraint.table, name: constraint.name };
    })
    .forEach((constraint) => {
      operations.push(
        ops.dropUniqueConstraint(constraint.table, constraint.name)
      );
    });

  // 変更制約（カラムが変更された場合は削除→再作成）
  diffOps
    .changed(
      currentKeys,
      idealKeys,
      (key: string) => {
        const current = currentUQMap.get(key)!;
        const ideal = idealUQMap.get(key)!;
        return !R.equals(current.columns, ideal.columns);
      },
      (key: string) => {
        const current = currentUQMap.get(key)!;
        const ideal = idealUQMap.get(key)!;
        return { current, ideal };
      }
    )
    .forEach(({ current: currentConstraint, ideal: idealConstraint }) => {
      // 削除してから再作成
      operations.push(
        ops.dropUniqueConstraint(
          currentConstraint.table,
          currentConstraint.name
        )
      );
      operations.push(
        ops.createUniqueConstraint(
          idealConstraint.table,
          idealConstraint.name,
          idealConstraint.columns
        )
      );
    });

  return operations;
}

// Foreign Key制約のdiff計算
function diffForeignKeyConstraints(props: {
  current: ForeignKeyConstraint[];
  ideal: ForeignKeyConstraint[];
}): Operation[] {
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();

  const currentNames = props.current.map(getName);
  const idealNames = props.ideal.map(getName);

  // 追加されたForeign Key制約
  operations.push(
    ...diffOps.added(currentNames, idealNames, (name) => {
      const fk = props.ideal.find((f) => f.name === name)!;
      return ops.createForeignKeyConstraint(
        fk.table,
        fk.name,
        fk.columns,
        fk.referencedTable,
        fk.referencedColumns,
        fk.onDelete,
        fk.onUpdate
      );
    })
  );

  // 削除されたForeign Key制約
  operations.push(
    ...diffOps.removed(currentNames, idealNames, (name) => {
      const fk = props.current.find((f) => f.name === name)!;
      return ops.dropForeignKeyConstraint(fk.table, fk.name);
    })
  );

  // 変更されたForeign Key制約（削除→追加で対応）
  const foreignKeyChanged = (name: string) => {
    const current = props.current.find((f) => f.name === name);
    const ideal = props.ideal.find((f) => f.name === name);
    if (!current || !ideal) return false;

    return !(
      R.equals(current.columns, ideal.columns) &&
      current.referencedTable === ideal.referencedTable &&
      R.equals(current.referencedColumns, ideal.referencedColumns) &&
      current.onDelete === ideal.onDelete &&
      current.onUpdate === ideal.onUpdate
    );
  };

  operations.push(
    ...diffOps
      .changed(currentNames, idealNames, foreignKeyChanged, (name) => {
        const current = props.current.find((f) => f.name === name)!;
        const ideal = props.ideal.find((f) => f.name === name)!;
        return [
          ops.dropForeignKeyConstraint(current.table, current.name),
          ops.createForeignKeyConstraint(
            ideal.table,
            ideal.name,
            ideal.columns,
            ideal.referencedTable,
            ideal.referencedColumns,
            ideal.onDelete,
            ideal.onUpdate
          ),
        ];
      })
      .flat()
  );

  return operations;
}

export function diffSchema(props: {
  current: SchemaSnapshot;
  ideal: SchemaSnapshot;
}): SchemaDiff {
  const tableOperations = diffTables({
    current: props.current.tables,
    ideal: props.ideal.tables,
  });
  const indexOperations = diffIndexes({
    current: props.current.indexes,
    ideal: props.ideal.indexes,
  });
  const primaryKeyOperations = diffPrimaryKeyConstraints({
    current: props.current.primaryKeyConstraints,
    ideal: props.ideal.primaryKeyConstraints,
  });
  const uniqueOperations = diffUniqueConstraints({
    current: props.current.uniqueConstraints,
    ideal: props.ideal.uniqueConstraints,
  });
  const foreignKeyOperations = diffForeignKeyConstraints({
    current: props.current.foreignKeyConstraints,
    ideal: props.ideal.foreignKeyConstraints,
  });

  return {
    operations: [
      ...tableOperations,
      ...indexOperations,
      ...primaryKeyOperations,
      ...uniqueOperations,
      ...foreignKeyOperations,
    ],
  };
}
