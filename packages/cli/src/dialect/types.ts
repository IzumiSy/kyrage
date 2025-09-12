import { Dialect } from "kysely";
import { DBClient } from "../client";
import { StartableContainer } from "../dev/container";
import { ReferentialActions } from "../operation";
import { ConfigValue } from "../config/loader";

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
  getDevDatabaseImageName: () => string;
  createKyselyDialect: (connectionString: string) => Dialect;
  createIntrospectionDriver: (client: DBClient) => IntrospectorDriver;
  createDevDatabaseContainer: (image: string) => StartableContainer;
}
