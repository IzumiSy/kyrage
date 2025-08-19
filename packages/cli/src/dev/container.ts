import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { DatabaseValue, DevDatabaseValue, DialectEnum } from "../config/loader";

export interface DevDatabaseManager {
  start(): Promise<DatabaseValue>;
  stop(): Promise<void>;
}

export class ContainerDevDatabaseManager implements DevDatabaseManager {
  constructor(
    private image: string,
    private dialect: DialectEnum
  ) {}

  async start(): Promise<DatabaseValue> {
    const container = this.getContainer();
    const startedContainer = await container.start();

    return {
      dialect: this.dialect,
      connectionString: startedContainer.getConnectionUri(),
    };
  }

  async stop(): Promise<void> {
    // For now, TestContainers will handle cleanup automatically
    // when the process exits. In the future, we might implement
    // persistent container management here.
  }

  private getContainer() {
    if (this.image.includes("postgres")) {
      return new PostgreSqlContainer(this.image);
    }
    if (this.image.includes("cockroach")) {
      return new CockroachDbContainer(this.image);
    }
    throw new Error(`Unsupported container image: ${this.image}`);
  }
}

export class ConnectionStringDevDatabaseManager implements DevDatabaseManager {
  constructor(
    private connectionString: string,
    private dialect: DialectEnum
  ) {}

  async start(): Promise<DatabaseValue> {
    return {
      dialect: this.dialect,
      connectionString: this.connectionString,
    };
  }

  async stop(): Promise<void> {
    // No-op for connection string
  }
}

export const createDevDatabaseManager = (
  devConfig: NonNullable<DevDatabaseValue>,
  dialect: DialectEnum
): DevDatabaseManager => {
  if ("connectionString" in devConfig) {
    return new ConnectionStringDevDatabaseManager(
      devConfig.connectionString,
      dialect
    );
  } else if ("image" in devConfig) {
    return new ContainerDevDatabaseManager(devConfig.image, dialect);
  } else {
    throw new Error("Invalid dev database configuration");
  }
};
