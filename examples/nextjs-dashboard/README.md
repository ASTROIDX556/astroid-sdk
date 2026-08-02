# Next.js dashboard example

A Next.js 14 App Router route that renders the treasury state using
`@astroid/react` hooks.

```bash
pnpm install
pnpm dev
```

Open `app/page.tsx` — every hook (`useWallets`, `useBudgets`, `useProposals`)
is consumed inside `<AstroidProvider>` so the demo works against a mock mode.
