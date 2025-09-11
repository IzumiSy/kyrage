import { DBClient } from "./client";
import { getDialect } from "./dialect/factory";
import { ColumnExtraAttribute } from "./dialect/types";

/**
 * Get an introspector for the given database client.
 *
 * The builtin introspector of Kysely is used to get basic information,
 * and extended introspection is performed using the dialect-specific driver
 * to get additional information such as indexes, constraints, and column details.
 */
export const getIntrospector = (client: DBClient) => {
  const kyrageDialect = getDialect(client.getDialect());
  const extIntrospectorDriver = kyrageDialect.createIntrospectionDriver(client);

  const introspect = async () => {
    await using db = client.getDB();
    const kyselyIntrospection = await db.introspection.getTables();
    const {
      tables: extTables,
      indexes,
      constraints,
    } = await extIntrospectorDriver.introspect();

    const getTables = () => {
      return kyselyIntrospection.map((table) => {
        const columns: Record<string, Column> = Object.fromEntries(
          table.columns.map((column) => {
            const ex = extTables.filter(
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
    };

    const notInternalTable = (p: { table: string }) =>
      !p.table.startsWith("kysely_");
    const getIndexes = () => indexes.filter(notInternalTable);
    const getConstraints = () => {
      return {
        primaryKey: constraints.primaryKey.filter(notInternalTable),
        unique: constraints.unique.filter(notInternalTable),
        foreignKey: constraints.foreignKey.filter(notInternalTable),
      };
    };

    return {
      tables: getTables(),
      indexes: getIndexes(),
      constraints: getConstraints(),
    };
  };

  return {
    introspect,
  };
};

// A data structure enriched with the data from kysely introspector
type Column = ColumnExtraAttribute & {
  dataType: string;
  characterMaximumLength: number | null;
  notNull: boolean;
};
