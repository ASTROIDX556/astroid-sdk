import re

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'r') as f:
    content = f.read()

# Remove the note about onSettled
content = re.sub(
    r'\n \* NOTE: Optimistic cache mutations.*?after settle\.',
    '',
    content, flags=re.DOTALL
)

# Replace "onSettled should have invalidated"
content = re.sub(
    r'// onSettled should have invalidated agent queries\.',
    '// onSuccess should have invalidated agent queries.',
    content, flags=re.DOTALL
)

# Remove "invalidates agent queries even when create fails (onSettled)" test
content = re.sub(
    r"  it\('invalidates agent queries even when create fails \(onSettled\)', async \(\) => \{.*?\}\);\n",
    '',
    content, flags=re.DOTALL
)

# Remove "invalidates queries even on error (onSettled)" tests
content = re.sub(
    r"  it\('invalidates queries even on error \(onSettled\)', async \(\) => \{.*?\}\);\n",
    '',
    content, flags=re.DOTALL
)

with open('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'w') as f:
    f.write(content)

