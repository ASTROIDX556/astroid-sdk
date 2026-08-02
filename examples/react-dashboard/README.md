# React dashboard example (Vite)

A minimal Vite + React route tree that polls pending proposals every 10
seconds using `@astroid/react` hooks.

```bash
pnpm install
pnpm dev
```

The point here is hook ergonomics: `useProposals()` returns a TanStack Query
result, so cache invalidation, suspense and retries are all on the provider.
