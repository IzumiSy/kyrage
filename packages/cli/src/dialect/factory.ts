import { KyrageDialectInterface, SupportedDialect } from "./types";
import { PostgresKyrageDialect } from "./postgres";
import { CockroachDBKyrageDialect } from "./cockroachdb";

const dialects: Record<SupportedDialect, KyrageDialectInterface> = {
  postgres: new PostgresKyrageDialect(),
  cockroachdb: new CockroachDBKyrageDialect(),
};

export const getDialect = (dialectName: SupportedDialect) => {
  const dialect = dialects[dialectName];
  if (!dialect) {
    throw new Error(`Unsupported dialect: ${dialectName}`);
  }
  return dialect;
};
