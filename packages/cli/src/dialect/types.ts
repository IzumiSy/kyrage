import { Dialect } from "kysely";
import { DBClient } from "../client";
import { StartableContainer } from "../dev/container";

export type SupportedDialect = "postgres" | "cockroachdb";

export interface KyrageDialectInterface {
  getName(): SupportedDialect;
  getDefaultImage(): string;
  createKyselyDialect(connectionString: string): Dialect;
  createIntrospectionDriver(client: DBClient): {
    introspectTables(): Promise<any[]>;
    introspectIndexes(): Promise<any[]>;
    introspectConstraints(): Promise<any>;
    convertTypeName(typeName: string): string;
  };
  createDevContainer(image: string, name?: string): StartableContainer;
}
