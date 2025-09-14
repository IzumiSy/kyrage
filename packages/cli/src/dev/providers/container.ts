import {
  DevDatabaseProvider,
  DevDatabaseInstance,
  DevDatabaseManageType,
  DevDatabaseStatus,
} from "../types";
import {
  hasRunningDevStartContainer,
  removeAllKyrageManagedContainers,
  DialectKey,
  ManagedKey,
  DevStartKey,
} from "../container";
import { DialectEnum } from "../../config/loader";
import { StartedTestContainer } from "testcontainers/build/test-container";
import { GenericContainer, getContainerRuntimeClient } from "testcontainers";
import z from "zod";

export const buildContainerDevDatabaseConfigSchema = (options: {
  defaultImage: string;
}) =>
  z.object({
    container: z.object({
      image: z.string().default(options.defaultImage),
      name: z.string().optional(),
    }),
  });
export type ContainerDevDatabaseConfig = z.infer<
  ReturnType<typeof buildContainerDevDatabaseConfigSchema>
>;

type ConnectableStartedContainer = StartedTestContainer & {
  getConnectionUri: () => string;
};

export type StartableContainer = Omit<GenericContainer, "start"> & {
  start: () => Promise<ConnectableStartedContainer>;
};

type ContainerFactory = (image: string) => StartableContainer;

/**
 * Container-based dev database provider
 *
 * Provides Docker container-based development database environments.
 * Used by PostgreSQL and CockroachDB dialects.
 */
export class ContainerDevDatabaseProvider implements DevDatabaseProvider {
  constructor(
    private dialect: DialectEnum,
    private containerFactory: ContainerFactory
  ) {}

  async setup(
    config: ContainerDevDatabaseConfig,
    manageType: DevDatabaseManageType
  ): Promise<DevDatabaseInstance> {
    return new ContainerDevDatabaseInstance({
      dialect: this.dialect,
      manageType: manageType,
      containerName: config.container.name,
      containerFactory: () => this.containerFactory(config.container.image),
    });
  }

  async hasExisting(manageType: DevDatabaseManageType): Promise<boolean> {
    if (manageType === "dev-start") {
      return hasRunningDevStartContainer(this.dialect);
    }
    return false;
  }

  async cleanup(): Promise<void> {
    await removeAllKyrageManagedContainers();
  }
}

/**
 * Container-based dev database instance
 *
 * Manages the lifecycle of a single Docker container for dev database.
 */
class ContainerDevDatabaseInstance implements DevDatabaseInstance {
  private startedContainer: ConnectableStartedContainer | null = null;
  private container: StartableContainer;

  constructor(
    private options: {
      dialect: DialectEnum;
      manageType: DevDatabaseManageType;
      containerName?: string;
      containerFactory: () => StartableContainer;
    }
  ) {
    this.container = this.setupContainer();
  }

  private setupContainer(): StartableContainer {
    const container = this.options.containerFactory();

    container.withLabels({
      [DialectKey]: this.options.dialect,
      [ManagedKey]: "true",
      [DevStartKey]: this.options.manageType,
    });

    if (this.options.manageType === "dev-start") {
      container.withReuse();
    }

    if (this.options.containerName) {
      container.withName(this.options.containerName);
    }

    return container;
  }

  async start(): Promise<void> {
    this.startedContainer = await this.container.start();
  }

  async stop(): Promise<void> {
    if (this.startedContainer) {
      await this.startedContainer.stop();
      this.startedContainer = null;
    }
  }

  async remove(): Promise<void> {
    await this.stop();
    // Container removal is handled by the cleanup process
  }

  getConnectionString(): string {
    if (!this.startedContainer) {
      throw new Error("Container is not started");
    }
    return this.startedContainer.getConnectionUri();
  }

  async getStatus(): Promise<DevDatabaseStatus> {
    if (!this.startedContainer) {
      return { type: "unavailable" };
    }

    try {
      // Use runtime client to inspect container
      const runtime = await getContainerRuntimeClient();
      const runningContainer = await runtime.container.fetchByLabel(
        DialectKey,
        this.options.dialect,
        { status: ["running"] }
      );

      if (runningContainer) {
        const r = await runningContainer.inspect();
        return {
          type: "container",
          imageName: r.Config.Image,
          containerID: r.Id,
        };
      }

      return { type: "unavailable" };
    } catch {
      return { type: "unavailable" };
    }
  }

  isAvailable(): boolean {
    return !!this.startedContainer;
  }
}
