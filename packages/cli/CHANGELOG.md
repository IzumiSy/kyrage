# @izumisy/kyrage

## 1.1.0

### Minor Changes

- [#58](https://github.com/IzumiSy/kyrage/pull/58) [`2890e7c`](https://github.com/IzumiSy/kyrage/commit/2890e7cb44a0ad15e9e319033ed66c5950222ac8) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Add reuse API #52

### Patch Changes

- [#60](https://github.com/IzumiSy/kyrage/pull/60) [`5fefb21`](https://github.com/IzumiSy/kyrage/commit/5fefb21cafc6a1e958fcd74f816c4a5134348087) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix implicit non-null marks by composite primary key #48

## 1.0.0

### Major Changes

- [#47](https://github.com/IzumiSy/kyrage/pull/47) [`b2e220a`](https://github.com/IzumiSy/kyrage/commit/b2e220a0dd21228f287a8ea61253039878638e5f) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Dev database support #46

### Minor Changes

- [#44](https://github.com/IzumiSy/kyrage/pull/44) [`5783c95`](https://github.com/IzumiSy/kyrage/commit/5783c951d33c66f7ad1364525557b65195db53a0) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support foreign key support #34

- [#13](https://github.com/IzumiSy/kyrage/pull/13) [`b6f7b25`](https://github.com/IzumiSy/kyrage/commit/b6f7b258d78d20d8b669719cd62a0cfac097b010) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support index #17

- [#37](https://github.com/IzumiSy/kyrage/pull/37) [`4149692`](https://github.com/IzumiSy/kyrage/commit/4149692a92c9bb03b606f9d953b7d80af9841194) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Support constraints: composite primary key and composite unique #33

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
