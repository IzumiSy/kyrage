import { expect, it, vi } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, defineConfigForTest, applyTable } from "./helper";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { executeApply } from "../src/commands/apply";
import { fs } from "memfs";
import { FSPromiseAPIs } from "../src/commands/common";

const { database, client } = await setupTestDB();
const mockedFS = fs.promises as unknown as FSPromiseAPIs;

it("generate with planned apply", async () => {
  const loggerStdout = vi
    .spyOn(defaultConsolaLogger, "stdout")
    .mockImplementation(() => void 0);

  // 1st phase
  {
    const membersTable = defineTable(
      "members",
      {
        id: column("uuid", { primaryKey: true }),
        name: column("text", { unique: true }),
        email: column("text"),
      },
      (t) => [t.index(["name", "email"]), t.unique(["name", "email"])]
    );
    await applyTable(
      { client, fs: mockedFS },
      {
        database,
        tables: [
          membersTable,
          defineTable(
            "category",
            {
              id: column("uuid"),
              member_id: column("uuid"),
              name: column("text", { unique: true }),
            },
            (t) => [
              t.primaryKey(["id", "member_id"]),
              t.reference("member_id", membersTable, "id", {
                onDelete: "cascade",
                name: "category_member_fk",
              }),
            ]
          ),
        ],
      },
      {
        beforeApply: async (deps_) => {
          // Plan changes
          await executeApply(deps_, {
            plan: true,
            pretty: false,
          });
        },
      }
    );
  }

  // 2nd phase
  {
    const membersTable = defineTable(
      "members",
      {
        id: column("uuid", { primaryKey: true }),
        name: column("text"),
        email: column("text", { unique: true }),
      },
      (t) => [t.index(["id", "email"], { unique: true })]
    );
    const deps = {
      client,
      fs: mockedFS,
      logger: defaultConsolaLogger,
      config: defineConfigForTest({
        database,
        tables: [
          membersTable,
          defineTable(
            "posts",
            {
              id: column("uuid", { primaryKey: true }),
              content: column("text"),
              author_id: column("uuid", { notNull: true }),
            },
            (t) => [
              t.reference("author_id", membersTable, "id", {
                onDelete: "set null",
                onUpdate: "cascade",
                name: "posts_author_fk",
              }),
            ]
          ),
        ],
      }),
    };

    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });

    // Plan changes
    await executeApply(deps, {
      plan: true,
      pretty: false,
    });
  }

  [
    // 1st phase
    `create table "members" ("id" uuid not null, "name" text, "email" text, constraint "members_id_primary_key" primary key ("id"), constraint "uq_members_name_email" unique ("name", "email"), constraint "members_name_unique" unique ("name"))`,
    `create table "category" ("id" uuid not null, "member_id" uuid not null, "name" text, constraint "pk_category_id_member_id" primary key ("id", "member_id"), constraint "category_name_unique" unique ("name"), constraint "category_member_fk" foreign key ("member_id") references "members" ("id") on delete cascade)`,
    `create index "idx_members_name_email" on "members" ("name", "email")`,

    // 2nd phase
    `alter table "members" drop constraint "members_name_unique"`,
    `alter table "members" drop constraint "uq_members_name_email"`,
    `drop index "idx_members_name_email"`,
    `drop table "category"`,
    `create table "posts" ("id" uuid not null, "content" text, "author_id" uuid not null, constraint "posts_id_primary_key" primary key ("id"), constraint "posts_author_fk" foreign key ("author_id") references "members" ("id") on delete set null on update cascade)`,
    `create unique index "idx_members_id_email" on "members" ("id", "email")`,
    `alter table "members" add constraint "members_email_unique" unique ("email")`,
  ].forEach((expectedCall, index) => {
    expect(loggerStdout).toHaveBeenNthCalledWith(index + 1, expectedCall);
  });

  loggerStdout.mockClear();
});
