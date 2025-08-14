import { describe, beforeAll, expect, it, vi } from "vitest";
import { defineTable, column } from "../src/config/builder";
import { defineConfigForTest, setupTestDB } from "./helper";
import { sql } from "kysely";
import { runGenerate } from "../src/usecases/generate";
import { vol } from "memfs";
import { defaultConsolaLogger } from "../src/logger";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();
const config = defineConfigForTest({
  database,
  tables: [
    defineTable(
      "members",
      {
        id: column("uuid", { primaryKey: true }),
        name: column("text", { unique: true, notNull: true }),
        email: column("text", { unique: true, notNull: true }),
        age: column("integer"),
      },
      (t) => [t.index(["name", "email"], { unique: true })]
    ),
  ],
});

beforeAll(async () => {
  await using db = client.getDB();

  await sql`
    CREATE TABLE members (
      id UUID PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      age INT4
    );
    CREATE INDEX "idx_members_name_email" ON "members" ("name", "email");
  `.execute(db);
});

describe("generate", () => {
  it("should not generate a new migration", async () => {
    const beforeVol = vol.toJSON();

    await runGenerate({
      client,
      logger: defaultConsolaLogger,
      config,
      options: {
        ignorePending: false,
        apply: false,
        plan: false,
      },
    });

    expect(beforeVol).toEqual(vol.toJSON());
  });
});
