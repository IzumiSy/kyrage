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

export type StartableContainer = Omit<GenericContainer, "start"> & {
  start: () => Promise<ConnectableStartedContainer>;
};

const DialectKey = "kyrage.dialect";
const ManagedKey = "kyrage.managed";

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
    private options: ContainerOptions,
    createContainer: () => C
  ) {
    const container = createContainer();
    container.withLabels({
      [DialectKey]: this.options.dialect,
      [ManagedKey]: "true",
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
    if (this.startedContainer) {
      return this.startedContainer.getConnectionUri();
    }
    return null;
  }

  async stop() {
    if (this.startedContainer) {
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

export const createDevDatabaseManager = (
  devConfig: NonNullable<DevDatabaseValue>,
  dialect: DialectEnum
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

export interface DevDatabaseStartOptions {
  applyMigrations?: boolean;
  config: ConfigValue;
  logger: Logger;
}

export interface DevDatabaseStartResult {
  manager: DevDatabaseManager;
  connectionString: string;
  appliedMigrations: number;
}

/**
 * Start development database and optionally apply migrations
 */
export async function startDevDatabase(
  options: DevDatabaseStartOptions
): Promise<DevDatabaseStartResult> {
  const { config, logger, applyMigrations = true } = options;
  const { reporter } = logger;

  if (!config.dev) {
    throw new Error("Dev database configuration is required");
  }

  const dialect = config.database.dialect;
  const devManager = createDevDatabaseManager(config.dev, dialect);

  // Check if reuse is enabled and container is already running
  const isReuse = "container" in config.dev && config.dev.container.reuse;
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

  let appliedMigrations = 0;

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

      appliedMigrations = pendingMigrations.length;
    }
  }

  return {
    manager: devManager,
    connectionString,
    appliedMigrations,
  };
}
