import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { KyrageDialectInterface } from "./types";
import { Pool } from "pg";
import { DBClient } from "../client";
import {
  Kysely,
  MigrationLockOptions,
  PostgresAdapter,
  PostgresDialect,
} from "kysely";
import { postgresExtraIntrospectorDriver } from "./postgres";

export class CockroachDBKyrageDialect implements KyrageDialectInterface {
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

  createDevDatabaseContainer(image: string, name?: string) {
    const container = new CockroachDbContainer(image);
    if (name) {
      container.withName(name);
    }
    return container;
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
