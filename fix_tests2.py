import re

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'r') as f:
    content = f.read()

# Replace the specific tests we want to remove
tests_to_remove = [
    r"  it\('invalidates agent queries even when create fails \(onSettled\)', async \(\) => \{.*?\n  \}\);\n",
    r"  it\('invalidates queries even on error \(onSettled\)', async \(\) => \{.*?\n  \}\);\n"
]

for pattern in tests_to_remove:
    content = re.sub(pattern, '', content, flags=re.DOTALL)

# Also rename "on settle" to "on success"
content = content.replace("onSettled should have invalidated", "onSuccess should have invalidated")
content = content.replace("invalidates both detail and list queries on settle", "invalidates both detail and list queries on success")

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'w') as f:
    f.write(content)
