export type ColumnExtraAttributes = Array<ColumnExtraAttribute>;
type ColumnExtraAttribute = {
  schema?: string;
  table: string;
  name: string;
  default: string | null;
  characterMaximumLength: number | null;
  constraint: ColumnConstraint;
};

export type ColumnConstraint = {
  name: string;
  type: string;
};

export type IndexAttributes = Array<IndexAttribute>;
type IndexAttribute = {
  schema?: string;
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
};

export type ConstraintAttributes = Array<ConstraintAttribute>;
type ConstraintAttribute = {
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
