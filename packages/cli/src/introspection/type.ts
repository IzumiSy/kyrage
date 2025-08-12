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
