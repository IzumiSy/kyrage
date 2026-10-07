import { test } from "vitest";
import { fs } from "memfs";
import type { FSPromiseAPIs } from "../src/commands/common";
import type { DialectEnum } from "../src/config/loader";
import { getIntrospector } from "../src/introspector";
import { dialectTestProfiles, startTestDB, testDialect } from "./helper";

/** Lazily starts one database per file and exposes database helpers through Vitest context. */
export const databaseTest = test
  .extend("testDB", { scope: "file" }, async ({}, { onCleanup }) => {
    const { stop, ...database } = await startTestDB();
    onCleanup(stop);
    return {
      ...database,
      baseDeps: {
        client: database.client,
        fs: fs.promises as unknown as FSPromiseAPIs,
      },
      introspector: getIntrospector(database.client),
    };
  })
  .extend("expectations", dialectTestProfiles[testDialect].expectations);

/** Declares dialect-specific test coverage without starting databases for skipped cases. */
export const testForDialects = (
  ...dialects: ReadonlyArray<DialectEnum>
): ReturnType<typeof databaseTest.runIf> => databaseTest.runIf(dialects.includes(testDialect));
