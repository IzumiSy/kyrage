import { column as c, defineTable as t } from "@izumisy/kyrage";

export const members = t(
  "members",
  {
    id: c("uuid", { primaryKey: true }),
    email: c("text", { unique: true, notNull: true }),
    name: c("text", { unique: true }),
    age: c("integer"),
    createdAt: c("timestamptz", { defaultSql: "now()" }),
  },
  (t) => [
    t.index(["name", "email"], {
      unique: true,
    }),
  ]
);

export const posts = t(
  "posts",
  {
    id: c("uuid"),
    author_id: c("uuid"),
    slug: c("text", { notNull: true }),
    title: c("text"),
    content: c("text", { notNull: true }),
  },
  (t) => [
    t.primaryKey(["id", "author_id"]),
    t.unique(["author_id", "slug"], {
      name: "unique_author_slug",
    }),
  ]
);
