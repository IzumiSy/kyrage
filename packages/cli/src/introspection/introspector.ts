import { DBClient } from "../client";
import { getDialect } from "../dialect/factory";
import { ColumnExtraAttribute } from "./type";

export const getIntrospector = (client: DBClient) => {
  const dialectName = client.getDialect();
  const kyrageDialect = getDialect(dialectName);
  const extIntrospectorDriver = kyrageDialect.createIntrospectionDriver(client);
  return {
    getTables: async () => {
      await using db = client.getDB();
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
        (v: any) => !v.table.startsWith("kysely_")
      ),
    getConstraints: async () => {
      const constraintResult =
        await extIntrospectorDriver.introspectConstraints();
      const primaryKey = constraintResult.primaryKey.filter(
        (v: any) => !v.table.startsWith("kysely_")
      );
      const unique = constraintResult.unique.filter(
        (v: any) => !v.table.startsWith("kysely_")
      );
      const foreignKey = constraintResult.foreignKey.filter(
        (v: any) => !v.table.startsWith("kysely_")
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
