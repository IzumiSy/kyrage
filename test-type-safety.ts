import {
  column as c,
  defineTable as t,
} from "./packages/cli/src/config/builder";

export const users = t("users", {
  id: c("uuid", { primaryKey: true }),
  name: c("text", { notNull: true }),
  email: c("text", { unique: true, notNull: true }),
});

export const posts = t(
  "posts",
  {
    id: c("uuid", { primaryKey: true }),
    user_id: c("uuid", { notNull: true }),
    title: c("text", { notNull: true }),
  },
  (t) => [
    // 正しい参照 - エラーなし
    t.reference("user_id", users, "id"),

    // 不正なカラム名 - TypeScriptエラーが出るはず
    t.reference("user_id", users, "nonexistent_column"),

    // 存在しないカラムを参照 - TypeScriptエラーが出るはず
    t.reference("nonexistent_column", users, "id"),
  ]
);
