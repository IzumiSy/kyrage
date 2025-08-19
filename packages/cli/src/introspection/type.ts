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

export type ExtraIntrospectorDriver = {
  introspectTables: () => Promise<ColumnExtraAttributes>;
  introspectIndexes: () => Promise<IndexAttributes>;
  introspectConstraints: () => Promise<ConstraintAttributes>;
  convertTypeName: (type: string) => string;
};

export type IndexIntrospector = {
  introspectIndexes: () => Promise<
    ReadonlyArray<{
      table: string;
      name: string;
      columns: ReadonlyArray<string>;
      unique: boolean;
    }>
  >;
};
