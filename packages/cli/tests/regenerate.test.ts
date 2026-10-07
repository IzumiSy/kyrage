import { describe, expect } from "vitest";
import { defineTable, column } from "../src/config/builder";
import { defineConfigForTest } from "./helper";
import { testForDialects } from "./fixtures";
import { sql } from "kysely";
import { executeGenerate } from "../src/commands/generate";
import { vol } from "memfs";
import { defaultConsolaLogger } from "../src/logger";

const postgresIt = testForDialects("postgres", "cockroachdb");
const mysqlIt = testForDialects("mysql", "mariadb");

// PostgreSQL/CockroachDB tests
describe("generate - PostgreSQL/CockroachDB", () => {
  postgresIt("should not generate a new migration", async ({ testDB }) => {
    const { database, client, baseDeps } = testDB;
    await using db = client.getDB();

    await sql`
        CREATE TABLE members (
          id CHAR(36) CONSTRAINT members_id_primary_key PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL CONSTRAINT members_email_unique UNIQUE
        );
        CREATE UNIQUE INDEX "idx_members_name_email" ON "members" ("name", "email");

        CREATE TABLE orders (
          customer_id CHAR(36) NOT NULL,
          product_id CHAR(36) NOT NULL,
          order_date DATE NOT NULL,
          CONSTRAINT pk_orders_customer_id_product_id_order_date PRIMARY KEY (customer_id, product_id, order_date),
          CONSTRAINT uq_customer_product UNIQUE (customer_id, product_id),
          CONSTRAINT fk_orders_customer_id FOREIGN KEY (customer_id) REFERENCES members (id) ON DELETE CASCADE ON UPDATE CASCADE
        );
      `.execute(db);
    const beforeVol = vol.toJSON();

    const membersTable = defineTable(
      "members",
      {
        id: column("char(36)", { primaryKey: true }),
        name: column("text", { notNull: true }),
        email: column("text", { unique: true, notNull: true }),
      },
      (t) => [t.index(["name", "email"], { unique: true })]
    );
    const deps = {
      ...baseDeps,
      logger: defaultConsolaLogger,
      config: defineConfigForTest({
        database,
        tables: [
          membersTable,
          defineTable(
            "orders",
            {
              customer_id: column("char(36)", { notNull: true }),
              product_id: column("char(36)", { notNull: true }),
              order_date: column("date", { notNull: true }),
            },
            (t) => [
              t.primaryKey(["customer_id", "product_id", "order_date"], {
                name: "pk_orders_customer_id_product_id_order_date",
              }),
              t.unique(["customer_id", "product_id"], {
                name: "uq_customer_product",
              }),
              t.reference("customer_id", membersTable, "id", {
                onDelete: "cascade",
                onUpdate: "cascade",
                name: "fk_orders_customer_id",
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

    expect(vol.toJSON()).toEqual(beforeVol);
  });
});

// MySQL/MariaDB tests
describe("generate - MySQL/MariaDB", () => {
  mysqlIt("should not generate a new migration", async ({ testDB }) => {
    const { database, client, baseDeps } = testDB;
    await using db = client.getDB();

    await sql`
        CREATE TABLE members (
          id CHAR(36) NOT NULL PRIMARY KEY,
          name TEXT NOT NULL,
          email VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          balance DECIMAL(10, 2),
          updated_at DATETIME(6),
          token VARBINARY(32),
          CONSTRAINT members_email_unique UNIQUE (email)
        )
      `.execute(db);
    await sql`CREATE UNIQUE INDEX idx_members_name_email ON members (name(255), email)`.execute(
      db
    );
    await sql`
        CREATE TABLE orders (
          customer_id CHAR(36) NOT NULL,
          product_id CHAR(36) NOT NULL,
          order_date DATE NOT NULL,
          PRIMARY KEY (customer_id, product_id, order_date),
          CONSTRAINT uq_customer_product UNIQUE (customer_id, product_id),
          CONSTRAINT fk_orders_customer_id FOREIGN KEY (customer_id) REFERENCES members (id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `.execute(db);
    await sql`
        CREATE TABLE followers (
          \`member,id\` CHAR(36),
          score INTEGER,
          CONSTRAINT fk_followers_member FOREIGN KEY (\`member,id\`) REFERENCES members (id)
        )
      `.execute(db);
    await sql`CREATE INDEX idx_followers_score_member ON followers (score, \`member,id\`)`.execute(
      db
    );
    const beforeVol = vol.toJSON();

    const membersTable = defineTable(
      "members",
      {
        id: column("char(36)", { primaryKey: true }),
        name: column("text", { notNull: true }),
        email: column("varchar(255)", { unique: true, notNull: true }),
        active: column("boolean", { defaultSql: "true" }),
        balance: column("decimal(10, 2)"),
        updated_at: column("datetime(6)"),
        token: column("varbinary(32)"),
      },
      (t) => [t.index(["name", "email"], { unique: true })]
    );
    const followersTable = defineTable(
      "followers",
      {
        "member,id": column("char(36)"),
        score: column("integer"),
      },
      (t) => [
        t.reference("member,id", membersTable, "id", {
          name: "fk_followers_member",
        }),
        t.index(["score", "member,id"], {
          name: "idx_followers_score_member",
        }),
      ]
    );
    const deps = {
      ...baseDeps,
      logger: defaultConsolaLogger,
      config: defineConfigForTest({
        database,
        tables: [
          membersTable,
          defineTable(
            "orders",
            {
              customer_id: column("char(36)", { notNull: true }),
              product_id: column("char(36)", { notNull: true }),
              order_date: column("date", { notNull: true }),
            },
            (t) => [
              t.primaryKey(["customer_id", "product_id", "order_date"], {
                name: "custom_orders_primary_key",
              }),
              t.unique(["customer_id", "product_id"], {
                name: "uq_customer_product",
              }),
              t.reference("customer_id", membersTable, "id", {
                onDelete: "cascade",
                onUpdate: "cascade",
                name: "fk_orders_customer_id",
              }),
            ]
          ),
          followersTable,
        ],
      }),
    };

    await executeGenerate(deps, {
      ignorePending: false,
      dev: false,
    });

    expect(vol.toJSON()).toEqual(beforeVol);
  });
});
