import { describe, expect, it, vi } from "vitest";
import { getClient } from "../src/client";
import { databaseTest, testForDialects } from "./fixtures";
import * as helper from "./helper";

vi.mock("./helper", async (importOriginal) => {
  const original = await importOriginal<typeof import("./helper")>();
  return {
    ...original,
    startTestDB: vi.fn(async () => ({
      database: {
        dialect: "mysql" as const,
        connectionString: "mysql://localhost/test",
      },
      client: getClient({
        database: {
          dialect: "mysql",
          connectionString: "mysql://localhost/test",
        },
      }),
      dialect: { getName: () => "mysql" },
      stop: vi.fn(),
    })),
  };
});

describe("database test fixtures", () => {
  it("does not start a database during collection or for skipped tests", () => {
    expect(helper.startTestDB).not.toHaveBeenCalled();
  });

  testForDialects()(
    "does not run outside the declared dialects",
    async ({ testDB }) => {
      expect(testDB).toBeUndefined();
    }
  );

  databaseTest("starts the lazy file-scoped database", async ({ testDB }) => {
    expect(helper.startTestDB).toHaveBeenCalledTimes(1);
    expect(testDB.baseDeps.client).toBe(testDB.client);
    expect(testDB.introspector.introspect).toBeTypeOf("function");
  });

  databaseTest(
    "reuses the database in the next test",
    async ({ testDB, expectations }) => {
      expect(helper.startTestDB).toHaveBeenCalledTimes(1);
      const started = await vi.mocked(helper.startTestDB).mock.results[0].value;
      expect(testDB.client).toBe(started.client);
      expect(expectations).toBe(
        helper.dialectTestProfiles[helper.testDialect].expectations
      );
    }
  );
});
