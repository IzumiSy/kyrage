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
const membersTable = defineTable(
  "members",
  {
    id: column("uuid", { primaryKey: true }),
    name: column("text", { notNull: true }),
    email: column("text", { unique: true, notNull: true }),
  },
  (t) => [t.index(["name", "email"], { unique: true })]
);
const config = defineConfigForTest({
  database,
  tables: [
    membersTable,
    defineTable(
      "orders",
      {
        customer_id: column("uuid", { notNull: true }),
        product_id: column("uuid", { notNull: true }),
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
});

beforeAll(async () => {
  await using db = client.getDB();

  await sql`
    CREATE TABLE members (
      id UUID CONSTRAINT members_id_primary_key PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL CONSTRAINT members_email_unique UNIQUE
    );
    CREATE UNIQUE INDEX "idx_members_name_email" ON "members" ("name", "email");

    CREATE TABLE orders (
      customer_id UUID NOT NULL,
      product_id UUID NOT NULL,
      order_date DATE NOT NULL,
      CONSTRAINT pk_orders_customer_id_product_id_order_date PRIMARY KEY (customer_id, product_id, order_date),
      CONSTRAINT uq_customer_product UNIQUE (customer_id, product_id),
      CONSTRAINT fk_orders_customer_id FOREIGN KEY (customer_id) REFERENCES members (id) ON DELETE CASCADE ON UPDATE CASCADE
    );
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

    expect(vol.toJSON()).toEqual(beforeVol);
  });
});
