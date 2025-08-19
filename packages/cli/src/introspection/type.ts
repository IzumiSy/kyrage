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

type ForeignKeyConstraintAttribute = {
  schema?: string;
  table: string;
  name: string;
  type: "FOREIGN KEY";
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: "cascade" | "set null" | "set default" | "restrict" | "no action";
  onUpdate?: "cascade" | "set null" | "set default" | "restrict" | "no action";
};

export type ConstraintAttributes = {
  primaryKey: ConstraintAttribute[];
  unique: ConstraintAttribute[];
  foreignKey: ForeignKeyConstraintAttribute[];
};

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
