import { PostgresDialect } from "kysely";
import { Pool } from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { KyrageDialectInterface } from "./types";
import { postgresExtraIntrospectorDriver } from "../introspection/postgres";
import { DBClient } from "../client";

export class PostgresKyrageDialect implements KyrageDialectInterface {
  getName() {
    return "postgres" as const;
  }

  createKyselyDialect(connectionString: string) {
    return new PostgresDialect({
      pool: new Pool({ connectionString }),
    });
  }

  createIntrospectionDriver(client: DBClient) {
    return postgresExtraIntrospectorDriver({ client });
  }

  createDevContainer(image: string, name?: string) {
    const container = new PostgreSqlContainer(image);
    if (name) {
      container.withName(name);
    }
    return container;
  }

  getDefaultImage() {
    return "postgres:16";
  }
}
