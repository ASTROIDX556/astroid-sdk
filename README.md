# astroid-sdk

> The official TypeScript developer toolkit for **Astroid** — the Financial Operating System for autonomous AI agents on Stellar.

A Stripe-like developer experience for giving AI agents safe, governed financial autonomy. Create agents, provision wallets, define spending policies, simulate them, execute governed transactions, and verify webhooks — all fully typed, tree-shakeable, and runtime-agnostic (Node, edge, browser, React).

```bash
npm install @astroid/client
```

```ts
import { Astroid } from '@astroid/client';

const astroid = new Astroid({ apiKey: process.env.ASTROID_API_KEY! });

const agent = await astroid.agents.create({ name: 'research-bot' });
const wallet = await astroid.wallets.create({ agentId: agent.id });

// Governed spend — evaluated against policy, budget, and risk before it settles
const tx = await astroid.transactions.create({
  walletId: wallet.id,
  to: 'GABC…',
  amount: '25.0',
  asset: 'USDC',
  reason: 'Dataset access',
});
```

## Packages

This is a pnpm workspace. Each resource ships as its own package so consumers pull only what they use; everything depends on `@astroid/core`.

| Package | Description |
| --- | --- |
| `@astroid/client` | Main entry point — `new Astroid({ apiKey })`, resource namespaces, events, plugins, AI-native helpers. |
| `@astroid/core` | HTTP client, retries, middleware, pagination iterator, offline queue. |
| `@astroid/types` | Shared types, DTOs, enums, response envelopes — mirrored 1:1 with the API. |
| `@astroid/errors` | Typed error classes and API error-code mapping. |
| `@astroid/utils` | Date, pagination, formatting, validation, and asset helpers. |
| `@astroid/agent` | Agents: create, update, pause, resume, delete, activity. |
| `@astroid/wallet` | Wallets: create, import, freeze, archive, transfer, balance, history. |
| `@astroid/policy` | Policies: create, update, simulate, enable, disable. |
| `@astroid/budget` | Budgets: create, update, consume, history, analytics. |
| `@astroid/transaction` | Transactions & proposals: create, execute, cancel, status, history, approvals. |
| `@astroid/analytics` | Analytics: overview, cashflow, risk, agents, budgets. |
| `@astroid/auth` | Auth: login, refresh, sessions, passkeys, API keys. |
| `@astroid/notification` | Notifications: list, read, delete, preferences. |
| `@astroid/webhook` | Webhooks with automatic HMAC signature verification. |
| `@astroid/react` | React hooks + provider built on TanStack Query; Suspense- and RSC-ready. |
| `@astroid/cli` | The `astroid` command line: login, init, agent/wallet/policy management, deploy, doctor. |

## Develop

```bash
pnpm install
pnpm build        # build every package (tsup → ESM + CJS + d.ts)
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # vitest across the workspace
pnpm lint         # eslint
```

## Examples

Runnable integrations live in [`examples/`](examples) — CrewAI, LangGraph, Discord bot, Express API, MCP client, Next.js and React dashboards. Each is a standalone project that consumes the published `@astroid/*` packages.

## Design principles

- **Developers first.** Every Astroid capability is reachable from the SDK; you never hand-write a type or an HTTP call.
- **Composable.** Import a single resource package or the full client — the tree-shakeable build keeps bundles small.
- **Safe by default.** Governed transactions carry a `reason`, are evaluated before settlement, and surface typed errors on denial.

## License

MIT — see [LICENSE](LICENSE). Part of the [Astroid](https://github.com/ASTROIDX556) open-source platform.
