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

export const posts = t("posts", {
  id: c("uuid", { primaryKey: true }),
  author_id: c("uuid", { notNull: true }),
  title: c("text"),
  content: c("text", { notNull: true }),
  published: c("boolean", { defaultSql: "false" }),
  published_at: c("timestamptz", { defaultSql: "now()" }),
});

export const studentGrades = t(
  "student_grades",
  {
    student_id: c("uuid"),
    subject_id: c("uuid"),
    teacher_id: c("uuid"),
    exam_date: c("date", { notNull: true }),
    grade: c("integer", { notNull: true }),
  },
  (t) => [
    t.primaryKey(["student_id", "subject_id", "exam_date"], {
      name: "custom_primary_key_constraint",
    }),
    t.unique(["teacher_id", "subject_id", "exam_date"], {
      name: "custom_unique_constraint",
    }),
    t.index(["student_id", "exam_date"]),
  ]
);
