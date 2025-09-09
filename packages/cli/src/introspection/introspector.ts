import { DBClient } from "../client";
import { postgresExtraIntrospectorDriver } from "./postgres";
import { duckdbExtraIntrospectorDriver } from "./duckdb";
import { ColumnExtraAttribute } from "./type";

const getExtraIntrospectorDriver = (client: DBClient) => {
  const dialect = client.getDialect();

  switch (dialect) {
    case "postgres":
    case "cockroachdb":
      return postgresExtraIntrospectorDriver({ client });
    case "duckdb":
      return duckdbExtraIntrospectorDriver({ client });
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }
};

export const getIntrospector = (client: DBClient) => {
  const extIntrospectorDriver = getExtraIntrospectorDriver(client);
  return {
    getTables: async () => {
      await using db = await client.getDB();
      const kyselyIntrospection = await db.introspection.getTables();
      const columnExtra = await extIntrospectorDriver.introspectTables();

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
                dataType: extIntrospectorDriver.convertTypeName(
                  column.dataType
                ),
                default: extraInfo.default ?? null,
                characterMaximumLength:
                  extraInfo.characterMaximumLength ?? null,
                notNull: !column.isNullable,
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
    getIndexes: async () =>
      (await extIntrospectorDriver.introspectIndexes()).filter(
        (v) => !v.table.startsWith("kysely_")
      ),
    getConstraints: async () => {
      const constraintResult =
        await extIntrospectorDriver.introspectConstraints();
      const primaryKey = constraintResult.primaryKey.filter(
        (v) => !v.table.startsWith("kysely_")
      );
      const unique = constraintResult.unique.filter(
        (v) => !v.table.startsWith("kysely_")
      );
      const foreignKey = constraintResult.foreignKey.filter(
        (v) => !v.table.startsWith("kysely_")
      );

      return {
        primaryKey,
        unique,
        foreignKey,
      };
    },
  };
};

// A data structure enriched with the data from kysely introspector
type Column = ColumnExtraAttribute & {
  dataType: string;
  characterMaximumLength: number | null;
  notNull: boolean;
};
