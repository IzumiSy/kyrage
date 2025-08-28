import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import {
  GenericContainer,
  getContainerRuntimeClient,
  StartedTestContainer,
} from "testcontainers";
import { DevDatabaseValue, DialectEnum } from "../config/loader";

type DevStatus =
  | {
      type: "container";
      imageName: string;
      containerID: string;
    }
  | {
      type: "connectionString";
    };

export type DevDatabaseManager = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getConnectionString: () => string | null;
  getStatus: () => Promise<DevStatus | null>;
};

export interface ContainerOptions {
  image: string;
  dialect: DialectEnum;
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
  protected container: C;

  private DialectKey = "kyrage.dialect";

  constructor(
    private options: ContainerOptions,
    createContainer: () => C
  ) {
    const container = createContainer();
    container.withLabels({
      [this.DialectKey]: this.options.dialect,
    });

    if (this.options.reuse) {
      container.withReuse();
    }
    if (this.options.containerName) {
      container.withName(this.options.containerName);
    }

    this.container = container;
  }

  async start() {
    this.startedContainer = await this.container.start();
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

  async getStatus() {
    const runtime = await getContainerRuntimeClient();
    const runningContainer = await runtime.container.fetchByLabel(
      this.DialectKey,
      this.options.dialect,
      {
        status: ["running"],
      }
    );

    if (!runningContainer) {
      return null;
    }

    const r = await runningContainer.inspect();
    return {
      type: "container" as const,
      imageName: r.Config.Image,
      containerID: r.Id,
    };
  }
}

export class PostgreSqlDevDatabaseManager extends ContainerDevDatabaseManager<PostgreSqlContainer> {
  constructor(props: ContainerOptions) {
    super(props, () => new PostgreSqlContainer(props.image));
  }
}

export class CockroachDbDevDatabaseManager extends ContainerDevDatabaseManager<CockroachDbContainer> {
  constructor(props: ContainerOptions) {
    super(props, () => new CockroachDbContainer(props.image));
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

  async getStatus() {
    return {
      type: "connectionString" as const,
    };
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
      dialect,
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
