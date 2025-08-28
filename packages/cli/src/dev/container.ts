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
  remove: () => Promise<void>;
  exists: () => Promise<boolean>;
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

  /**
   * 実行中のコンテナを取得する共通処理
   */
  private async findRunningContainer() {
    const runtime = await getContainerRuntimeClient();
    return runtime.container.fetchByLabel(
      this.DialectKey,
      this.options.dialect,
      { status: ["running"] }
    );
  }

  /**
   * 全てのコンテナ（実行中・停止中）を取得する共通処理
   */
  private async findAllContainers() {
    const runtime = await getContainerRuntimeClient();
    // 実行中と停止中のコンテナを分けて取得
    const runningContainers = await runtime.container.fetchByLabel(
      this.DialectKey,
      this.options.dialect,
      { status: ["running"] }
    );
    const stoppedContainers = await runtime.container.fetchByLabel(
      this.DialectKey,
      this.options.dialect,
      { status: ["exited", "created"] }
    );

    const containers = [];
    if (runningContainers) containers.push(runningContainers);
    if (stoppedContainers) containers.push(stoppedContainers);

    return containers;
  }

  async exists(): Promise<boolean> {
    const container = await this.findRunningContainer();
    return container !== null;
  }

  async start() {
    // TestContainersのreuseが既存コンテナを自動検出・再利用してくれる
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

  async remove(): Promise<void> {
    // 停止済み・実行中問わず、ラベルで検索して削除
    const containers = await this.findAllContainers();

    for (const container of containers) {
      try {
        await container.remove({ force: true }); // force=trueで実行中でも削除
      } catch (error) {
        // 既に削除済みなどのエラーは無視
        console.warn(`Failed to remove container: ${error}`);
      }
    }

    this.startedContainer = null;
  }

  async getStatus() {
    const runningContainer = await this.findRunningContainer();

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

  async remove(): Promise<void> {
    // No-op for connection string (外部の接続文字列は削除できない)
  }

  async exists(): Promise<boolean> {
    // 常に存在すると仮定（外部接続文字列なので）
    return true;
  }

  getConnectionString() {
    return this.connectionString;
  }

  async getStatus() {
    return {
      type: "connectionString" as const,
    };
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
