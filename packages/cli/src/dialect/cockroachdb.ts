import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { IntrospectProps, KyrageDialect } from "./types";
import { Pool } from "pg";
import { DBClient } from "../client";
import {
  Kysely,
  MigrationLockOptions,
  PostgresAdapter,
  PostgresDialect,
} from "kysely";
import { convertPSQLTypeName, doPSQLintrospect } from "./postgres";
import {
  buildContainerDevDatabaseConfigSchema,
  ContainerDevDatabaseProvider,
  hasRunningDevStartContainer,
} from "../dev/providers/container";

export class CockroachDBKyrageDialect implements KyrageDialect {
  getName() {
    return "cockroachdb" as const;
  }

  createKyselyDialect(connectionString: string) {
    return new CockroachDBDialect({
      pool: new Pool({ connectionString }),
    });
  }

  createIntrospectionDriver(client: DBClient) {
    const systemGeneratedColumnNames = ["rowid"];

    return {
      convertTypeName: convertPSQLTypeName,
      introspect: async (props: IntrospectProps) => {
        const r = await doPSQLintrospect(client)(props);

        // Filter only user-defined columns
        const tables = r.tables.filter(
          (t) => !systemGeneratedColumnNames.includes(t.name)
        );

        return {
          tables,
          indexes: r.indexes,
          constraints: r.constraints,
        };
      },
    };
  }

  createDevDatabaseProvider() {
    return new ContainerDevDatabaseProvider(
      this.getName(),
      (image) => new CockroachDbContainer(image)
    );
  }

  parseDevDatabaseConfig(config: unknown) {
    // CockroachDB supports container-based dev databases only
    return buildContainerDevDatabaseConfigSchema({
      defaultImage: "cockroachdb/cockroach:latest-v24.3",
    }).parse(config);
  }

  async hasReusableDevDatabase(): Promise<boolean> {
    return hasRunningDevStartContainer(this.getName());
  }
}

// Ref: https://github.com/kysely-org/kysely/issues/325#issuecomment-1426878934
class CockroachDBAdapter extends PostgresAdapter {
  override async acquireMigrationLock(
    db: Kysely<any>,
    options: MigrationLockOptions
  ) {
    await db.selectFrom(options.lockTable).selectAll().forUpdate().execute();
  }
}

export class CockroachDBDialect extends PostgresDialect {
  override createAdapter() {
    return new CockroachDBAdapter();
  }
}
