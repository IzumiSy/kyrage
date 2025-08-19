import {
  column as c,
  defineTable as t,
} from "./packages/cli/src/config/builder";

// 基本テーブル
export const users = t("users", {
  id: c("uuid", { primaryKey: true }),
  name: c("text", { notNull: true }),
  email: c("text", { unique: true, notNull: true }),
});

// Foreign Key制約を持つテーブル
export const posts = t(
  "posts",
  {
    id: c("uuid", { primaryKey: true }),
    user_id: c("uuid", { notNull: true }),
    title: c("text", { notNull: true }),
    content: c("text"),
    created_at: c("timestamptz", { defaultSql: "now()" }),
  },
  (t) => [
    // Foreign Key制約の定義
    t.reference("user_id", users, "id", {
      onDelete: "cascade",
      onUpdate: "cascade",
      name: "posts_user_id_fk",
    }),

    // 通常のインデックス
    t.index(["user_id", "created_at"]),
  ]
);

// 複数カラムのForeign Key制約
export const orders = t(
  "orders",
  {
    id: c("uuid", { primaryKey: true }),
    user_id: c("uuid", { notNull: true }),
    total: c("decimal", { notNull: true }),
  },
  (t) => [
    t.reference("user_id", users, "id", {
      onDelete: "restrict",
      name: "orders_user_fk",
    }),
  ]
);

console.log("Tables definition:", {
  users: users.tableName,
  posts: posts.tableName,
  orders: orders.tableName,
});

console.log("Posts foreign keys:", posts.foreignKeys);
console.log("Orders foreign keys:", orders.foreignKeys);
