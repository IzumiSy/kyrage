import { CompiledQuery, Kysely, KyselyConfig, KyselyProps } from "kysely";
import { getDialect as getKyrageDialect } from "./dialect/factory";
import { SQLCollectingDriver } from "./collector";
import { DatabaseValue } from "./config/loader";

const createKyselyDialect = (props: DatabaseValue) =>
  getKyrageDialect(props.dialect).createKyselyDialect(props.connectionString);

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
    const dialect = createKyselyDialect(this.constructorProps.databaseProps);

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
