# LangGraph agent example

A LangGraph StateGraph that receives a research request, budgets 500 USDC,
and proposes the spend via `@astroid/client.proposals.create`.

Demonstrates:

- Structured intent extraction with a LangGraph tool node.
- Policy simulation before proposal creation.
- Idempotent proposal submission via `client.proposals.create`.
