export type ColumnInfoObjects = Record<string, ColumnInfo>;

type ColumnInfo = {
  schema: string;
  table: string;
  default: string | null;
  characterMaximumLength: number | null;
  constraints: Array<{ name: string; type: string }>;
};

export type ConstraintIntrospector = {
  introspect: () => Promise<ColumnInfoObjects>;
};
