# bluelytics-mcp

Public, read-only [MCP](https://modelcontextprotocol.io) server at `https://mcp.bluelytics.com.ar/mcp`.
User docs: https://bluelytics.com.ar/mcp (`apps/web/src/views/McpView.astro`).

- **Stateless Streamable HTTP**: every `POST` is answered with JSON in the same response. No
  session id, no event stream (`GET`/`DELETE` → 405), no authentication, CORS `*`. `initialize`
  is answered but not required, so any isolate can serve any request.
- Protocol revisions 2024-11-05 to 2025-11-25 (`src/protocol.ts`). No SDK at runtime: the server
  side is ~200 lines; the official SDK client is used only in tests.
- Tools (`src/tools.ts`): `get_current_rates`, `get_rates_on_date`, `get_rate_history`,
  `convert_currency`. They read the same D1 database as the API and the site.

```sh
pnpm --filter @bluelytics/mcp test
pnpm --filter @bluelytics/web seed:local      # local data, then:
cd apps/mcp && pnpm exec wrangler dev --local --persist-to ../web/.wrangler/state
pnpm deploy:mcp                               # creates the mcp.bluelytics.com.ar custom domain
```

Only the default export may leave `src/index.ts`: the Workers runtime refuses to start an entry
module with other exports (the Node tests cannot see that).
