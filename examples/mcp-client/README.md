# MCP client example

Use Astroid as a Model Context Protocol tool server. The client boots the SDK
in-network and exposes these tools to any MCP host:

- `create_wallet(label?, owner)` → on-chain wallet id.
- `get_balance(wallet_id)` → current holding.
- `list_policies()` → active policy set.
- `create_proposal(agent, amount, asset, purpose)` → pending approval id.
- `submit_transaction(wallet, to, amount)` → transaction id (`ASSISTED` mode).
- `fetch_memory(transaction_id)` → financial memory record.
- `fetch_analytics_overview()` → treasury aggregate.

See `src/index.ts` for the wiring. Because MCP hosts sandbox tools, policy
+ risk are evaluated server-side and the SDK always returns the policy
decision to the caller.
