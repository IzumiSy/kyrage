# AGENTS.md

## Setup commands

- Install deps: `pnpm install`
- Run tests: `pnpm test`
- Run type check: `pnpm type-check`

## Code style

- Always avoid `any`, but use `unknown` instead if unavoidable
- Use functional pattern where possible
- Use arrow to define functions instead of `function` syntax
- Omit return types of a function as much as possible to let callees infer the return types

## Docs

Makee sure to update following markdown docs by criteria:

- `README.md`
  - when you make changes related to user-interface like adding new commands or changing behaviour in CLI
- `DESIGN.md`
  - when you change internal structure or architecture that affects technical detail
