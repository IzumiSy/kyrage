# AGENTS.md

## Development commands

At the root of this project, following commands are available

- Install deps: `pnpm install`
- Run type check: `pnpm type-check`
- Run tests: `pnpm test`
  - To run a specific test for CLI, use `npx vitest run` under `packages/cli` director.

## Code style

- Use `type` over `inteface` to define types
- Use `unknown` over `any` as much as possible 
- Use arrow syntax to define functions over `function` syntax
- Use `ReadonlyArray` type explicitly if the corresponding value is not expected to be mutable
- Use functional pattern where possible
- Omit return types of a function as much as possible to let callees infer the return types
- Write doc comments when you add or update functions, classes, types or something similar 
  - Use English in doc comments

## Docs

Make sure to update following markdown docs by criteria:

- `README.md`
  - when you make changes related to user-interface like adding new commands or changing behaviour in CLI
- `DESIGN.md`
  - when you change internal structure or architecture that affects technical detail
