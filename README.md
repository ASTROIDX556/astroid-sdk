# astroid-sdk

[![CI](https://github.com/ASTROIDX556/astroid-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ASTROIDX556/astroid-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Built%20on-Stellar-7C3AED)](https://stellar.org)
[![Drips Wave](https://img.shields.io/badge/Drips-Stellar%20Wave-blue)](https://www.drips.network/wave/stellar)

> TypeScript SDK — the **developer surface** of Astroid, the Financial Operating System for autonomous AI agents on Stellar. Built for the [Drips Stellar Wave Program](https://www.drips.network/wave/stellar).

`astroid-sdk` is a TypeScript monorepo that provides typed clients, React hooks, and CLI tooling so developers can integrate Astroid into their own applications and agent runtimes.

## Packages

| Package | Description |
|---|---|
| `@astroid/client` | Typed HTTP client for the Astroid REST API |
| `@astroid/types` | Shared entity and DTO type definitions |
| `@astroid/react` | React hooks (TanStack Query) + `<AstroidProvider>` |
| `@astroid/agent` | Agent resource methods: create, list, update |
| `@astroid/wallet` | Wallet resource methods |
| `@astroid/transaction` | Transaction building and submission helpers |
| `@astroid/policy` | Policy CRUD and simulation |
| `@astroid/budget` | Budget resource methods |
| `@astroid/analytics` | Analytics and metrics |
| `@astroid/auth` | Auth resource methods |
| `@astroid/notification` | Notification subscription |
| `@astroid/webhook` | Webhook management |
| `@astroid/errors` | Typed error classes |
| `@astroid/utils` | Pagination helpers, formatters |
| `@astroid/core` | Core client internals |
| `@astroid/cli` | CLI tooling for Astroid |

## Quick Start

```typescript
import { Astroid } from '@astroid/client';

const client = new Astroid({ apiKey: 'your-api-key' });

// List all AI agents
const agents = await client.agents.list();

// Create a wallet
const wallet = await client.wallets.create({ agentId: 'agent_123' });

// Submit a payment
const tx = await client.transactions.submit({
  walletId: wallet.id,
  destination: 'GABC...',
  amount: '10.00',
  asset: 'XLM',
});
```

### React

```tsx
import { AstroidProvider, useAgents } from '@astroid/react';

function App() {
  return (
    <AstroidProvider config={{ apiKey: process.env.NEXT_PUBLIC_ASTROID_KEY! }}>
      <AgentList />
    </AstroidProvider>
  );
}

function AgentList() {
  const { data: agents } = useAgents();
  return <ul>{agents?.map(a => <li key={a.id}>{a.name}</li>)}</ul>;
}
```

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5 (strict) |
| Package manager | npm workspaces |
| Build | tsc |
| Test | Vitest |
| React | TanStack Query v5 |

## Related Repositories

| Repo | Description |
|---|---|
| [astroid-api](https://github.com/ASTROIDX556/astroid-api) | NestJS backend |
| [astroid-web](https://github.com/ASTROIDX556/astroid-web) | Next.js dashboard |
| [astroid-contract](https://github.com/ASTROIDX556/astroid-contract) | Soroban smart contracts |

## Maintainers

| Name | GitHub | Contact |
|---|---|---|
| Astroid Team | [@ASTROIDX556](https://github.com/ASTROIDX556) | Open an issue or discussion |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs require passing `build`, `typecheck`, and `lint`.

## Security

See [SECURITY.md](SECURITY.md) for the responsible disclosure policy.

## License

MIT — see [LICENSE](LICENSE).
