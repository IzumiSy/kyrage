import {
  DevDatabaseProvider,
  DevDatabaseInstance,
  DevDatabaseManageType,
  DevDatabaseStatus,
} from "../types";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import z from "zod";

const defaultName = "default";
export const buildFileDevDatabaseConfig = () =>
  z.object({
    file: z
      .object({
        name: z.string().default(defaultName),
      })
      .default({
        name: defaultName,
      }),
  });
export type FileDevDatabaseConfig = z.infer<
  ReturnType<typeof buildFileDevDatabaseConfig>
>;

/**
 * File-based dev database provider
 *
 * Provides file-based or memory-based development database environments.
 * Used by SQLite dialect.
 */
export class FileDevDatabaseProvider implements DevDatabaseProvider {
  async setup(
    config: FileDevDatabaseConfig,
    manageType: DevDatabaseManageType
  ): Promise<DevDatabaseInstance> {
    return new FileDevDatabaseInstance({
      manageType: manageType,
      name: config.file?.name,
    });
  }

  async hasExisting(manageType: DevDatabaseManageType): Promise<boolean> {
    if (manageType === "dev-start") {
      // dev-startの固定パスファイルが存在するかチェック
      const devStartPath = this.getDevStartPath();
      try {
        await fs.access(devStartPath);
        return true;
      } catch {
        return false;
      }
    }
    return false; // one-offは常に新規作成（memory）
  }

  private getDevStartPath(name?: string): string {
    const basename = name || defaultName;
    return path.join(os.tmpdir(), `kyrage___dev-${basename}.db`);
  }

  async cleanup(): Promise<void> {
    // Clean up temporary kyrage database files
    try {
      const tempDir = os.tmpdir();
      const files = await fs.readdir(tempDir);
      const kyrageFiles = files.filter((f) => f.startsWith("kyrage___dev-"));

      await Promise.allSettled(
        kyrageFiles.map((f) => fs.unlink(path.join(tempDir, f)))
      );
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * File-based dev database instance
 *
 * Manages the lifecycle of a SQLite database file or memory database.
 */
class FileDevDatabaseInstance implements DevDatabaseInstance {
  private connectionString: string | null = null;
  private filePath: string | null = null;

  constructor(
    private options: {
      manageType: DevDatabaseManageType;
      name?: string;
    }
  ) {}

  async start(): Promise<void> {
    if (this.options.manageType === "dev-start") {
      // dev-start: 固定名の再利用可能ファイル（tmpdir内）
      this.filePath = this.getDevStartPath();
      this.connectionString = this.filePath;
    } else {
      // one-off: メモリベース（高速、自動削除）
      this.connectionString = ":memory:";
    }
  }

  async stop(): Promise<void> {
    // SQLite doesn't require explicit stopping
    // Connection will be closed when database client is disposed
  }

  async remove(): Promise<void> {
    if (this.filePath) {
      try {
        await fs.unlink(this.filePath);
      } catch {
        // Ignore file removal errors
      }
    }
    this.connectionString = null;
    this.filePath = null;
  }

  getConnectionString(): string {
    if (!this.connectionString) {
      throw new Error("File database is not started");
    }
    return this.connectionString;
  }

  async getStatus(): Promise<DevDatabaseStatus> {
    if (!this.connectionString) {
      return { type: "unavailable" };
    }

    if (this.connectionString === ":memory:") {
      return {
        type: "file",
        filePath: ":memory:",
        mode: "memory",
      };
    }

    return {
      type: "file",
      filePath: this.connectionString,
      mode: "file",
    };
  }

  isAvailable(): boolean {
    return !!this.connectionString;
  }

  private getDevStartPath(): string {
    const basename = this.options.name || defaultName;
    return path.join(os.tmpdir(), `kyrage___dev-${basename}.db`);
  }
}
