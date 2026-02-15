import { KyrageDialect } from "./types";
import { PostgresKyrageDialect } from "./postgres";
import { CockroachDBKyrageDialect } from "./cockroachdb";
import { MysqlKyrageDialect } from "./mysql";
import { MariadbKyrageDialect } from "./mariadb";
import { DialectEnum } from "../config/loader";

const dialects = {
  postgres: new PostgresKyrageDialect(),
  cockroachdb: new CockroachDBKyrageDialect(),
  mysql: new MysqlKyrageDialect(),
  mariadb: new MariadbKyrageDialect(),
} as const;

export const getDialect = (dialectName: DialectEnum) => {
  const dialect = dialects[dialectName];
  if (!dialect) {
    throw new Error(`Unsupported dialect: ${dialectName}`);
  }
  return dialect as KyrageDialect<DialectEnum>;
};
