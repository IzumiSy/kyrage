import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { DatabaseValue, DevDatabaseValue, DialectEnum } from "../config/loader";

export interface DevDatabaseManager {
  start(): Promise<DatabaseValue>;
  stop(): Promise<void>;
  getConnectionString(): Promise<string | null>;
  isRunning(): Promise<boolean>;
}

export class ContainerDevDatabaseManager implements DevDatabaseManager {
  private startedContainer: any = null;

  constructor(
    private image: string,
    private dialect: DialectEnum,
    private reuse: boolean = false,
    private containerName?: string
  ) {}

  async start(): Promise<DatabaseValue> {
    const container = this.getContainer();

    if (this.reuse) {
      container.withReuse();
    }

    if (this.containerName) {
      container.withName(this.containerName);
    }

    this.startedContainer = await container.start();

    return {
      dialect: this.dialect,
      connectionString: this.startedContainer.getConnectionUri(),
    };
  }

  async stop(): Promise<void> {
    // For now, TestContainers will handle cleanup automatically
    // when the process exits. In the future, we might implement
    // persistent container management here.
  }

  async getConnectionString(): Promise<string | null> {
    if (this.startedContainer) {
      return this.startedContainer.getConnectionUri();
    }
    return null;
  }

  async isRunning(): Promise<boolean> {
    return this.startedContainer !== null;
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

  async getConnectionString(): Promise<string | null> {
    return this.connectionString;
  }

  async isRunning(): Promise<boolean> {
    // Always considered "running" for connection string based setup
    return true;
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
  } else if ("container" in devConfig) {
    return new ContainerDevDatabaseManager(
      devConfig.container.image,
      dialect,
      devConfig.container.reuse || false,
      devConfig.container.name
    );
  } else {
    throw new Error("Invalid dev database configuration");
  }
};
