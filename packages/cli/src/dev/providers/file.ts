import {
  DevDatabaseProvider,
  DevDatabaseInstance,
  DevDatabaseConfig,
  DevDatabaseManageType,
  DevDatabaseStatus,
} from "../types";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export type FileDevDatabaseConfig = DevDatabaseConfig & {
  mode: "memory" | "file";
  filePath?: string;
};

/**
 * File-based dev database provider
 *
 * Provides file-based or memory-based development database environments.
 * Used by SQLite dialect.
 */
export class FileDevDatabaseProvider implements DevDatabaseProvider {
  async setup(
    config: DevDatabaseConfig,
    manageType: DevDatabaseManageType
  ): Promise<DevDatabaseInstance> {
    const fileConfig = config as FileDevDatabaseConfig;

    return new FileDevDatabaseInstance({
      manageType: manageType,
      mode: fileConfig.mode,
      filePath: fileConfig.filePath,
      name: config.name,
    });
  }

  async hasExisting(): Promise<boolean> {
    // SQLite doesn't have persistent dev-start environments like containers
    // Each environment is created fresh from files
    return false;
  }

  async cleanup(): Promise<void> {
    // Clean up temporary kyrage database files
    try {
      const tempDir = os.tmpdir();
      const files = await fs.readdir(tempDir);
      const kyrageFiles = files.filter((f) => f.startsWith("kyrage-dev-"));

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
      mode: "memory" | "file";
      filePath?: string;
      name?: string;
    }
  ) {}

  async start(): Promise<void> {
    if (this.options.mode === "memory") {
      this.connectionString = ":memory:";
    } else {
      this.filePath = this.options.filePath || this.generateTempPath();
      this.connectionString = this.filePath;
    }
  }

  async stop(): Promise<void> {
    // SQLite doesn't require explicit stopping
    // Connection will be closed when database client is disposed
  }

  async remove(): Promise<void> {
    if (this.filePath && this.options.mode === "file") {
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

    return {
      type: "file",
      filePath: this.connectionString,
      mode: this.options.mode,
    };
  }

  isAvailable(): boolean {
    return !!this.connectionString;
  }

  private generateTempPath(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const basename = this.options.name ? `${this.options.name}-` : "";
    return path.join(
      os.tmpdir(),
      `kyrage-dev-${basename}${timestamp}-${random}.db`
    );
  }
}
