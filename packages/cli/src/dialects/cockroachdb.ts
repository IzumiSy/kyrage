import {
  Kysely,
  MigrationLockOptions,
  PostgresAdapter,
  PostgresDialect,
} from "kysely";

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
