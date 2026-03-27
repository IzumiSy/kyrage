import { MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import { MariaDbContainer } from "@testcontainers/mariadb";
import { KyrageDialect } from "./types";
import { DBClient } from "../client";
import { convertMysqlTypeName, doMysqlIntrospect } from "./mysql";
import {
  buildContainerDevDatabaseConfigSchema,
  ContainerDevDatabaseProvider,
  hasRunningDevStartContainer,
} from "../dev/providers/container";

/**
 * MariaDB dialect that reuses MySQL implementation.
 * MariaDB is MySQL-compatible, so we use the same Kysely dialect
 * and introspection logic as MySQL.
 */
export class MariadbKyrageDialect implements KyrageDialect {
  getName() {
    return "mariadb" as const;
  }

  createKyselyDialect(connectionString: string) {
    return new MysqlDialect({
      pool: createPool(connectionString),
    });
  }

  createIntrospectionDriver(client: DBClient) {
    return {
      convertTypeName: convertMysqlTypeName,
      introspect: doMysqlIntrospect(client),
    };
  }

  createDevDatabaseProvider() {
    return new ContainerDevDatabaseProvider(
      this.getName(),
      (image) => new MariaDbContainer(image)
    );
  }

  parseDevDatabaseConfig(config: unknown) {
    return buildContainerDevDatabaseConfigSchema({
      defaultImage: "mariadb:11",
    }).parse(config);
  }

  async hasReusableDevDatabase(): Promise<boolean> {
    return hasRunningDevStartContainer(this.getName());
  }
}
