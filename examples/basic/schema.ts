import { column as c, defineTable as t } from "@izumisy/kyrage";

export const members = t("members", {
  id: c("uuid", { primaryKey: true }),
  email: c("text", { unique: true, notNull: true }),
  name: c("text", { unique: true }),
  age: c("integer"),
  createdAt: c("timestamptz", { defaultSql: "now()" }),
});

export const posts = t("posts", {
  id: c("uuid", { primaryKey: true }),
  author_id: c("uuid", { notNull: true }),
  title: c("text", { notNull: true }),
  content: c("text", { notNull: true }),
  published: c("boolean", { defaultSql: "false" }),
  published_at: c("timestamptz", { defaultSql: "now()" }),
});
