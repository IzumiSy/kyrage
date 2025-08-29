import {
  CompiledQuery,
  Kysely,
  KyselyConfig,
  KyselyProps,
  MysqlDialect,
  PostgresDialect,
  SqliteDialect,
} from "kysely";
import { Pool } from "pg";
import { createPool } from "mysql2";
import Database from "better-sqlite3";
import { CockroachDBDialect } from "./dialects/cockroachdb";
import { SQLCollectingDriver } from "./collector";
import { DatabaseValue } from "./config/loader";

const getDialect = (props: DatabaseValue) => {
  switch (props.dialect) {
    case "cockroachdb": {
      return new CockroachDBDialect({
        pool: new Pool({
          connectionString: props.connectionString,
        }),
      });
    }
    case "postgres": {
      return new PostgresDialect({
        pool: new Pool({
          connectionString: props.connectionString,
        }),
      });
    }
    case "mysql": {
      return new MysqlDialect({
        pool: createPool(props.connectionString),
      });
    }
    case "sqlite": {
      return new SqliteDialect({
        database: new Database(props.connectionString),
      });
    }
    default:
      throw new Error(`Unsupported dialect: ${props.dialect}`);
  }
};

export type GetClientProps = {
  database: DatabaseValue;
  options?: {
    plan: boolean;
  };
};

export const getClient = (props: GetClientProps) =>
  new DBClient({ databaseProps: props.database, options: props.options });

type DBClientConstructorProps = {
  databaseProps: DatabaseValue;
  options?: {
    plan: boolean;
  };
};

export class DBClient {
  constructor(private constructorProps: DBClientConstructorProps) {}

  getDB(options?: DBClientConstructorProps["options"]) {
    const dialect = getDialect(this.constructorProps.databaseProps);

    return new PlannableKysely(
      {
        dialect: {
          createAdapter: () => dialect.createAdapter(),
          createDriver: () => dialect.createDriver(),
          createIntrospector: (db) => dialect.createIntrospector(db),
          createQueryCompiler: () => dialect.createQueryCompiler(),
        },
      },
      {
        isPlan: options?.plan === true,
      }
    );
  }

  getDialect() {
    return this.constructorProps.databaseProps.dialect;
  }
}

/**
 * A Kysely instance that can be used to capture queries without executing them.
 */
class PlannableKysely extends Kysely<any> {
  private plannedQueries: Array<CompiledQuery> = [];

  constructor(
    args: KyselyConfig | KyselyProps,
    options: {
      isPlan: boolean;
    }
  ) {
    const plannedQueries: Array<CompiledQuery> = [];

    super({
      dialect: {
        ...args.dialect,
        createDriver: () =>
          options.isPlan
            ? new SQLCollectingDriver(plannedQueries)
            : args.dialect.createDriver(),
      },
    });

    this.plannedQueries = plannedQueries;
  }

  getPlannedQueries() {
    return this.plannedQueries;
  }
}
