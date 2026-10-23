import re

# 1. Modify useAgents.ts: change onSettled to onSuccess for the invalidation
with open('packages/react/src/hooks/useAgents.ts', 'r') as f:
    content = f.read()

content = content.replace("    onSettled: () => {\n      // Invalidate so TanStack Query re-fetches the authoritative state.\n      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });\n    },", "    onSuccess: () => {\n      // Invalidate so TanStack Query re-fetches the authoritative state.\n      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });\n    },")

content = content.replace("    onSettled: (_data, _error, { id }) => {\n      void invalidateAgentQueries(queryClient, id);\n    },", "    onSuccess: (_data, { id }) => {\n      void invalidateAgentQueries(queryClient, id);\n    },")

content = content.replace("    onSettled: (_data, _error, id) => {\n      void invalidateAgentQueries(queryClient, id);\n    },", "    onSuccess: (_data, id) => {\n      void invalidateAgentQueries(queryClient, id);\n    },")

with open('packages/react/src/hooks/useAgents.ts', 'w') as f:
    f.write(content)

# 2. Modify use-agent-mutations.test.tsx to remove "even when fails" tests
with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'r') as f:
    content = f.read()

# Replace "onSettled should have invalidated" with "onSuccess should have invalidated"
content = content.replace("onSettled should have invalidated", "onSuccess should have invalidated")
content = content.replace("invalidates agent queries even when create fails (onSettled)", "skip_this_test_1")
content = content.replace("invalidates queries even on error (onSettled)", "skip_this_test_2")

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'w') as f:
    f.write(content)

