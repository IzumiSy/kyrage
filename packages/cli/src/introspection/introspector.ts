import { DBClient } from "../client";
import { postgresColumnExtraIntrospector } from "./postgres";
import { ColumnConstraint, ColumnExtraIntrospector } from "./type";

const getColumnExtraIntrospector = (
  client: DBClient
): ColumnExtraIntrospector => {
  const dialect = client.getDialect();

  switch (dialect) {
    case "postgres": {
      return postgresColumnExtraIntrospector({ client });
    }
    default: {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }
  }
};

export const getIntrospector = (client: DBClient) => {
  const columnExtraIntrospector = getColumnExtraIntrospector(client);
  const getTables = async () => {
    await using db = client.getDB();
    const kyselyIntrospection = await db.introspection.getTables();
    const columnExtra = await columnExtraIntrospector.introspect();

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
              dataType: columnExtraIntrospector.convertTypeName(
                column.dataType
              ),
              default: extraInfo.default ?? null,
              characterMaximumLength: extraInfo.characterMaximumLength ?? null,
              notNull: !column.isNullable,
              constraints: ex.map((c) => c.constraint),
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
  };

  return {
    getTables,
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
