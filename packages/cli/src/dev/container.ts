import { getContainerRuntimeClient } from "testcontainers";
import { DevDatabaseValue, DialectEnum } from "../config/loader";
import { getDialect } from "../dialect/factory";
import { DevDatabaseInstance, DevDatabaseManageType } from "./types";

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

/**
 * Create a new dev database manager using the dialect-driven approach
 *
 * This replaces the old createContainerManager function with a more flexible
 * system that delegates dev database management to the appropriate dialect.
 */
export const createDevDatabaseManager = async (
  devConfig: NonNullable<DevDatabaseValue>,
  dialect: DialectEnum,
  manageType: DevDatabaseManageType
): Promise<DevDatabaseInstance> => {
  const kyrageDialect = getDialect(dialect);

  // Get the provider from the dialect and delegate setup to the provider
  return kyrageDialect
    .createDevDatabaseProvider()
    .setup(kyrageDialect.parseDevDatabaseConfig(devConfig), manageType);
};
