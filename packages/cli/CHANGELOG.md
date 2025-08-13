# @izumisy/kyrage

## 0.7.0

### Minor Changes

- [#25](https://github.com/IzumiSy/kyrage/pull/25) [`2755a84`](https://github.com/IzumiSy/kyrage/commit/2755a848f5214e9e4e3864228731c1d7f9753d9a) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support dropping primary key and unique constraint

### Patch Changes

- [#31](https://github.com/IzumiSy/kyrage/pull/31) [`6081b45`](https://github.com/IzumiSy/kyrage/commit/6081b45ada19c7aadb8d83c8d1a4718342671faa) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix #26

## 0.6.0

### Minor Changes

- 7c7b0c6: Add pretty option in plan mode

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
