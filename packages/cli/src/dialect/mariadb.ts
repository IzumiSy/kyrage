import { MariaDbContainer } from "@testcontainers/mariadb";
import { MysqlCompatibleKyrageDialect } from "./mysql-compatible";
import {
  buildContainerDevDatabaseConfigSchema,
  ContainerDevDatabaseProvider,
} from "../dev/providers/container";

/** Adds MariaDB-specific identity and container configuration to shared behavior. */
export class MariadbKyrageDialect extends MysqlCompatibleKyrageDialect {
  /** Identifies MariaDB for configuration and container reuse. */
  getName() {
    return "mariadb" as const;
  }

  /** Creates MariaDB development containers. */
  createDevDatabaseProvider() {
    return new ContainerDevDatabaseProvider(
      this.getName(),
      (image) => new MariaDbContainer(image)
    );
  }

  /** Uses the default MariaDB development image unless explicitly configured. */
  parseDevDatabaseConfig(config: unknown) {
    return buildContainerDevDatabaseConfigSchema({
      defaultImage: "mariadb:11",
    }).parse(config);
  }
}
