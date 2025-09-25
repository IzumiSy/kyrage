import { Dialect } from "kysely";
import { DBClient } from "../client";
import { ReferentialActions } from "../operations/shared/types";
import { ConfigValue } from "../config/loader";
import { DevDatabaseProvider, DevDatabaseConfig } from "../dev/types";

export type ColumnExtraAttribute = {
  schema?: string;
  table: string;
  name: string;
  default: string | null;
  characterMaximumLength: number | null;
};

type ColumnExtraAttributes = ReadonlyArray<ColumnExtraAttribute>;

export type IndexAttribute = {
  schema?: string;
  table: string;
  name: string;
  columns: ReadonlyArray<string>;
  unique: boolean;
};
export type IndexAttributes = ReadonlyArray<IndexAttribute>;

export type ConstraintAttribute = {
  schema?: string;
  table: string;
  name: string;
  type: "PRIMARY KEY" | "UNIQUE";
  columns: ReadonlyArray<string>;
};

type ForeignKeyConstraintAttribute = {
  schema?: string;
  table: string;
  name: string;
  type: "FOREIGN KEY";
  columns: ReadonlyArray<string>;
  referencedTable: string;
  referencedColumns: ReadonlyArray<string>;
  onDelete?: ReferentialActions;
  onUpdate?: ReferentialActions;
};

export type ConstraintAttributes = {
  primaryKey: ReadonlyArray<ConstraintAttribute>;
  unique: ReadonlyArray<ConstraintAttribute>;
  foreignKey: ReadonlyArray<ForeignKeyConstraintAttribute>;
};

type IntrospectResult = {
  tables: ColumnExtraAttributes;
  indexes: IndexAttributes;
  constraints: ConstraintAttributes;
};

export type IntrospectProps = {
  config: ConfigValue;
};

export type IntrospectorDriver = {
  introspect: (props: IntrospectProps) => Promise<IntrospectResult>;
  convertTypeName: (typeName: string) => string;
};

export interface KyrageDialect<T extends string = string> {
  getName: () => T;
  createKyselyDialect: (connectionString: string) => Dialect;
  createIntrospectionDriver: (client: DBClient) => IntrospectorDriver;
  createDevDatabaseProvider: () => DevDatabaseProvider;
  parseDevDatabaseConfig: (config: unknown) => DevDatabaseConfig;
  hasReusableDevDatabase: () => Promise<boolean>;
}
