import { CompiledQuery, Kysely, KyselyConfig, KyselyProps } from "kysely";
import { getDialect } from "./dialect/factory";
import { SQLCollectingDriver } from "./collector";
import { DatabaseValue } from "./config/loader";

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
    const kyselyDialect = getDialect(
      this.constructorProps.databaseProps.dialect
    ).createKyselyDialect(this.constructorProps.databaseProps.connectionString);

    return new PlannableKysely(
      {
        dialect: {
          createAdapter: () => kyselyDialect.createAdapter(),
          createDriver: () => kyselyDialect.createDriver(),
          createIntrospector: (db) => kyselyDialect.createIntrospector(db),
          createQueryCompiler: () => kyselyDialect.createQueryCompiler(),
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
