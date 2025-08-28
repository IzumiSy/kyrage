import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { DevDatabaseValue, DialectEnum } from "../config/loader";

export type DevDatabaseManager = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getConnectionString: () => string | null;
  isRunning: () => boolean;
  clean: () => Promise<void>;
};

export interface ContainerOptions {
  image: string;
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

  protected image: string;
  protected reuse: boolean;
  protected containerName?: string;

  constructor(options: ContainerOptions) {
    this.image = options.image;
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
    // For now, TestContainers will handle cleanup automatically
    // when the process exits. In the future, we might implement
    // persistent container management here.
  }

  isRunning() {
    return this.startedContainer !== null;
  }

  async clean(): Promise<void> {
    // TestContainers doesn't provide a direct API to clean up containers
    // We can implement this by using Docker API directly or leave it as no-op
    // since TestContainers handles cleanup automatically on process exit
    if (this.startedContainer) {
      await this.startedContainer.stop();
      this.startedContainer = null;
    }
  }
}

export class PostgreSqlDevDatabaseManager extends ContainerDevDatabaseManager<PostgreSqlContainer> {
  public readonly container: PostgreSqlContainer;

  constructor(props: ContainerOptions) {
    super(props);
    this.container = new PostgreSqlContainer(this.image);
  }

  createContainer() {
    return this.container;
  }
}

export class CockroachDbDevDatabaseManager extends ContainerDevDatabaseManager<CockroachDbContainer> {
  public readonly container: CockroachDbContainer;

  constructor(props: ContainerOptions) {
    super(props);
    this.container = new CockroachDbContainer(this.image);
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
    const containerOptions: ContainerOptions = {
      image: devConfig.container.image,
      reuse: devConfig.container.reuse || false,
      containerName: devConfig.container.name,
    };

    switch (dialect) {
      case "postgres":
        return new PostgreSqlDevDatabaseManager(containerOptions);
      case "cockroachdb":
        return new CockroachDbDevDatabaseManager(containerOptions);
      default:
        throw new Error(`Unsupported dialect for container: ${dialect}`);
    }
  } else {
    throw new Error("Invalid dev database configuration");
  }
};
