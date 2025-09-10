import {
  GenericContainer,
  getContainerRuntimeClient,
  StartedTestContainer,
} from "testcontainers";
import { DevDatabaseValue, DialectEnum } from "../config/loader";
import { getDialect } from "../dialect/factory";

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
  getConnectionString: () => string;
  getStatus: () => Promise<DevStatus | null>;
};

type ConnectableStartedContainer = StartedTestContainer & {
  getConnectionUri: () => string;
};

export type StartableContainer = Omit<GenericContainer, "start"> & {
  start: () => Promise<ConnectableStartedContainer>;
};

export const DialectKey = "kyrage.dialect";
export const ManagedKey = "kyrage.managed";
export const DevStartKey = "kyrage.managed-by";

/**
 * dev start コンテナが実行中かどうかを確認する
 */
export const hasRunningDevStartContainer = async (
  dialect: DialectEnum
): Promise<boolean> => {
  const runtime = await getContainerRuntimeClient();
  const allContainers = await runtime.container.list();

  return allContainers.some(
    (container) =>
      container.Labels[ManagedKey] === "true" &&
      container.Labels[DevStartKey] === "dev-start" &&
      container.Labels[DialectKey] === dialect &&
      container.State === "running"
  );
};

/**
 * 全てのkyrage管理コンテナを削除する
 */
export const removeAllKyrageManagedContainers = async () => {
  const runtime = await getContainerRuntimeClient();
  const allContainers = await runtime.container.list();

  const kyrageManagedContainers = allContainers
    .filter((container) => container.Labels[ManagedKey] === "true")
    .map((container) => container.Id);

  await Promise.allSettled(
    kyrageManagedContainers.map(async (id) =>
      runtime.container.getById(id).remove({ force: true })
    )
  );
};

export const CannotGetConnectionStringError = new Error(
  "Dev database is not started or unavailable"
);

export class ContainerDevDatabaseManager<C extends StartableContainer>
  implements DevDatabaseManager
{
  protected startedContainer: ConnectableStartedContainer | null = null;
  protected container: C;

  constructor(
    private options: {
      dialect: DialectEnum;
      containerName?: string;
      manageType?: "dev-start" | "one-off"; // コンテナの種類を識別
    },
    createContainer: () => C
  ) {
    const container = createContainer();
    const manageType = this.options.manageType || "one-off";

    container.withLabels({
      [DialectKey]: this.options.dialect,
      [ManagedKey]: "true",
      [DevStartKey]: manageType,
    });

    // dev-start コンテナは常にreuse、one-offは再利用しない
    if (manageType === "dev-start") {
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
    return runtime.container.fetchByLabel(DialectKey, this.options.dialect, {
      status: ["running"],
    });
  }

  async exists() {
    return !!(await this.findRunningContainer());
  }

  async start() {
    this.startedContainer = await this.container.start();
  }

  getConnectionString() {
    if (!this.startedContainer) {
      throw CannotGetConnectionStringError;
    }
    return this.startedContainer.getConnectionUri();
  }

  async stop() {
    if (this.startedContainer) {
      await this.startedContainer.stop();
      this.startedContainer = null;
    }
  }

  async remove() {
    await removeAllKyrageManagedContainers();
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

export class ConnectionStringDevDatabaseManager implements DevDatabaseManager {
  constructor(private connectionString: string) {}

  async start() {
    // No-op for connection string
  }

  async stop() {
    // No-op for connection string
  }

  async remove() {
    // No-op for connection string (外部の接続文字列は削除できない)
  }

  async exists() {
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

/**
 * コンテナマネージャーを作成する共通関数
 */
export const createContainerManager = (
  devConfig: NonNullable<DevDatabaseValue>,
  dialect: DialectEnum,
  manageType: "dev-start" | "one-off"
) => {
  if ("connectionString" in devConfig) {
    return new ConnectionStringDevDatabaseManager(devConfig.connectionString);
  } else if ("container" in devConfig) {
    return new ContainerDevDatabaseManager(
      {
        dialect,
        containerName:
          manageType === "dev-start" ? devConfig.container.name : undefined,
        manageType,
      },
      () =>
        getDialect(dialect).createDevDatabaseContainer(
          devConfig.container.image
        )
    );
  } else {
    throw new Error("Invalid dev database configuration");
  }
};
