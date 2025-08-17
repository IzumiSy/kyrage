export type ColumnExtraAttribute = {
  schema?: string;
  table: string;
  name: string;
  default: string | null;
  characterMaximumLength: number | null;
};
type ColumnExtraAttributes = Array<ColumnExtraAttribute>;

type IndexAttributes = Array<{
  schema?: string;
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
}>;

type ConstraintAttributes = {
  primaryKey: Array<ConstraintAttribute>;
  unique: Array<ConstraintAttribute>;
};

export type ConstraintAttribute = {
  schema?: string;
  table: string;
  name: string;
  type: "PRIMARY KEY" | "UNIQUE";
  columns: string[];
};

export type ExtraIntrospector = {
  introspectTables: () => Promise<ColumnExtraAttributes>;
  introspectIndexes: () => Promise<IndexAttributes>;
  introspectConstraints: () => Promise<ConstraintAttributes>;
  convertTypeName: (type: string) => string;
};

export type IndexIntrospector = {
  introspectIndexes: () => Promise<
    Array<{
      table: string;
      name: string;
      columns: string[];
      unique: boolean;
    }>
  >;
};
