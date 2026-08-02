# Astroid SDK examples

Each subfolder is a self-contained project that consumes the published
`@astroid/*` packages. Examples stay out of the workspace root install so
development builds stay fast — follow each folder's own README to run it.

| Folder | What it shows |
|---|---|
| [`nextjs-dashboard/`](nextjs-dashboard/) | App Router + `@astroid/react` hooks driven by an agent treasury. |
| [`express-api/`](express-api/) | Minimal Node service exposing spend intents through `@astroid/client`. |
| [`langgraph-agent/`](langgraph-agent/) | LangGraph tool-node that proposes + budgets a payment. |
| [`crewai-agent/`](crewai-agent/) | CrewAI task that delegates budget checks. |
| [`discord-bot/`](discord-bot/) | Slash-command approvals of pending proposals. |
| [`mcp-client/`](mcp-client/) | Use Astroid as a Model Context Protocol server. |
| [`react-dashboard/`](react-dashboard/) | Bare-bones Vite dashboard polling pending proposals. |

> These examples reference packages under `packages/*`. Until the SDK is
> published to npm each example uses a `workspace:*` dependency resolved via
> the root pnpm workspace when you run `pnpm --filter <name> ...` from the
> example folder.
