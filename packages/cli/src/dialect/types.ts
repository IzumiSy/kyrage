import { Dialect } from "kysely";
import { DBClient } from "../client";
import { StartableContainer } from "../dev/container";
import { DialectEnum } from "../config/loader";

type IntrospectorDriver = {
  introspectTables(): Promise<any[]>;
  introspectIndexes(): Promise<any[]>;
  introspectConstraints(): Promise<any>;
  convertTypeName(typeName: string): string;
};

export interface KyrageDialectInterface {
  getName(): DialectEnum;
  getDefaultImage(): string;
  createKyselyDialect(connectionString: string): Dialect;
  createIntrospectionDriver(client: DBClient): IntrospectorDriver;
  createDevContainer(image: string, name?: string): StartableContainer;
}
