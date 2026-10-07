import { expect, vi } from "vitest";
import { databaseTest as it } from "./fixtures";
import { defineTable, column } from "../src";
import { defineConfigForTest, applyTable } from "./helper";
import { executeGenerate } from "../src/commands/generate";
import { defaultConsolaLogger } from "../src/logger";
import { executeApply } from "../src/commands/apply";

it("generate with planned apply", async ({ testDB, expectations }) => {
  const { database, baseDeps } = testDB;
  const { quote, dropUniqueSql, dropIndexTableSql } = expectations;
  const charSql = "char(36)";
  const textSql = "varchar(255)";
  const loggerStdout = vi
    .spyOn(defaultConsolaLogger, "stdout")
    .mockImplementation(() => void 0);

  // 1st phase
  {
    const membersTable = defineTable(
      "members",
      {
        id: column("char(36)", { primaryKey: true }),
        name: column("varchar(255)", { unique: true }),
        email: column("varchar(255)"),
      },
      (t) => [t.index(["name", "email"]), t.unique(["name", "email"])]
    );
    await applyTable(
      baseDeps,
      {
        database,
        tables: [
          membersTable,
          defineTable(
            "category",
            {
              id: column("char(36)"),
              member_id: column("char(36)"),
              name: column("varchar(255)", { unique: true }),
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
        beforeApply: async (deps) => {
          // Plan changes
          await executeApply(deps, {
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
        id: column("char(36)", { primaryKey: true }),
        name: column("varchar(255)"),
        email: column("varchar(255)", { unique: true }),
      },
      (t) => [t.index(["id", "email"], { unique: true })]
    );
    const deps = {
      ...baseDeps,
      logger: defaultConsolaLogger,
      config: defineConfigForTest({
        database,
        tables: [
          membersTable,
          defineTable(
            "posts",
            {
              id: column("char(36)", { primaryKey: true }),
              content: column("text"),
              author_id: column("char(36)"),
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
    `create table ${quote}members${quote} (${quote}id${quote} ${charSql} not null, ${quote}name${quote} ${textSql}, ${quote}email${quote} ${textSql}, constraint ${quote}members_id_primary_key${quote} primary key (${quote}id${quote}), constraint ${quote}uq_members_name_email${quote} unique (${quote}name${quote}, ${quote}email${quote}), constraint ${quote}members_name_unique${quote} unique (${quote}name${quote}))`,
    `create table ${quote}category${quote} (${quote}id${quote} ${charSql} not null, ${quote}member_id${quote} ${charSql} not null, ${quote}name${quote} ${textSql}, constraint ${quote}pk_category_id_member_id${quote} primary key (${quote}id${quote}, ${quote}member_id${quote}), constraint ${quote}category_name_unique${quote} unique (${quote}name${quote}), constraint ${quote}category_member_fk${quote} foreign key (${quote}member_id${quote}) references ${quote}members${quote} (${quote}id${quote}) on delete cascade)`,
    `create index ${quote}idx_members_name_email${quote} on ${quote}members${quote} (${quote}name${quote}, ${quote}email${quote})`,

    // 2nd phase
    `alter table ${quote}members${quote} ${dropUniqueSql} ${quote}members_name_unique${quote}`,
    `alter table ${quote}members${quote} ${dropUniqueSql} ${quote}uq_members_name_email${quote}`,
    `drop index ${quote}idx_members_name_email${quote}${dropIndexTableSql("members")}`,
    `drop table ${quote}category${quote}`,
    `create table ${quote}posts${quote} (${quote}id${quote} ${charSql} not null, ${quote}content${quote} text, ${quote}author_id${quote} ${charSql}, constraint ${quote}posts_id_primary_key${quote} primary key (${quote}id${quote}), constraint ${quote}posts_author_fk${quote} foreign key (${quote}author_id${quote}) references ${quote}members${quote} (${quote}id${quote}) on delete set null on update cascade)`,
    `create unique index ${quote}idx_members_id_email${quote} on ${quote}members${quote} (${quote}id${quote}, ${quote}email${quote})`,
    `alter table ${quote}members${quote} add constraint ${quote}members_email_unique${quote} unique (${quote}email${quote})`,
  ].forEach((expectedCall, index) => {
    expect(loggerStdout).toHaveBeenNthCalledWith(index + 1, expectedCall);
  });

  loggerStdout.mockClear();
});
