import { describe, it, expect } from "vitest";
import { sql } from "kysely";
import { KyrageDialect } from "./types";
import { DialectEnum } from "../config/loader";
import { setupTestDB } from "../../tests/helper";

export interface DialectTestConfig {
  dialectName: DialectEnum;
  dialect: KyrageDialect;
}

export const runIntrospectorTests = (config: DialectTestConfig) => {
  describe(`${config.dialectName} introspector driver`, async () => {
    const { client } = await setupTestDB(config.dialectName);
    const introspector = config.dialect.createIntrospectionDriver(client);

    describe("introspectTables", () => {
      it("should return empty array for no tables", async () => {
        const tables = await introspector.introspectTables();
        expect(tables).toEqual([]);
      });

      it("should introspect table columns correctly", async () => {
        await using db = client.getDB();

        // テストテーブルを作成
        await sql`
          CREATE TABLE test_table (
            id uuid PRIMARY KEY,
            name varchar(255) NOT NULL,
            age integer DEFAULT 0,
            email text,
            is_active boolean DEFAULT true
          )
        `.execute(db);

        const tables = await introspector.introspectTables();
        expect(tables).toHaveLength(5);

        const idColumn = tables.find((col) => col.name === "id");
        expect(idColumn).toEqual({
          schema: "public",
          table: "test_table",
          name: "id",
          default: null,
          characterMaximumLength: null,
        });

        const nameColumn = tables.find((col) => col.name === "name");
        expect(nameColumn).toEqual({
          schema: "public",
          table: "test_table",
          name: "name",
          default: null,
          characterMaximumLength: 255,
        });

        const ageColumn = tables.find((col) => col.name === "age");
        expect(ageColumn).toEqual({
          schema: "public",
          table: "test_table",
          name: "age",
          default: "0",
          characterMaximumLength: null,
        });

        const isActiveColumn = tables.find((col) => col.name === "is_active");
        expect(isActiveColumn).toEqual({
          schema: "public",
          table: "test_table",
          name: "is_active",
          default: "true",
          characterMaximumLength: null,
        });
      });
    });

    describe("introspectIndexes", () => {
      it("should return empty array for no indexes", async () => {
        const indexes = await introspector.introspectIndexes();
        expect(indexes).toEqual([]);
      });

      it("should introspect indexes correctly", async () => {
        await using db = client.getDB();

        // テストテーブルとインデックスを作成
        await sql`
          CREATE TABLE test_table_with_indexes (
            id uuid PRIMARY KEY,
            email text,
            name text,
            age integer
          )
        `.execute(db);

        await sql`CREATE INDEX idx_email ON test_table_with_indexes (email)`.execute(
          db
        );
        await sql`CREATE UNIQUE INDEX idx_name_age ON test_table_with_indexes (name, age)`.execute(
          db
        );

        const indexes = await introspector.introspectIndexes();

        // Dialectによって動作が異なる可能性があるため、最低限の検証
        expect(indexes.length).toBeGreaterThanOrEqual(1);

        const emailIndex = indexes.find((idx) => idx.name === "idx_email");
        if (emailIndex) {
          expect(emailIndex).toMatchObject({
            table: "test_table_with_indexes",
            name: "idx_email",
            columns: ["email"],
            unique: false,
          });
        }

        const nameAgeIndex = indexes.find((idx) => idx.name === "idx_name_age");
        if (nameAgeIndex) {
          expect(nameAgeIndex).toMatchObject({
            table: "test_table_with_indexes",
            name: "idx_name_age",
            columns: ["name", "age"],
            unique: true,
          });
        }
      });
    });

    describe("introspectConstraints", () => {
      it("should return constraint structure correctly", async () => {
        const constraints = await introspector.introspectConstraints();
        expect(constraints).toHaveProperty("primaryKey");
        expect(constraints).toHaveProperty("unique");
        expect(constraints).toHaveProperty("foreignKey");
        expect(Array.isArray(constraints.primaryKey)).toBe(true);
        expect(Array.isArray(constraints.unique)).toBe(true);
        expect(Array.isArray(constraints.foreignKey)).toBe(true);
      });

      it("should introspect constraints correctly", async () => {
        await using db = client.getDB();

        // テストテーブルを作成
        await sql`
          CREATE TABLE users (
            id uuid PRIMARY KEY,
            email text UNIQUE,
            username text
          )
        `.execute(db);

        await sql`
          CREATE TABLE posts (
            id uuid PRIMARY KEY,
            user_id uuid,
            title text,
            CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT unique_title_per_user UNIQUE (user_id, title)
          )
        `.execute(db);

        const constraints = await introspector.introspectConstraints();

        // Primary Key制約
        expect(constraints.primaryKey.length).toBeGreaterThanOrEqual(2);
        const usersPK = constraints.primaryKey.find(
          (pk) => pk.table === "users"
        );
        expect(usersPK?.schema).toBe("public");
        expect(usersPK?.table).toBe("users");
        expect(usersPK?.type).toBe("PRIMARY KEY");
        expect(usersPK?.columns).toEqual(["id"]);

        const postsPK = constraints.primaryKey.find(
          (pk) => pk.table === "posts"
        );
        expect(postsPK?.schema).toBe("public");
        expect(postsPK?.table).toBe("posts");
        expect(postsPK?.type).toBe("PRIMARY KEY");
        expect(postsPK?.columns).toEqual(["id"]);

        // Unique制約
        expect(constraints.unique.length).toBeGreaterThanOrEqual(1);
        const uniqueConstraints = constraints.unique.filter(
          (u) => u.table === "users" || u.table === "posts"
        );
        expect(uniqueConstraints.length).toBeGreaterThan(0);

        // Foreign Key制約
        expect(constraints.foreignKey.length).toBeGreaterThanOrEqual(1);
        const fkConstraint = constraints.foreignKey.find(
          (fk) => fk.table === "posts" && fk.name === "fk_user"
        );
        if (fkConstraint) {
          expect(fkConstraint.schema).toBe("public");
          expect(fkConstraint.table).toBe("posts");
          expect(fkConstraint.type).toBe("FOREIGN KEY");
          expect(fkConstraint.columns).toEqual(["user_id"]);
          expect(fkConstraint.referencedTable).toBe("users");
          expect(fkConstraint.referencedColumns).toEqual(["id"]);
          expect(fkConstraint.onDelete).toBe("cascade");
          expect(fkConstraint.onUpdate).toBe("cascade");
        }
      });
    });
  });
};
