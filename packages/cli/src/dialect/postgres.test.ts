import { PostgresKyrageDialect } from "./postgres";
import { runIntrospectorTests } from "./introspector_tests";

runIntrospectorTests({
  dialectName: "postgres",
  dialect: new PostgresKyrageDialect(),
});
