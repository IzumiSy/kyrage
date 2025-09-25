import { Operation } from "./operations/executor";
import {
  Tables,
  SchemaSnapshot,
  TableColumnAttributes,
  ForeignKeyConstraintSchema,
  PrimaryKeyConstraintSchema,
  UniqueConstraintSchema,
} from "./operations/shared/types";
import { createTable } from "./operations/table/createTable";
import { dropTable } from "./operations/table/dropTable";
import { addColumn } from "./operations/column/addColumn";
import { dropColumn } from "./operations/column/dropColumn";
import { alterColumn } from "./operations/column/alterColumn";
import { createIndex } from "./operations/index/createIndex";
import { dropIndex } from "./operations/index/dropIndex";
import { createPrimaryKeyConstraint } from "./operations/constraint/createPrimaryKeyConstraint";
import { dropPrimaryKeyConstraint } from "./operations/constraint/dropPrimaryKeyConstraint";
import { createUniqueConstraint } from "./operations/constraint/createUniqueConstraint";
import { dropUniqueConstraint } from "./operations/constraint/dropUniqueConstraint";
import { createForeignKeyConstraint } from "./operations/constraint/createForeignKeyConstraint";
import { dropForeignKeyConstraint } from "./operations/constraint/dropForeignKeyConstraint";
import * as R from "ramda";
import { IndexSchema } from "./config/loader"; // 汎用的なdiff演算子
const createDiffOperations = <K>() => ({
  added: <T>(
    currentKeys: ReadonlyArray<K>,
    idealKeys: ReadonlyArray<K>,
    mapper: (key: K) => T
  ) => R.pipe(R.difference(idealKeys), R.map(mapper))(currentKeys),
  removed: <T>(
    currentKeys: ReadonlyArray<K>,
    idealKeys: ReadonlyArray<K>,
    mapper: (key: K) => T
  ) => R.pipe(R.difference(currentKeys), R.map(mapper))(idealKeys),
  changed: <T>(
    currentKeys: ReadonlyArray<K>,
    idealKeys: ReadonlyArray<K>,
    predicate: (key: K) => boolean,
    mapper: (key: K) => T
  ) =>
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
) {
  const operations: Array<Operation> = [];
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
        addColumn(
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
        dropColumn(
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
        alterColumn(
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

export function diffTables(props: { current: Tables; ideal: Tables }) {
  const { current, ideal } = props;
  const operations: Array<Operation> = [];
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
      operations.push(createTable(table.name, table.columns));
    });

  // 削除テーブル
  diffOps.removed(currentNames, idealNames, R.identity).forEach((tableName) => {
    operations.push(dropTable(tableName));
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
  current: ReadonlyArray<IndexSchema>;
  ideal: ReadonlyArray<IndexSchema>;
}) {
  const { current, ideal } = props;
  const operations: Array<Operation> = [];
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
      operations.push(createIndex(index));
    });

  // 削除インデックス
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const index = currentIndexMap.get(key)!;
      return { table: index.table, name: index.name };
    })
    .forEach((index) => {
      operations.push(dropIndex(index));
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
      operations.push(dropIndex(currentIndex));
      operations.push(createIndex(idealIndex));
    });

  return operations;
}

export function diffPrimaryKeyConstraints(props: {
  current: ReadonlyArray<PrimaryKeyConstraintSchema>;
  ideal: ReadonlyArray<PrimaryKeyConstraintSchema>;
}) {
  const { current, ideal } = props;
  const operations: Array<Operation> = [];
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
      operations.push(createPrimaryKeyConstraint(constraint));
    });

  // 削除制約
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const constraint = currentPKMap.get(key)!;
      return { table: constraint.table, name: constraint.name };
    })
    .forEach((constraint) => {
      operations.push(dropPrimaryKeyConstraint(constraint));
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
      operations.push(dropPrimaryKeyConstraint(currentConstraint));
      operations.push(createPrimaryKeyConstraint(idealConstraint));
    });

  return operations;
}

export function diffUniqueConstraints(props: {
  current: ReadonlyArray<UniqueConstraintSchema>;
  ideal: ReadonlyArray<UniqueConstraintSchema>;
}) {
  const { current, ideal } = props;
  const operations: Array<Operation> = [];
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
      operations.push(createUniqueConstraint(constraint));
    });

  // 削除制約
  diffOps
    .removed(currentKeys, idealKeys, (key: string) => {
      const constraint = currentUQMap.get(key)!;
      return { table: constraint.table, name: constraint.name };
    })
    .forEach((constraint) => {
      operations.push(dropUniqueConstraint(constraint));
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
      operations.push(dropUniqueConstraint(currentConstraint));
      operations.push(createUniqueConstraint(idealConstraint));
    });

  return operations;
}

// Foreign Key制約のdiff計算
function diffForeignKeyConstraints(props: {
  current: ReadonlyArray<ForeignKeyConstraintSchema>;
  ideal: ReadonlyArray<ForeignKeyConstraintSchema>;
}) {
  const operations: Array<Operation> = [];
  const diffOps = createDiffOperations<string>();

  const currentNames = props.current.map(getName);
  const idealNames = props.ideal.map(getName);

  // 追加されたForeign Key制約
  operations.push(
    ...diffOps.added(currentNames, idealNames, (fkName) => {
      const fk = props.ideal.find((f) => f.name === fkName)!;
      const { table, name, ...options } = fk;
      return createForeignKeyConstraint(
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
      return dropForeignKeyConstraint(fk);
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
          dropForeignKeyConstraint(current),
          createForeignKeyConstraint(
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
}) {
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
