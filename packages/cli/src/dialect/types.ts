import { Dialect } from "kysely";
import { DBClient } from "../client";
import { StartableContainer } from "../dev/container";
import { ReferentialActions } from "../operation";

export type ColumnExtraAttribute = {
  schema?: string;
  table: string;
  name: string;
  default: string | null;
  characterMaximumLength: number | null;
};

type ColumnExtraAttributes = ReadonlyArray<ColumnExtraAttribute>;

type IndexAttributes = ReadonlyArray<{
  schema?: string;
  table: string;
  name: string;
  columns: ReadonlyArray<string>;
  unique: boolean;
}>;

type ConstraintAttribute = {
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

type IntrospectorDriver = {
  introspectTables: () => Promise<ColumnExtraAttributes>;
  introspectIndexes: () => Promise<IndexAttributes>;
  introspectConstraints: () => Promise<ConstraintAttributes>;
  convertTypeName: (typeName: string) => string;
};

export interface KyrageDialect {
  getDevDatabaseImageName: () => string;
  createKyselyDialect: (connectionString: string) => Dialect;
  createIntrospectionDriver: (client: DBClient) => IntrospectorDriver;
  createDevDatabaseContainer: (
    image: string,
    name?: string
  ) => StartableContainer;
}
