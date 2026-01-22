import { describe, beforeAll, expect, it } from "vitest";
import { defineTable, column } from "../src/config/builder";
import { defineConfigForTest, setupTestDB } from "./helper";
import { sql } from "kysely";
import { executeGenerate } from "../src/commands/generate";
import { vol, fs } from "memfs";
import { defaultConsolaLogger } from "../src/logger";
import { FSPromiseAPIs } from "../src/commands/common";

const { database, client, dialect } = await setupTestDB();
const dialectName = dialect.getName();

// PostgreSQL/CockroachDB tests
describe.skipIf(dialectName === "mysql" || dialectName === "mariadb")(
  "generate - PostgreSQL/CockroachDB",
  () => {
    beforeAll(async () => {
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
    });

    it("should not generate a new migration", async () => {
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
        client,
        fs: fs.promises as unknown as FSPromiseAPIs,
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
  }
);

// MySQL/MariaDB tests
describe.skipIf(dialectName === "postgres" || dialectName === "cockroachdb")(
  "generate - MySQL/MariaDB",
  () => {
    beforeAll(async () => {
      await using db = client.getDB();

      await sql`
        CREATE TABLE members (
          id CHAR(36) NOT NULL,
          name TEXT NOT NULL,
          email VARCHAR(255) NOT NULL,
          CONSTRAINT members_id_primary_key PRIMARY KEY (id),
          CONSTRAINT members_email_unique UNIQUE (email)
        )
      `.execute(db);
      await sql`CREATE UNIQUE INDEX idx_members_name_email ON members (name(255), email)`.execute(db);
      await sql`
        CREATE TABLE orders (
          customer_id CHAR(36) NOT NULL,
          product_id CHAR(36) NOT NULL,
          order_date DATE NOT NULL,
          CONSTRAINT pk_orders_customer_id_product_id_order_date PRIMARY KEY (customer_id, product_id, order_date),
          CONSTRAINT uq_customer_product UNIQUE (customer_id, product_id),
          CONSTRAINT fk_orders_customer_id FOREIGN KEY (customer_id) REFERENCES members (id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `.execute(db);
    });

    it("should not generate a new migration", async () => {
      const beforeVol = vol.toJSON();

      const membersTable = defineTable(
        "members",
        {
          id: column("char(36)", { primaryKey: true }),
          name: column("text", { notNull: true }),
          email: column("varchar(255)", { unique: true, notNull: true }),
        },
        (t) => [t.index(["name", "email"], { unique: true })]
      );
      const deps = {
        client,
        fs: fs.promises as unknown as FSPromiseAPIs,
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
  }
);
