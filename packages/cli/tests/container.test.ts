import { describe, it, expect } from "vitest";
import { createDevDatabaseManager } from "../src/dev/container";
import { findAllKyrageManagedContainerIDs } from "./helper";

describe.skip("DevDatabaseManager", () => {
  const expected = {
    connectionPattern: /^postgres:\/\/.*:\d+\/.*$/,
  };
  const options = {
    container: {
      image: "postgres:16",
    },
  };

  it("should start and stop container successfully", async () => {
    const { instance: manager } = await createDevDatabaseManager(
      options,
      "postgres",
      "dev-start"
    );

    await manager.start();
    expect(manager.getConnectionString()).toMatch(expected.connectionPattern);

    expect(await manager.getStatus()).toEqual({
      type: "container",
      imageName: options.container.image,
      containerID: expect.any(String),
    });

    const exists = manager.isAvailable();
    expect(exists).toBe(true);

    await manager.stop();
    expect(() => manager.getConnectionString()).toThrowError(
      "Container is not started"
    );
    await manager.remove();
    expect(await findAllKyrageManagedContainerIDs()).toEqual([]);
  });
});
