import { expect, it, vi } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, defineConfigForTest } from "./helper";
import { runGenerate } from "../src/usecases/generate";
import { defaultConsolaLogger } from "../src/logger";
import { runApply } from "../src/usecases/apply";

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
        name: column("text", { unique: true }),
        email: column("text"),
      },
      (t) => [t.index(["name", "email"])]
    ),
    defineTable("category", {
      id: column("uuid", { primaryKey: true }),
      name: column("text", { unique: true }),
    }),
  ],
});

it("generate with planned apply", async () => {
  const loggerStdout = vi
    .spyOn(defaultConsolaLogger, "stdout")
    .mockImplementation(() => void 0);

  await runGenerate({
    client,
    logger: defaultConsolaLogger,
    config,
    options: {
      ignorePending: false,
      apply: true,
      plan: true,
    },
  });

  await runApply({
    client,
    logger: defaultConsolaLogger,
    options: {
      plan: false,
      pretty: false,
    },
  });

  await runGenerate({
    client,
    logger: defaultConsolaLogger,
    config: defineConfigForTest({
      database,
      tables: [
        defineTable(
          "members",
          {
            id: column("uuid", { primaryKey: true }),
            name: column("text"),
            email: column("text", { unique: true }),
          },
          (t) => [t.index(["id", "email"], { unique: true })]
        ),
        defineTable("posts", {
          id: column("uuid", { primaryKey: true }),
          content: column("text"),
        }),
      ],
    }),
    options: {
      ignorePending: false,
      apply: true,
      plan: true,
    },
  });

  [
    // 1st time
    `create table "category" ("id" uuid not null, "name" text)`,
    `create table "members" ("id" uuid not null, "name" text, "email" text)`,
    `create index "idx_members_name_email" on "members" ("name", "email")`,
    `alter table "category" add constraint "category_id_primary_key" primary key ("id")`,
    `alter table "members" add constraint "members_id_primary_key" primary key ("id")`,
    `alter table "category" add constraint "category_name_unique" unique ("name")`,
    `alter table "members" add constraint "members_name_unique" unique ("name")`,

    // 2nd time
    `alter table "category" drop constraint "category_name_unique"`,
    `alter table "members" drop constraint "members_name_unique"`,
    `alter table "category" drop constraint "category_id_primary_key"`,
    `drop index "idx_members_name_email"`,
    `drop table "category"`,
    `create table "posts" ("id" uuid not null, "content" text)`,
    `create unique index "idx_members_id_email" on "members" ("id", "email")`,
    `alter table "posts" add constraint "posts_id_primary_key" primary key ("id")`,
    `alter table "members" add constraint "members_email_unique" unique ("email")`,
  ].forEach((expectedCall, index) => {
    expect(loggerStdout).toHaveBeenNthCalledWith(index + 1, expectedCall);
  });

  loggerStdout.mockClear();
});
