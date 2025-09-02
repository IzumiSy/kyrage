import { describe, it, expect } from "vitest";
import {
  CannotGetConnectionStringError,
  findAllKyrageManagedContainerIDs,
  PostgreSqlDevDatabaseManager,
} from "../src/dev/container";

describe("DevDatabaseManager", () => {
  const expected = {
    connectionPattern: /^postgres:\/\/.*:\d+\/.*$/,
  };
  const options = {
    dialect: "postgres" as const,
    image: "postgres:16",
  };

  it("should start and stop container successfully", async () => {
    const manager = new PostgreSqlDevDatabaseManager(options);

    await manager.start();
    expect(manager.getConnectionString()).toMatch(expected.connectionPattern);

    expect(await manager.getStatus()).toEqual({
      type: "container",
      imageName: options.image,
      containerID: expect.any(String),
    });

    const exists = await manager.exists();
    expect(exists).toBe(true);

    await manager.stop();
    expect(() => manager.getConnectionString()).toThrowError(
      CannotGetConnectionStringError
    );
    expect(await findAllKyrageManagedContainerIDs()).toEqual([]);
  });
});
