import { KyrageDialect } from "./types";
import { PostgresKyrageDialect } from "./postgres";
import { CockroachDBKyrageDialect } from "./cockroachdb";
import { DialectEnum } from "../config/loader";
import { SQLiteKyrageDialect } from "./sqlite";

const dialects = {
  postgres: new PostgresKyrageDialect(),
  cockroachdb: new CockroachDBKyrageDialect(),
  sqlite: new SQLiteKyrageDialect(),
} as const;

export const getDialect = (dialectName: DialectEnum) => {
  const dialect = dialects[dialectName];
  if (!dialect) {
    throw new Error(`Unsupported dialect: ${dialectName}`);
  }
  return dialect as KyrageDialect<DialectEnum>;
};
