import { DBClient } from "../client";
import { postgresConstraintIntrospector } from "./postgres";
import { ConstraintIntrospector } from "./type";

export const getConstraintIntrospector = (
  client: DBClient
): ConstraintIntrospector => {
  const dialect = client.getDialect();

  switch (dialect) {
    case "postgres": {
      return postgresConstraintIntrospector({ client });
    }
    default: {
      throw new Error(`Unsupported dialect: ${dialect}`);
    }
  }
};
