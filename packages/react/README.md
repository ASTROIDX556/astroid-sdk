# @astroid/react

React hooks and `<AstroidProvider>` for the Astroid SDK, built on TanStack
Query. Suspense-ready and Next.js Server Component compatible.

## Setup

Wrap your tree in a `QueryClientProvider` and the `AstroidProvider` with an
initialized SDK client:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Astroid } from '@astroid/client';
import { AstroidProvider } from '@astroid/react';

const astroid = new Astroid({ apiKey: process.env.ASTROID_API_KEY! });
const queryClient = new QueryClient();

<QueryClientProvider client={queryClient}>
  <AstroidProvider client={astroid}>
    <App />
  </AstroidProvider>
</QueryClientProvider>
```

## Agent resource hooks

```ts
import { useAgents, useAgent, useCreateAgent } from '@astroid/react';

// Paginated agent list (reactive to the params object).
const { data, isPending, error } = useAgents({ page: 1, limit: 25 });

// Single agent by ID. The query stays idle until an ID is provided.
const { data: agent } = useAgent(id);

// Create an agent. The new agent is optimistically prepended to every cached
// list and rolled back if the request fails; the list is invalidated on settle.
const createAgent = useCreateAgent();
createAgent.mutate({
  name: 'Treasury Bot',
  capabilities: ['transfer'],
  initialBudget: { currency: 'USDC', amount: '500' },
});
```

- `useAgents(params?)` — paginated list query, cached under `['astroid', 'agents', 'list', params]`.
- `useAgent(id?)` — detail query, cached under `['astroid', 'agents', 'detail', id]` and disabled while `id` is undefined.
- `useCreateAgent()` — optimistic create mutation. Companion mutations
  `useUpdateAgent()`, `useUpdateAgentStatus()`, `useUpdateAgentMetadata()`, and
  `useDeleteAgent()` follow the same optimistic pattern.
- `queryKeys` and `invalidateQueries` are exported for direct cache access and
  typed invalidation.

### Optimistic updates on agent mutations (issue #231)

Every agent mutation hook updates the cache **instantly**, before the API
round-trip completes, and follows one shared lifecycle:

1. **`onMutate`** — awaits `queryClient.cancelQueries` over the agents domain
   (an in-flight refetch can no longer clobber the optimistic value), snapshots
   the previous detail and list caches into the mutation context, then writes
   the optimistic value (a spread/merge strictly typed as `Agent`).
2. **`onError`** — restores every snapshotted entry exactly, so a failed
   request leaves the cache as it was.
3. **`onSettled`** — invalidates the specific agent's detail key, every agent
   list, and the whole agents domain (stale-only for derived keys), so the
   cache reconciles with server truth on success *and* failure.

```tsx
const updateAgent = useUpdateAgent();
updateAgent.mutate({ id: 'agent_123', params: { name: 'Renamed' } });
// UI reflects “Renamed” immediately; rollback + refetch are automatic.

const pauseAgent = useUpdateAgentStatus();
pauseAgent.mutate({ id: 'agent_123', status: 'PAUSED' });

const updateMetadata = useUpdateAgentMetadata();
updateMetadata.mutate({ id: 'agent_123', metadata: { team: 'platform' } });
```

The shared helpers (`snapshotAgentCache`, `rollbackAgentCache`,
`invalidateAgentQueries`) are exported for building custom optimistic
mutations with the same contract.
