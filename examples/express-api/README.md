# Express API example

An HTTP endpoint that exposes a POST `/spend-intent` backed by
`@astroid/client.transactions.create`.

```bash
pnpm install
pnpm start
```

The example demonstrates wiring an API key via {@code ASTROID_API_KEY} and
relaying the structured error envelope back to the caller.
