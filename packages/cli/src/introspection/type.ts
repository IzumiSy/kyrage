export type ColumnExtraAttributes = Array<ColumnExtraAttribute>;
export type ColumnConstraint = {
  name: string;
  type: string;
};

type ColumnExtraAttribute = {
  schema?: string;
  table: string;
  name: string;
  default: string | null;
  characterMaximumLength: number | null;
  constraint: ColumnConstraint;
};

export type ColumnExtraIntrospector = {
  introspect: () => Promise<ColumnExtraAttributes>;
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

export type ColumnAndIndexExtraIntrospector = ColumnExtraIntrospector &
  IndexIntrospector;

export const hasIndexIntrospection = (
  i: ColumnExtraIntrospector
): i is ColumnAndIndexExtraIntrospector =>
  "introspectIndexes" in i &&
  typeof (i as ColumnAndIndexExtraIntrospector).introspectIndexes ===
    "function";
