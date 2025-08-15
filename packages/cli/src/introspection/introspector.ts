import { DBClient } from "../client";
import { postgresExtraIntrospector } from "./postgres";
import { ColumnConstraint, ExtraIntrospector } from "./type";

const getExtraIntrospector = (client: DBClient): ExtraIntrospector => {
  const dialect = client.getDialect();

  switch (dialect) {
    case "postgres":
    case "cockroachdb":
      return postgresExtraIntrospector({ client });
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }
};

export const getIntrospector = (client: DBClient) => {
  const extraIntrospector = getExtraIntrospector(client);
  return {
    getTables: async () => {
      await using db = client.getDB();
      const kyselyIntrospection = await db.introspection.getTables();
      const columnExtra = await extraIntrospector.introspectTables();

      return kyselyIntrospection.map((table) => {
        const columns: Record<string, Column> = Object.fromEntries(
          table.columns.map((column) => {
            const ex = columnExtra.filter(
              (c) => c.table === table.name && c.name === column.name
            );
            const extraInfo = ex[0] || {};

            return [
              column.name,
              {
                schema: table.schema,
                table: table.name,
                name: column.name,
                dataType: extraIntrospector.convertTypeName(column.dataType),
                default: extraInfo.default ?? null,
                characterMaximumLength:
                  extraInfo.characterMaximumLength ?? null,
                notNull: !column.isNullable,
                constraints: ex.flatMap((c) =>
                  c.constraint ? [c.constraint] : []
                ),
              },
            ];
          })
        );

        return {
          schema: table.schema,
          name: table.name,
          columns,
        };
      });
    },
    getIndexes: async () => await extraIntrospector.introspectIndexes(),
  };
};

type Column = {
  schema?: string;
  table: string;
  name: string;
  dataType: string;
  default: string | null;
  characterMaximumLength: number | null;
  notNull: boolean;
  constraints: Array<ColumnConstraint>;
};
