import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { KyrageDialect } from "./types";
import { Pool } from "pg";
import { DBClient } from "../client";
import {
  Kysely,
  MigrationLockOptions,
  PostgresAdapter,
  PostgresDialect,
} from "kysely";
import { postgresExtraIntrospectorDriver } from "./postgres";

export class CockroachDBKyrageDialect implements KyrageDialect {
  getName() {
    return "cockroachdb" as const;
  }

  getDevDatabaseImageName() {
    return "cockroachdb/cockroach:latest-v24.3";
  }

  createKyselyDialect(connectionString: string) {
    return new CockroachDBDialect({
      pool: new Pool({ connectionString }),
    });
  }

  createIntrospectionDriver(client: DBClient) {
    return postgresExtraIntrospectorDriver({ client });
  }

  createDevDatabaseContainer(image: string) {
    return new CockroachDbContainer(image);
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
