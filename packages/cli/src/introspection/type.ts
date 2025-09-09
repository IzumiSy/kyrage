import { ReferentialActions } from "../operation";

export type ColumnExtraAttribute = {
  schema?: string;
  table: string;
  name: string;
  default: string | null;
  characterMaximumLength: number | null;
};

// Common types for database introspection (shared between PostgreSQL and DuckDB)
export type DatabaseColumnInfo = {
  table_schema: string;
  table_name: string;
  column_name: string;
  column_default: string | null;
  character_maximum_length: number | null;
};

export type DatabaseIndexInfo = {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  column_names: ReadonlyArray<string>;
};

export type DatabaseConstraintBase = {
  schema: string;
  table: string;
  name: string;
  columns: ReadonlyArray<string>;
};

export type DatabaseForeignKeyConstraint = {
  referenced_table: string;
  referenced_columns: ReadonlyArray<string>;
  on_delete?: ReferentialActions;
  on_update?: ReferentialActions;
};

export type DatabaseConstraint =
  | (DatabaseConstraintBase & {
      type: "PRIMARY KEY";
    })
  | (DatabaseConstraintBase & {
      type: "UNIQUE";
    })
  | (DatabaseConstraintBase &
      DatabaseForeignKeyConstraint & {
        type: "FOREIGN KEY";
      });
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
