import { expect, it, vi } from "vitest";
import { defineTable, column } from "../src";
import { setupTestDB, defineConfigForTest } from "./helper";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { executeApply } from "../src/commands/apply";

vi.mock("fs/promises", async () => {
  const memfs = await import("memfs");
  return memfs.fs.promises;
});

const { database, client } = await setupTestDB();

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

    await executeGenerate(
      {
        client,
        logger: defaultConsolaLogger,
        config: defineConfigForTest({
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
        }),
      },
      {
        ignorePending: false,
        apply: true,
        plan: true,
        dev: false,
      }
    );

    await executeApply(
      {
        client,
        logger: defaultConsolaLogger,
        config: defineConfigForTest({
          database,
          tables: [],
        }),
      },
      {
        plan: false,
        pretty: false,
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

    await executeGenerate(
      {
        client,
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
      },
      {
        ignorePending: false,
        apply: true,
        plan: true,
        dev: false,
      }
    );
  }

  [
    // 1st phase
    `create table "category" ("id" uuid, "member_id" uuid, "name" text)`,
    `create table "members" ("id" uuid not null, "name" text, "email" text)`,
    `create index "idx_members_name_email" on "members" ("name", "email")`,
    `alter table "category" add constraint "pk_category_id_member_id" primary key ("id", "member_id")`,
    `alter table "members" add constraint "members_id_primary_key" primary key ("id")`,
    `alter table "category" add constraint "category_name_unique" unique ("name")`,
    `alter table "members" add constraint "uq_members_name_email" unique ("name", "email")`,
    `alter table "members" add constraint "members_name_unique" unique ("name")`,
    `alter table "category" add constraint "category_member_fk" foreign key ("member_id") references "members" ("id") on delete cascade`,

    // 2nd phase
    `alter table "category" drop constraint "category_member_fk"`,
    `alter table "category" drop constraint "category_name_unique"`,
    `alter table "members" drop constraint "members_name_unique"`,
    `alter table "members" drop constraint "uq_members_name_email"`,
    `alter table "category" drop constraint "pk_category_id_member_id"`,
    `drop index "idx_members_name_email"`,
    `drop table "category"`,
    `create table "posts" ("id" uuid not null, "content" text, "author_id" uuid not null)`,
    `create unique index "idx_members_id_email" on "members" ("id", "email")`,
    `alter table "posts" add constraint "posts_id_primary_key" primary key ("id")`,
    `alter table "members" add constraint "members_email_unique" unique ("email")`,
    `alter table "posts" add constraint "posts_author_fk" foreign key ("author_id") references "members" ("id") on delete set null on update cascade`,
  ].forEach((expectedCall, index) => {
    expect(loggerStdout).toHaveBeenNthCalledWith(index + 1, expectedCall);
  });

  loggerStdout.mockClear();
});
