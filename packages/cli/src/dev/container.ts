import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { DevDatabaseValue, DialectEnum } from "../config/loader";

export type DevDatabaseManager = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getConnectionString: () => string | null;
  isRunning: () => boolean;
};

export interface ContainerOptions {
  reuse?: boolean;
  containerName?: string;
}

type ConnectableStartedContainer = StartedTestContainer & {
  getConnectionUri: () => string;
};

type StartableContainer = Omit<GenericContainer, "start"> & {
  start: () => Promise<ConnectableStartedContainer>;
};

export abstract class ContainerDevDatabaseManager<C extends StartableContainer>
  implements DevDatabaseManager
{
  protected startedContainer: ConnectableStartedContainer | null = null;
  protected reuse: boolean;
  protected containerName?: string;

  constructor(options: ContainerOptions) {
    this.reuse = options.reuse || false;
    this.containerName = options.containerName;
  }

  abstract createContainer(): C;

  async start() {
    const container = this.createContainer();

    if (this.reuse) {
      container.withReuse();
    }

    if (this.containerName) {
      container.withName(this.containerName);
    }

    this.startedContainer = await container.start();
  }

  getConnectionString() {
    if (this.startedContainer) {
      return this.startedContainer.getConnectionUri();
    }
    return null;
  }

  async stop(): Promise<void> {
    if (this.startedContainer) {
      await this.startedContainer.stop();
      this.startedContainer = null;
    }
  }

  isRunning() {
    return this.startedContainer !== null;
  }
}

export class PostgreSqlDevDatabaseManager extends ContainerDevDatabaseManager<PostgreSqlContainer> {
  public readonly container: PostgreSqlContainer;

  constructor(props: ContainerOptions, image: string) {
    super(props);
    this.container = new PostgreSqlContainer(image);
  }

  createContainer() {
    return this.container;
  }
}

export class CockroachDbDevDatabaseManager extends ContainerDevDatabaseManager<CockroachDbContainer> {
  public readonly container: CockroachDbContainer;

  constructor(props: ContainerOptions, image: string) {
    super(props);
    this.container = new CockroachDbContainer(image);
  }

  createContainer() {
    return this.container;
  }
}

export class ConnectionStringDevDatabaseManager implements DevDatabaseManager {
  constructor(private connectionString: string) {}

  async start() {
    // No-op for connection string
  }

  async stop(): Promise<void> {
    // No-op for connection string
  }

  getConnectionString() {
    return this.connectionString;
  }

  isRunning() {
    // Always considered "running" for connection string based setup
    return true;
  }

  async clean(): Promise<void> {
    // No-op for connection string based setup
  }
}

export const createDevDatabaseManager = (
  devConfig: NonNullable<DevDatabaseValue>,
  dialect: DialectEnum
): DevDatabaseManager => {
  if ("connectionString" in devConfig) {
    return new ConnectionStringDevDatabaseManager(devConfig.connectionString);
  } else if ("container" in devConfig) {
    const containerOptions = {
      reuse: devConfig.container.reuse || false,
      containerName: devConfig.container.name,
    };

    switch (dialect) {
      case "postgres":
        return new PostgreSqlDevDatabaseManager(
          containerOptions,
          devConfig.container.image
        );
      case "cockroachdb":
        return new CockroachDbDevDatabaseManager(
          containerOptions,
          devConfig.container.image
        );
      default:
        throw new Error(`Unsupported dialect for container: ${dialect}`);
    }
  } else {
    throw new Error("Invalid dev database configuration");
  }
};
