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

type ConstraintAttribute = {
  schema?: string;
  table: string;
  name: string;
  type: "PRIMARY KEY" | "UNIQUE";
  columns: string[];
};
export type ConstraintAttributes = Array<ConstraintAttribute>;

export type ExtraIntrospectorDriver = {
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
