import { describe, it, expect } from "vitest";
import { createDevDatabaseManager } from "../src/dev/container";

describe("Dev Database Manager", () => {
  describe("ContainerDevDatabaseManager", () => {
    it("should create manager for postgres container", () => {
      const manager = createDevDatabaseManager(
        {
          image: "postgres:16",
        },
        "postgres"
      );

      expect(manager).toBeDefined();
    });

    it("should create manager for cockroachdb container", () => {
      const manager = createDevDatabaseManager(
        {
          image: "cockroachdb/cockroach:latest-v24.3",
        },
        "cockroachdb"
      );

      expect(manager).toBeDefined();
    });
  });

  describe("ConnectionStringDevDatabaseManager", () => {
    it("should create manager for connection string", () => {
      const manager = createDevDatabaseManager(
        {
          connectionString: "postgres://user:pass@localhost:5432/testdb",
        },
        "postgres"
      );

      expect(manager).toBeDefined();
    });
  });
});
