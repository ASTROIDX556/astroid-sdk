import re

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'r') as f:
    content = f.read()

content = content.replace("const client = createMockClient();", "const client = createMockClient();\n    client.agents.update = vi.fn(async () => AGENT_A);\n    client.agents.delete = vi.fn(async () => undefined);")

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'w') as f:
    f.write(content)

