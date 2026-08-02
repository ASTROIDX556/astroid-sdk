# Discord bot example

A slash command (`/approve <proposal-id>`) that approves a pending proposal
through `@astroid/client.proposals.approve`.

Wired to a Discord interaction endpoint. Demonstrates:

- Webhook signature verification via `@astroid/webhooks.verify_signature`.
- Idempotent approval retries.
- Posting the resulting audit link back to the channel.
