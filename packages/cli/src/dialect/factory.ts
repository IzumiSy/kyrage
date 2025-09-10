import { KyrageDialect } from "./types";
import { PostgresKyrageDialect } from "./postgres";
import { CockroachDBKyrageDialect } from "./cockroachdb";
import { DialectEnum } from "../config/loader";

const dialects = {
  postgres: new PostgresKyrageDialect(),
  cockroachdb: new CockroachDBKyrageDialect(),
} as const;

export const getDialect = (dialectName: DialectEnum): KyrageDialect => {
  const dialect = dialects[dialectName];
  if (!dialect) {
    throw new Error(`Unsupported dialect: ${dialectName}`);
  }
  return dialect;
};
