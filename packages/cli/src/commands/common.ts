import { loadConfigFile } from "../config/loader";
import { getClient } from "../client";
import { defaultConsolaLogger } from "../logger";
import type { DBClient } from "../client";
import type { Logger } from "../logger";
import type { ConfigValue } from "../config/loader";

// 全コマンドで共通の基本依存関係
export interface CommonDependencies {
  client: DBClient;
  logger: Logger;
  config: ConfigValue;
}

// CLI専用の共通依存関係作成関数
export async function createCommonDependencies(): Promise<CommonDependencies> {
  const config = await loadConfigFile();
  const client = getClient({ database: config.database });

  return {
    client,
    logger: defaultConsolaLogger,
    config,
  };
}
