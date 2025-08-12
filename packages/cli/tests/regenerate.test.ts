import { describe, beforeAll, expect, it, vi } from "vitest";
import { defineTable, column } from "../src/config/builder";
import { setupTestDB } from "./helper";
import { sql } from "kysely";
import { runGenerate } from "../src/usecases/generate";
import { vol } from "memfs";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { config, client } = await setupTestDB({
  tables: [
    defineTable("members", {
      id: column("uuid", { primaryKey: true }),
      name: column("text", { unique: true, notNull: true }),
      age: column("integer"),
    }),
  ],
});

beforeAll(async () => {
  await using db = client.getDB();

  await sql`
    CREATE TABLE members (
      id UUID PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      age INT4
    );
  `.execute(db);
});

describe("generate", () => {
  it("should not generate a new migration", async () => {
    const beforeVol = vol.toJSON();

    await runGenerate({
      client,
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
