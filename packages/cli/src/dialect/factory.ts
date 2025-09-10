import { KyrageDialectInterface } from "./types";
import { PostgresKyrageDialect } from "./postgres";
import { CockroachDBKyrageDialect } from "./cockroachdb";
import { DialectEnum } from "../config/loader";

const dialects: Record<DialectEnum, KyrageDialectInterface> = {
  postgres: new PostgresKyrageDialect(),
  cockroachdb: new CockroachDBKyrageDialect(),
};

export const getDialect = (dialectName: DialectEnum) => {
  const dialect = dialects[dialectName];
  if (!dialect) {
    throw new Error(`Unsupported dialect: ${dialectName}`);
  }
  return dialect;
};
