import { defineConfig } from "@izumisy/kyrage";
import { members, posts } from "./schema";

export default defineConfig({
  database: {
    dialect: "postgres",
    connectionString: "postgres://postgres:postgres@localhost:5432/postgres",
  },
  dev: {
    container: {
      image: "postgres:16",
      // reuse: true,
    },
  },
  tables: [members, posts],
});
