import { getClient } from "../src/client";
import {
  defineConfig,
  DefineConfigProp,
  DefinedTables,
} from "../src/config/builder";
import { DatabaseValue, DialectEnum, configSchema } from "../src/config/loader";
import { getContainerRuntimeClient } from "testcontainers";
import { getDialect } from "../src/dialect/factory";
import { executeApply } from "../src/commands/apply";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { ManagedKey } from "../src/dev/providers/container";
import { CommonDependencies } from "../src/commands/common";

/** Expected catalog and SQL spellings, independent of production normalization. */
export type DialectTestExpectations = {
  schema: string;
  booleanDefault: string;
  rawCharType: string;
  rawTextType: string;
  primaryKeyName: (declaredName: string) => string;
  constraintMetadata: Record<string, null>;
  quote: string;
  dropUniqueSql: string;
  dropIndexTableSql: (table: string) => string;
};

const postgresExpectations: DialectTestExpectations = {
  schema: "public",
  booleanDefault: "true",
  rawCharType: "bpchar",
  rawTextType: "text",
  primaryKeyName: (name) => name,
  constraintMetadata: {
    on_delete: null,
    on_update: null,
    referenced_columns: null,
    referenced_table: null,
  },
  quote: '"',
  dropUniqueSql: "drop constraint",
  dropIndexTableSql: () => "",
};
const mysqlExpectations: DialectTestExpectations = {
  schema: "test",
  booleanDefault: "1",
  rawCharType: "char",
  rawTextType: "text",
  primaryKeyName: () => "PRIMARY",
  constraintMetadata: {},
  quote: "`",
  dropUniqueSql: "drop index",
  dropIndexTableSql: (table) => ` on \`${table}\``,
};

/** Selects independent test data once, rather than branching inside assertions. */
export const dialectTestProfiles = {
  postgres: {
    config: { container: { image: "postgres:16" } },
    expectations: postgresExpectations,
  },
  cockroachdb: {
    config: { container: { image: "cockroachdb/cockroach:latest-v24.3" } },
    expectations: postgresExpectations,
  },
  mysql: {
    config: { container: { image: "mysql:8" } },
    expectations: mysqlExpectations,
  },
  mariadb: {
    config: { container: { image: "mariadb:11" } },
    expectations: mysqlExpectations,
  },
  sqlite: {
    config: {},
    expectations: {
      ...postgresExpectations,
      rawCharType: "char(36)",
      rawTextType: "TEXT",
    },
  },
} satisfies Record<
  DialectEnum,
  { config: unknown; expectations: DialectTestExpectations }
>;

/** The CI matrix runs one dialect per Vitest invocation. */
export const testDialect = (process.env.TEST_DIALECT ??
  "postgres") as DialectEnum;

const getContainer = () => {
  const kyrageDialect = getDialect(testDialect);

  return {
    dialect: kyrageDialect,
    provider: kyrageDialect.createDevDatabaseProvider(),
    config: kyrageDialect.parseDevDatabaseConfig(
      dialectTestProfiles[testDialect].config
    ),
  };
};

/** Starts an isolated database with an explicit teardown owned by the test fixture. */
export const startTestDB = async () => {
  const { provider, dialect, config } = getContainer();
  const instance = await provider.setup(config, "one-off");
  await instance.start();

  const database = {
    dialect: dialect.getName(),
    connectionString: instance.getConnectionString(),
  };
  const client = getClient({
    database,
  });

  return {
    database,
    client,
    dialect,
    stop: () => instance.stop(),
  };
};

export const defineConfigForTest = (config: DefineConfigProp) =>
  configSchema.parse(defineConfig(config));

/**
 * テスト用にマイグレーションを生成と適用しテーブルをセットアップする
 */
export const applyTable = async (
  baseDeps: Pick<CommonDependencies, "client" | "fs">,
  config: {
    database: DatabaseValue;
    tables: DefinedTables;
  },
  hooks?: {
    beforeApply?: (deps: CommonDependencies) => Promise<void> | void;
  }
) => {
  const deps = {
    ...baseDeps,
    logger: defaultConsolaLogger,
    config: defineConfigForTest(config),
  };

  await executeGenerate(deps, {
    ignorePending: false,
    dev: false,
  });

  await hooks?.beforeApply?.(deps);
  await executeApply(deps, {
    plan: false,
    pretty: false,
  });

  return deps;
};

/** Drops test tables in dependency order using each database's native identifier quoting. */
export const dropTablesForDialect = async (props: {
  client: CommonDependencies["client"];
  tableNames: ReadonlyArray<string>;
}) => {
  await using db = props.client.getDB();
  for (const tableName of props.tableNames) {
    await db.schema.dropTable(tableName).execute();
  }
};

/**
 * 全てのkyrage管理コンテナのIDを取得する（テスト用）
 */
export const findAllKyrageManagedContainerIDs = async () => {
  const runtime = await getContainerRuntimeClient();
  const allContainers = await runtime.container.list();

  return allContainers
    .filter((container) => container.Labels[ManagedKey] === "true")
    .map((container) => container.Id);
};
