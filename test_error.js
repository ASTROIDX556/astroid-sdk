const fs = require('fs');
const content = fs.readFileSync('packages/react/src/__tests__/use-agent-mutations.test.tsx', 'utf8');
const newContent = content.replace("await waitFor(() => expect(result.current.isSuccess).toBe(true));", "await waitFor(() => { if (result.current.isError) console.error(result.current.error); expect(result.current.isSuccess).toBe(true); });");
fs.writeFileSync('packages/react/src/__tests__/use-agent-mutations.test.tsx', newContent);
