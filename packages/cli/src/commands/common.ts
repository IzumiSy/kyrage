import { loadConfigFile } from "../config/loader";
import { getClient } from "../client";
import { defaultConsolaLogger } from "../logger";
import type { DBClient } from "../client";
import type { Logger } from "../logger";
import type { ConfigValue } from "../config/loader";
import * as fsPromises from "fs/promises";

/**
 * A type with extracted methods from fs/promises used by Kyrage.
 *
 * This is to avoid type mismatches between fs/promises and memfs's fs.promises for testing.
 */
export type FSPromiseAPIs = Pick<
  typeof fsPromises,
  "readFile" | "readdir" | "mkdir" | "writeFile" | "unlink"
>;

// 全コマンドで共通の基本依存関係
export interface CommonDependencies {
  client: DBClient;
  logger: Logger;
  fs: FSPromiseAPIs;
  config: ConfigValue;
}

// CLI専用の共通依存関係作成関数
export async function createCommonDependencies() {
  const config = await loadConfigFile();
  const client = getClient({ database: config.database });

  return {
    client,
    logger: defaultConsolaLogger,
    fs: fsPromises,
    config,
  };
}
