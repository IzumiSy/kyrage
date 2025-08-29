import {
  CompiledQuery,
  DatabaseConnection,
  QueryResult,
  DummyDriver,
} from "kysely";

export class SQLCollectingDriver extends DummyDriver {
  constructor(private queries: CompiledQuery[]) {
    super();
  }

  async acquireConnection() {
    return new CollectorConnection(this.queries);
  }
}

class CollectorConnection implements DatabaseConnection {
  constructor(private queries: CompiledQuery[]) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const queryKind = query.query.kind;

    if (
      queryKind === "CreateTableNode" ||
      queryKind === "DropTableNode" ||
      queryKind === "AlterTableNode"
    ) {
      const tableName = query.query.table.table.identifier.name;
      if (tableName.startsWith("kysely_")) {
        // Skip modification queries for internal migration tables
        return { rows: [] };
      }

      this.queries.push(query);
    } else if (
      queryKind === "CreateIndexNode" ||
      queryKind === "DropIndexNode"
    ) {
      this.queries.push(query);
    }

    return { rows: [] };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    // Nothing to do here.
  }
}
