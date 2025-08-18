/**
 * Database constraint and index naming utilities
 *
 * This module provides consistent naming conventions for database objects
 * across the entire Kyrage system.
 */

/**
 * Generates a primary key constraint name
 * Format: {table}_{column}_primary_key or {table}_{columns joined by _}_primary_key
 */
export const generatePrimaryKeyConstraintName = (
  tableName: string,
  columns: string[]
): string => {
  if (columns.length === 1) {
    return `${tableName}_${columns[0]}_primary_key`;
  }
  return `pk_${tableName}_${columns.join("_")}`;
};

/**
 * Generates a unique constraint name
 * Format: {table}_{column}_unique or {table}_{columns joined by _}_unique
 */
export const generateUniqueConstraintName = (
  tableName: string,
  columns: string[]
): string => {
  if (columns.length === 1) {
    return `${tableName}_${columns[0]}_unique`;
  }
  return `uq_${tableName}_${columns.join("_")}`;
};

/**
 * Generates an index name
 * Format: idx_{table}_{columns joined by _}
 */
export const generateIndexName = (
  tableName: string,
  columns: string[]
): string => {
  return `idx_${tableName}_${columns.join("_")}`;
};

/**
 * Generates a foreign key constraint name
 * Format: fk_{table}_{columns joined by _}
 */
export const generateForeignKeyConstraintName = (
  tableName: string,
  columns: string[]
): string => {
  return `fk_${tableName}_${columns.join("_")}`;
};

/**
 * All constraint name generators
 */
export const constraintNaming = {
  primaryKey: generatePrimaryKeyConstraintName,
  unique: generateUniqueConstraintName,
  index: generateIndexName,
  foreignKey: generateForeignKeyConstraintName,
} as const;
