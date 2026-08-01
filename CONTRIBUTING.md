# Contributing to the Astroid SDK

Thanks for your interest in improving the official TypeScript toolkit for
Astroid — the Financial Operating System for autonomous AI agents on Stellar.
We develop in the open and welcome issues, discussion, and pull requests.

## Getting started

```bash
git clone https://github.com/AstroidHQ/astroid-sdk.git
cd astroid-sdk
pnpm install
pnpm build      # build every package (topological order)
pnpm typecheck  # strict TypeScript across the workspace
pnpm test       # run the vitest suites
```

This is a [pnpm](https://pnpm.io) workspace monorepo. Each package under
`packages/*` is independently versioned and depends on its siblings through the
`workspace:*` protocol. `@astroid/core`, `@astroid/types`, and `@astroid/errors`
sit at the bottom of the dependency graph — everything else builds on top.

## Ground rules

- **Strict TypeScript.** `strict` is on and `any` is banned (`@typescript-eslint/no-explicit-any`). Prefer generics and precise types.
- **Keep the SDK thin.** Resource packages wrap REST endpoints; they never encode business logic. The backend (`astroid-api`) owns policy, risk, and budget decisions.
- **Conventional Commits.** `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, etc.
- **Tests are required** for new behaviour. Mock `fetch`; never call a live API in unit tests.
- **Public API is documented.** Exported functions carry TSDoc with parameters, return type, and an example.

## Pull request checklist

1. `pnpm build && pnpm typecheck && pnpm test` all pass.
2. New/changed public API is exported from the package `index.ts` and typed.
3. Cross-repo contracts (response envelope, event names, entity/enum names) still match `astroid-api`.
4. Changesets / version bumps follow [SemVer](https://semver.org).

## Branch strategy

`main` is always releasable. Use `feature/*` and `fix/*` branches and open PRs
against `develop`. See the PRD (Document 3) for the full branching model.

By contributing you agree that your contributions are licensed under the MIT License.
