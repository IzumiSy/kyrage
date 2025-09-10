import { describe, it, expect } from "vitest";
import {
  CannotGetConnectionStringError,
  createContainerManager,
} from "../src/dev/container";
import { findAllKyrageManagedContainerIDs } from "./helper";

describe("DevDatabaseManager", () => {
  const expected = {
    connectionPattern: /^postgres:\/\/.*:\d+\/.*$/,
  };
  const options = {
    dialect: "postgres" as const,
    container: {
      image: "postgres:16",
    },
  };

  it("should start and stop container successfully", async () => {
    const manager = createContainerManager(options, "postgres", "dev-start");

    await manager.start();
    expect(manager.getConnectionString()).toMatch(expected.connectionPattern);

    expect(await manager.getStatus()).toEqual({
      type: "container",
      imageName: options.container.image,
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
