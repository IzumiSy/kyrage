import { CockroachDBKyrageDialect } from "./cockroachdb";
import { runIntrospectorTests } from "./introspector_tests";

runIntrospectorTests({
  dialectName: "cockroachdb",
  dialect: new CockroachDBKyrageDialect(),
});
