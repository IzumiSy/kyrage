import {
  CompiledQuery,
  Kysely,
  MysqlDialect,
  PostgresDialect,
  SqliteDialect,
} from "kysely";
import { DialectEnum } from "./schema";
import { Pool } from "pg";
import { createPool } from "mysql2";
import Database from "better-sqlite3";
import { CockroachDBDialect } from "./dialects/cockroachdb";
import { SQLCollectingDriver } from "./collector";

type DatabaseProps = {
  dialect: DialectEnum;
  connectionString: string;
};

const getDialect = (props: DatabaseProps) => {
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
  database: DatabaseProps;
  options?: {
    plan: boolean;
  };
};

export const getClient = (props: GetClientProps) =>
  new DBClient({ databaseProps: props.database, options: props.options });

type DBClientConstructorProps = {
  databaseProps: DatabaseProps;
  options?: {
    plan: boolean;
  };
};

export class DBClient {
  private plannedQueries: CompiledQuery[] = [];
  constructor(private constructorProps: DBClientConstructorProps) {}

  getDB(options?: DBClientConstructorProps["options"]) {
    const dialect = getDialect(this.constructorProps.databaseProps);
    const isPlan = options?.plan === true;

    return new Kysely<any>({
      dialect: {
        createAdapter: () => dialect.createAdapter(),
        createDriver: () =>
          isPlan
            ? new SQLCollectingDriver(this.plannedQueries)
            : dialect.createDriver(),
        createIntrospector: (db) => dialect.createIntrospector(db),
        createQueryCompiler: () => dialect.createQueryCompiler(),
      },
    });
  }

  getPlannedQueries() {
    return this.plannedQueries;
  }

  getDialect() {
    return this.constructorProps.databaseProps.dialect;
  }
}
