import re

with open('packages/react/src/hooks/useAgents.ts', 'r') as f:
    content = f.read()

# Remove the unused imports
content = re.sub(
    r"import \{\n  invalidateAgentQueries,\n  patchAgentDetail,\n  patchAgentInLists,\n  rollbackAgentCache,\n  snapshotAgentCache,\n\} from '\./optimistic-agent\.js';",
    "import { invalidateAgentQueries } from './optimistic-agent.js';",
    content, flags=re.DOTALL
)

with open('packages/react/src/hooks/useAgents.ts', 'w') as f:
    f.write(content)

