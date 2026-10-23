import re

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'r') as f:
    content = f.read()

content = content.replace("import { createMockClient, createWrapper, AGENT_A, CREATE_PARAMS } from './test-utils.js';", "import { createMockClient, createWrapper, AGENT_A } from './test-utils.js';\nimport type { CreateAgentParams } from '@astroid/types';\nconst CREATE_PARAMS: CreateAgentParams = { name: 'New Agent', network: 'testnet' };")

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'w') as f:
    f.write(content)

with open('packages/react/src/hooks/useAgents.ts', 'r') as f:
    content = f.read()

content = content.replace("import { queryKeys, invalidateQueries } from '../hooks.js';", "import { queryKeys } from '../hooks.js';")

with open('packages/react/src/hooks/useAgents.ts', 'w') as f:
    f.write(content)

