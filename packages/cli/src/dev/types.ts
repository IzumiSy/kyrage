/**
 * Provider interface for managing dev database environments
 *
 * Each dialect (PostgreSQL, SQLite, etc.) implements this interface to provide
 * their own appropriate dev database management strategy.
 *
 * Examples:
 * - PostgreSQL: Provides Docker container-based environments
 * - SQLite: Provides file-based or memory-based environments
 */
export interface DevDatabaseProvider {
  /**
   * Set up a dev database environment
   *
   * Creates a new dev database instance based on the provided configuration.
   * At this point, the actual environment is not started yet - only configuration
   * validation and initialization are performed.
   *
   * @param config Dialect-specific configuration object
   * @param manageType Type of environment management (dev-start or one-off)
   * @returns Configured dev database instance
   */
  setup(
    config: DevDatabaseConfig,
    manageType: DevDatabaseManageType
  ): Promise<DevDatabaseInstance>;

  /**
   * Check if an existing environment of the specified manage type exists
   *
   * Primarily used for reuse detection of persistent environments started by
   * `dev-start` command. `one-off` environments usually return false as they
   * are created fresh each time.
   *
   * @param manageType Type of environment to check for
   * @returns true if existing environment exists and can be reused
   */
  hasExisting(manageType: DevDatabaseManageType): Promise<boolean>;

  /**
   * Clean up all managed environments
   *
   * Used by `kyrage dev clean` command and test environment cleanup.
   * - Container-based: Removes all kyrage-managed containers
   * - File-based: Removes temporary files and managed database files
   */
  cleanup(): Promise<void>;
}

/**
 * Individual dev database environment instance
 *
 * Manages the lifecycle of actual database environments (containers, files, etc.).
 * Responsible for providing temporary clean environments for migration generation
 * and test execution.
 */
export interface DevDatabaseInstance {
  /**
   * Start the environment
   *
   * Makes the actual database environment available for use:
   * - Container-based: Starts container and initializes database
   * - File-based: Creates database file or prepares in-memory DB
   *
   * After this, getConnectionString() can be used to obtain connection info.
   */
  start(): Promise<void>;

  /**
   * Stop the environment
   *
   * Stops the running environment while keeping it restartable:
   * - Container-based: Stops container (without removal)
   * - File-based: Usually no action (files are retained)
   */
  stop(): Promise<void>;

  /**
   * Completely remove the environment
   *
   * Permanently removes the environment and its data:
   * - Container-based: Removes container
   * - File-based: Deletes database files
   */
  remove(): Promise<void>;

  /**
   * Get database connection string
   *
   * Returns connection string in format usable by Kysely.
   * Throws error if called before start().
   *
   * @returns Database connection string
   * @throws Error if environment is not started
   */
  getConnectionString(): string;

  /**
   * Get current environment status
   *
   * Returns detailed information used for debugging and status display.
   *
   * @returns Environment status information (may be unavailable)
   */
  getStatus(): Promise<DevDatabaseStatus>;

  /**
   * Check if environment is available
   *
   * Synchronously checks environment availability.
   * Used to determine if getConnectionString() can be safely called.
   *
   * @returns true if environment is available and connectable
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Dev database environment management type
 *
 * Represents the purpose and lifespan of the environment:
 * - `dev-start`: Persistent development environment (maintained until manually stopped)
 * - `one-off`: Temporary environment (automatically removed after operation completion)
 */
export type DevDatabaseManageType = "dev-start" | "one-off";

/**
 * Typed configuration object for dev database management
 *
 * Note: The configuration validation and parsing is handled by each dialect's
 * parseDevDatabaseConfig() method, ensuring type safety per dialect.
 */
export type DevDatabaseConfig = {
  [key: string]: any;
};

/**
 * Dev database environment status information
 *
 * Provides detailed status information according to each environment type.
 * Used for display in `kyrage dev status` command.
 */
export type DevDatabaseStatus =
  | {
      /** Container-based environment */
      type: "container";
      /** Docker image name in use */
      imageName: string;
      /** Docker container ID */
      containerID: string;
    }
  | {
      /** File-based environment */
      type: "file";
      /** Database file path (may be ":memory:") */
      filePath: string;
      /** File mode */
      mode: "memory" | "file";
    }
  | {
      /** Environment is unavailable */
      type: "unavailable";
    };
