import { DEFAULT_MIGRATION_TABLE, type Kysely, type Migration } from "kysely";
import { join } from "path";
import z from "zod";
import { operationSchema, executeOperation } from "./operations/executor";
import { buildReconciledOperations } from "./operations/reconciler";
import { CommonDependencies, FSPromiseAPIs } from "./commands/common";
import type { SchemaAdapter } from "./dialect/schema-adapter";

/** Migration sources and injected executors shared by actual and planned execution. */
type CreateMigrationProviderProps = {
  migrationsResolver: () => Promise<
    ReadonlyArray<z.infer<typeof migrationSchema>>
  >;
  options: {
    plan: boolean;
  };
  schemaAdapter: SchemaAdapter;
  /** Real read-only metadata source; the plan collector cannot answer catalog queries. */
  validationDB?: Kysely<any>;
};

/** Captures dialect behavior outside the plain Kysely instances supplied by Migrator. */
export const createMigrationProvider = (
  props: CreateMigrationProviderProps
) => {
  return {
    getMigrations: async () => {
      const migrationFiles = await props.migrationsResolver();
      const operationsById = Object.fromEntries(
        migrationFiles.map((migration) => [
          migration.id,
          buildReconciledOperations(migration.diff.operations),
        ])
      );
      if (props.options.plan) {
        if (!props.validationDB) {
          throw new Error(
            "SQL planning requires a live database for validation"
          );
        }
        await props.schemaAdapter.validateOperations({
          db: props.validationDB,
          operations: Object.keys(operationsById)
            .sort()
            .flatMap((id) => operationsById[id]),
        });
      }

      const migrations: Record<string, Migration> = {};
      Object.entries(operationsById).forEach(([id, operations]) => {
        migrations[id] = {
          up: async (db) => {
            if (!props.options.plan) {
              await props.schemaAdapter.validateOperations({ db, operations });
            }
            for (const operation of operations) {
              await executeOperation(
                db,
                operation,
                props.schemaAdapter.operationExecutors
              );
            }
          },
        };
      });

      return migrations;
    },
  };
};

export const schemaDiffSchema = z.object({
  operations: z.array(operationSchema).readonly(),
});
export type SchemaDiff = z.infer<typeof schemaDiffSchema>;
export const migrationSchema = z.object({
  id: z.string(),
  version: z.string(),
  diff: schemaDiffSchema,
});

export const migrationDirName = "migrations";
export const getAllMigrations = async (deps: { fs: FSPromiseAPIs }) => {
  const { fs } = deps;

  try {
    const files = await fs.readdir(migrationDirName);
    const migrationJSONFiles = files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) =>
        migrationSchema.parse(
          JSON.parse(await fs.readFile(join(migrationDirName, file), "utf-8"))
        )
      );
    return await Promise.all(migrationJSONFiles);
  } catch (error) {
    if (error instanceof Object && "code" in error && error.code === "ENOENT") {
      // Migration directory does not exist, return an empty array
      return [];
    }
    throw error;
  }
};

export const getPendingMigrations = async (deps: CommonDependencies) => {
  const { client, fs } = deps;
  await using db = client.getDB();
  const migrationFiles = await getAllMigrations({ fs });

  // If no migration table exists, it should be the initial time to apply migrations
  // All migrations are marked as pending
  const tables = (
    await db.introspection.getTables({
      withInternalKyselyTables: true,
    })
  ).map((t) => t.name);
  if (!tables.includes(DEFAULT_MIGRATION_TABLE)) {
    return migrationFiles;
  }

  const executedMigrations = await db
    .selectFrom(DEFAULT_MIGRATION_TABLE)
    .select(["name", "timestamp"])
    .$narrowType<{ name: string; timestamp: string }>()
    .execute();

  return migrationFiles.filter(
    (file) => !executedMigrations.some((m) => m.name === file.id)
  );
};
