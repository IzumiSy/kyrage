import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { KyrageDialectInterface } from "./types";
import { CockroachDBDialect } from "../dialects/cockroachdb";
import { Pool } from "pg";
import { postgresExtraIntrospectorDriver } from "../introspection/postgres";
import { DBClient } from "../client";

export class CockroachDBKyrageDialect implements KyrageDialectInterface {
  getName() {
    return "cockroachdb" as const;
  }

  createKyselyDialect(connectionString: string) {
    return new CockroachDBDialect({
      pool: new Pool({ connectionString }),
    });
  }

  createIntrospectionDriver(client: DBClient) {
    return postgresExtraIntrospectorDriver({ client });
  }

  createDevContainer(image: string, name?: string) {
    const container = new CockroachDbContainer(image);
    if (name) {
      container.withName(name);
    }
    return container;
  }

  getDefaultImage() {
    return "cockroachdb/cockroach:latest-v24.3";
  }
}
