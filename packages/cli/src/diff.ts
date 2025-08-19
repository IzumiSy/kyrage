import {
  Tables,
  SchemaSnapshot,
  ops,
  Operation,
  TableColumnAttributes,
  ForeignKeyConstraintSchema,
  PrimaryKeyConstraintSchema,
  UniqueConstraintSchema,
} from "./operation";
import * as R from "ramda";
import { IndexSchema } from "./config/loader";
import { SchemaDiff } from "./migration";

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
        ops.addColumn(
          {
            table: currentTable.name,
            column: col.column,
          },
          col.attributes
        )
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
        ops.dropColumn(
          {
            table: currentTable.name,
            column: col.column,
          },
          col.attributes
        )
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
        ops.alterColumn(
          {
            table: currentTable.name,
            column: col.column,
          },
          col.before,
          col.after
        )
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
  current: IndexSchema[];
  ideal: IndexSchema[];
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const indexKey = (i: IndexSchema) => `${i.table}:${i.name}`;

  // SQLレベルでシステム生成のインデックスは除外済みなので、すべてを対象とする
  const currentIndexMap = new Map(current.map((i) => [indexKey(i), i]));
  const idealIndexMap = new Map(ideal.map((i) => [indexKey(i), i]));

  const currentKeys = Array.from(currentIndexMap.keys());
  const idealKeys = Array.from(idealIndexMap.keys());

  // 追加インデックス
  diffOps
    .added(currentKeys, idealKeys, (key: string) => idealIndexMap.get(key)!)
    .forEach((index) => {
      operations.push(ops.createIndex(index));
    });

  // 削除インデックス
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const index = currentIndexMap.get(key)!;
      return { table: index.table, name: index.name };
    })
    .forEach((index) => {
      operations.push(ops.dropIndex(index));
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
      operations.push(ops.dropIndex(currentIndex));
      operations.push(ops.createIndex(idealIndex));
    });

  return operations;
}

export function diffPrimaryKeyConstraints(props: {
  current: PrimaryKeyConstraintSchema[];
  ideal: PrimaryKeyConstraintSchema[];
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const constraintKey = (pk: PrimaryKeyConstraintSchema) =>
    `${pk.table}:${pk.name}`;

  const currentPKMap = new Map(current.map((pk) => [constraintKey(pk), pk]));
  const idealPKMap = new Map(ideal.map((pk) => [constraintKey(pk), pk]));

  const currentKeys = Array.from(currentPKMap.keys());
  const idealKeys = Array.from(idealPKMap.keys());

  // 追加制約
  diffOps
    .added(currentKeys, idealKeys, (key: string) => idealPKMap.get(key)!)
    .forEach((constraint) => {
      operations.push(ops.createPrimaryKeyConstraint(constraint));
    });

  // 削除制約
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const constraint = currentPKMap.get(key)!;
      return { table: constraint.table, name: constraint.name };
    })
    .forEach((constraint) => {
      operations.push(ops.dropPrimaryKeyConstraint(constraint));
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
      operations.push(ops.dropPrimaryKeyConstraint(currentConstraint));
      operations.push(ops.createPrimaryKeyConstraint(idealConstraint));
    });

  return operations;
}

export function diffUniqueConstraints(props: {
  current: UniqueConstraintSchema[];
  ideal: UniqueConstraintSchema[];
}): Operation[] {
  const { current, ideal } = props;
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();
  const constraintKey = (uq: UniqueConstraintSchema) =>
    `${uq.table}:${uq.name}`;

  const currentUQMap = new Map(current.map((uq) => [constraintKey(uq), uq]));
  const idealUQMap = new Map(ideal.map((uq) => [constraintKey(uq), uq]));

  const currentKeys = Array.from(currentUQMap.keys());
  const idealKeys = Array.from(idealUQMap.keys());

  // 追加制約
  diffOps
    .added(currentKeys, idealKeys, (key: string) => idealUQMap.get(key)!)
    .forEach((constraint) => {
      operations.push(ops.createUniqueConstraint(constraint));
    });

  // 削除制約
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const constraint = currentUQMap.get(key)!;
      return { table: constraint.table, name: constraint.name };
    })
    .forEach((constraint) => {
      operations.push(ops.dropUniqueConstraint(constraint));
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
      operations.push(ops.dropUniqueConstraint(currentConstraint));
      operations.push(ops.createUniqueConstraint(idealConstraint));
    });

  return operations;
}

// Foreign Key制約のdiff計算
function diffForeignKeyConstraints(props: {
  current: ForeignKeyConstraintSchema[];
  ideal: ForeignKeyConstraintSchema[];
}): Operation[] {
  const operations: Operation[] = [];
  const diffOps = createDiffOperations<string>();

  const currentNames = props.current.map(getName);
  const idealNames = props.ideal.map(getName);

  // 追加されたForeign Key制約
  operations.push(
    ...diffOps.added(currentNames, idealNames, (fkName) => {
      const fk = props.ideal.find((f) => f.name === fkName)!;
      const { table, name, ...options } = fk;
      return ops.createForeignKeyConstraint(
        {
          table,
          name,
        },
        options
      );
    })
  );

  // 削除されたForeign Key制約
  operations.push(
    ...diffOps.removed(currentNames, idealNames, (fkName) => {
      const fk = props.current.find((f) => f.name === fkName)!;
      return ops.dropForeignKeyConstraint(fk);
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
      .changed(currentNames, idealNames, foreignKeyChanged, (fkName) => {
        const current = props.current.find((f) => f.name === fkName)!;
        const ideal = props.ideal.find((f) => f.name === fkName)!;
        const { table, name, ...options } = ideal;
        return [
          ops.dropForeignKeyConstraint(current),
          ops.createForeignKeyConstraint(
            {
              table,
              name,
            },
            options
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
