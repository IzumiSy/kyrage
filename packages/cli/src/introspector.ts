import { DBClient } from "./client";
import { ConfigValue } from "./config/loader";
import { getDialect } from "./dialect/factory";

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

  const introspect = async (config: ConfigValue) => {
    await using db = client.getDB();
    const kyselyIntrospection = await db.introspection.getTables();
    const {
      tables: extTables,
      indexes,
      constraints,
    } = await extIntrospectorDriver.introspect({ config });

    // Build a set of primary key columns for quick lookup
    const primaryKeyColumns = new Set<string>();
    for (const pk of constraints.primaryKey) {
      for (const column of pk.columns) {
        primaryKeyColumns.add(`${pk.table}.${column}`);
      }
    }

    const getTables = () =>
      kyselyIntrospection.map((table) => {
        const columns: Record<string, any> = {};

        for (const column of table.columns) {
          const extraInfo = extTables.find(
            (c) => c.table === table.name && c.name === column.name,
          );
          if (!extraInfo) {
            continue;
          }

          // Primary key columns should always be notNull
          const isPrimaryKey = primaryKeyColumns.has(
            `${table.name}.${column.name}`,
          );

          columns[column.name] = {
            schema: table.schema ?? "public",
            table: table.name,
            name: column.name,
            dataType: extIntrospectorDriver.convertTypeName(column.dataType),
            default: extraInfo.default ?? null,
            characterMaximumLength: extraInfo.characterMaximumLength ?? null,
            notNull: !column.isNullable || isPrimaryKey,
          };
        }

        return {
          schema: table.schema ?? "public",
          name: table.name,
          columns,
        };
      });

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
