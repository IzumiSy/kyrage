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
  const introspect = async () => {
    const kyselyIntrospection = await client.getDB().introspection.getTables();
    const columnExtra = await columnExtraIntrospector.introspect();

    const r: ColumnsObject = {};
    for (const table of kyselyIntrospection) {
      for (const column of table.columns) {
        const ex = columnExtra.filter(
          (c) => c.table === table.name && c.name === column.name
        );
        const columnDefault = ex.length > 0 ? ex[0].default : null;
        const columnCharacterMaximumLength =
          ex.length > 0 ? ex[0].characterMaximumLength : null;

        r[`${table.name}.${column.name}`] = {
          schema: table.schema,
          table: table.name,
          name: column.name,
          dataType: column.dataType,
          default: columnDefault,
          characterMaximumLength: columnCharacterMaximumLength,
          notNull: !column.isNullable,
          constraints: ex.map((c) => c.constraint),
        };
      }
    }

    return r;
  };

  return {
    introspect,
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

type ColumnsObject = Record<string, Column>;
