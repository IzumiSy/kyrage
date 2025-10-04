import { DEFAULT_MIGRATION_TABLE, Migration } from "kysely";
import { join } from "path";
import z from "zod";
import { operationSchema, executeOperation } from "./operations/executor";
import { buildReconciledOperations } from "./operations/reconciler";
import { CommonDependencies, FSPromiseAPIs } from "./commands/common";

type CreateMigrationProviderProps = {
  migrationsResolver: () => Promise<
    ReadonlyArray<z.infer<typeof migrationSchema>>
  >;
  options: {
    plan: boolean;
  };
};

export const createMigrationProvider = (
  props: CreateMigrationProviderProps
) => {
  return {
    getMigrations: async () => {
      const migrationFiles = await props.migrationsResolver();
      const migrations: Record<string, Migration> = {};
      migrationFiles.forEach((migration) => {
        migrations[migration.id] = {
          up: async (db) => {
            for (const operation of buildReconciledOperations(
              migration.diff.operations
            )) {
              await executeOperation(db, operation);
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
