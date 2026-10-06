import { MySqlContainer } from "@testcontainers/mysql";
import { MysqlCompatibleKyrageDialect } from "./mysql-compatible";
import {
  buildContainerDevDatabaseConfigSchema,
  ContainerDevDatabaseProvider,
} from "../dev/providers/container";

/** Adds MySQL-specific identity and container configuration to shared behavior. */
export class MysqlKyrageDialect extends MysqlCompatibleKyrageDialect {
  /** Identifies MySQL for configuration and container reuse. */
  getName() {
    return "mysql" as const;
  }

  /** Creates MySQL development containers. */
  createDevDatabaseProvider() {
    return new ContainerDevDatabaseProvider(
      this.getName(),
      (image) => new MySqlContainer(image)
    );
  }

  /** Uses the default MySQL development image unless explicitly configured. */
  parseDevDatabaseConfig(config: unknown) {
    return buildContainerDevDatabaseConfigSchema({
      defaultImage: "mysql:8",
    }).parse(config);
  }
}
