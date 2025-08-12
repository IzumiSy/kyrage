# @izumisy/kyrage

## 0.5.0

### Minor Changes

- d221705: Implement custom SQL introspector to get extra column information that kysely's builtin one does not help.

  To keep the initial implementation focused, decided to drop `checkSql` support and narrowed dialect support to PostgreSQL for now.

- bba7eaa: Fix type error in defineConfig function

## 0.4.0

### Minor Changes

- 6049629: Support default/check for columns

## 0.3.0

### Minor Changes

- 96e8647: Support plan option

## 0.2.0

### Minor Changes

- Support more dialects: cockroachdb, mysql, sqlite
- Add defineConfig helper

## 0.1.1

### Patch Changes

- Update README

## 0.1.0

### Minor Changes

- 6baebcf: Initial release
