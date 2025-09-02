import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { CockroachDbContainer } from "@testcontainers/cockroachdb";
import {
  GenericContainer,
  getContainerRuntimeClient,
  StartedTestContainer,
} from "testcontainers";
import {
  DevDatabaseValue,
  DialectEnum,
  type ConfigValue,
} from "../config/loader";
import { getClient } from "../client";
import { executeApply } from "../commands/apply";
import { getPendingMigrations } from "../migration";
import { nullLogger, type Logger } from "../logger";

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
  stop: (options?: { includeForceReused?: boolean }) => Promise<void>;
  remove: () => Promise<void>;
  exists: () => Promise<boolean>;
  getConnectionString: () => string;
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

export type StartableContainer = Omit<GenericContainer, "start"> & {
  start: () => Promise<ConnectableStartedContainer>;
};

const DialectKey = "kyrage.dialect";
const ManagedKey = "kyrage.managed";
const ForceReuseKey = "kyrage.forceReuse";

/**
 * kyrage管理の全てのコンテナIDを取得する共通処理
 */
export const findAllKyrageManagedContainerIDs = async () => {
  const runtime = await getContainerRuntimeClient();
  const allContainers = await runtime.container.list();

  return allContainers
    .filter((container) => container.Labels[ManagedKey] === "true")
    .map((container) => container.Id);
};

export const removeContainersByIDs = async (ids: ReadonlyArray<string>) => {
  const runtime = await getContainerRuntimeClient();

  await Promise.allSettled(
    ids.map(async (id) => runtime.container.getById(id).remove({ force: true }))
  );
};

export abstract class ContainerDevDatabaseManager<C extends StartableContainer>
  implements DevDatabaseManager
{
  protected startedContainer: ConnectableStartedContainer | null = null;
  protected container: C;

  constructor(
    protected options: ContainerOptions,
    forceReuse: boolean = false
  ) {
    const container = this.createContainer();

    // 基本ラベル
    const labels: Record<string, string> = {
      [DialectKey]: this.options.dialect,
      [ManagedKey]: "true",
    };

    // forceReuse=trueの場合のみForceReuseKeyラベルを追加
    if (forceReuse) {
      labels[ForceReuseKey] = "true";
    }

    container.withLabels(labels);

    // 元の設定またはforceReuseが有効な場合にreuseを適用
    if (this.options.reuse || forceReuse) {
      container.withReuse();
    }

    if (this.options.containerName) {
      container.withName(this.options.containerName);
    }

    this.container = container;
  }

  // サブクラスで実装するファクトリメソッド
  protected abstract createContainer(): C;

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
      throw new Error("Container is not started or unavailable");
    }
    return this.startedContainer.getConnectionUri();
  }

  async stop(options?: { includeForceReused?: boolean }) {
    if (this.startedContainer) {
      // includeForceReused=trueの場合は強制停止、そうでなければforceReuseチェック
      if (!options?.includeForceReused) {
        const shouldSkipStop = await this.isForceReuse();
        if (shouldSkipStop) {
          // forceReuseコンテナは停止をスキップ（generate --devでの保護）
          return;
        }
      }

      await this.startedContainer.stop();
      this.startedContainer = null;
    }
  }

  async remove() {
    const containerIds = await findAllKyrageManagedContainerIDs();

    await removeContainersByIDs(containerIds);

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

  private async isForceReuse(): Promise<boolean> {
    if (!this.startedContainer) return false;

    try {
      const runtime = await getContainerRuntimeClient();
      const containerInfo = await runtime.container
        .getById(this.startedContainer.getId())
        .inspect();
      // ForceReuseKeyラベルが存在し、かつ"true"の場合のみtrue
      return containerInfo.Config.Labels[ForceReuseKey] === "true";
    } catch {
      return false;
    }
  }
}

export class PostgreSqlDevDatabaseManager extends ContainerDevDatabaseManager<PostgreSqlContainer> {
  protected createContainer() {
    return new PostgreSqlContainer(this.options.image);
  }
}

export class CockroachDbDevDatabaseManager extends ContainerDevDatabaseManager<CockroachDbContainer> {
  protected createContainer() {
    return new CockroachDbContainer(this.options.image);
  }
}

export class ConnectionStringDevDatabaseManager implements DevDatabaseManager {
  constructor(private connectionString: string) {}

  async start() {
    // No-op for connection string
  }

  async stop(_options?: { includeForceReused?: boolean }) {
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

export const createDevDatabaseManager = (
  devConfig: NonNullable<DevDatabaseValue>,
  dialect: DialectEnum,
  forceReuse: boolean = false
) => {
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
        return new PostgreSqlDevDatabaseManager(containerOptions, forceReuse);
      case "cockroachdb":
        return new CockroachDbDevDatabaseManager(containerOptions, forceReuse);
      default:
        throw new Error(`Unsupported dialect for container: ${dialect}`);
    }
  } else {
    throw new Error("Invalid dev database configuration");
  }
};

export interface DevDatabaseStartOptions {
  applyMigrations?: boolean;
  config: ConfigValue;
  logger: Logger;
  forceReuse?: boolean; // dev start コマンド用：設定に関係なくreuseを強制
}

/**
 * Start development database and optionally apply migrations
 */
export async function startDevDatabase(options: DevDatabaseStartOptions) {
  const {
    config,
    logger,
    applyMigrations = true,
    forceReuse = false,
  } = options;
  const { reporter } = logger;

  if (!config.dev) {
    throw new Error("Dev database configuration is required");
  }

  const dialect = config.database.dialect;
  const devManager = createDevDatabaseManager(config.dev, dialect, forceReuse);

  // 元の設定でのreuse判定（forceReuseも考慮）
  const isReuse =
    ("container" in config.dev && config.dev.container.reuse) || forceReuse;
  if (isReuse && (await devManager.exists())) {
    reporter.info("🔄 Reusing existing dev database...");
  } else {
    reporter.info("🚀 Starting dev database...");
  }

  await devManager.start();
  reporter.success(`Dev database started: ${dialect}`);

  const connectionString = devManager.getConnectionString();
  if (!connectionString) {
    throw new Error("Failed to get connection string for dev database");
  }

  if (applyMigrations) {
    const devClient = getClient({
      database: { dialect, connectionString },
    });

    const pendingMigrations = await getPendingMigrations(devClient);
    if (pendingMigrations.length > 0) {
      reporter.info(
        `🔄 Applying ${pendingMigrations.length} pending migrations...`
      );

      await executeApply(
        { client: devClient, logger: nullLogger, config },
        { plan: false, pretty: false }
      );
    }
  }

  return devManager;
}
