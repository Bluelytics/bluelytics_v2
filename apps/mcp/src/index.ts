/**
 * bluelytics-mcp: a public, read-only MCP server with the Bluelytics data (stateless Streamable HTTP
 * on https://bluelytics.com.ar/mcp). Any isolate answers any request: nothing is kept between
 * requests, so it scales like the API.
 */
import type { D1DatabaseLike } from '@bluelytics/db';
import { createHandler } from './http.ts';
import { INSTRUCTIONS, VERSION } from './info.ts';
import { createServer } from './protocol.ts';
import { TOOLS, type ToolContext } from './tools.ts';

// Only the default export may leave this module: the Workers runtime rejects any other export of
// the entry point that is not a handler.

interface Env {
  DB: D1DatabaseLike;
}

const server = createServer<ToolContext>({
  info: { name: 'bluelytics', title: 'Bluelytics', version: VERSION, websiteUrl: 'https://bluelytics.com.ar/mcp' },
  instructions: INSTRUCTIONS,
  tools: TOOLS,
  onError: (tool, error) => console.error(`mcp: ${tool} failed`, error),
});

const handler = createHandler<ToolContext>({
  server,
  about: {
    name: 'Bluelytics MCP server',
    description: 'Argentine dollar rates (blue and official) for agents, over the Model Context Protocol.',
    endpoint: 'https://bluelytics.com.ar/mcp',
    transport: 'Streamable HTTP (stateless, JSON responses)',
    authentication: 'none',
    tools: TOOLS.map((tool) => tool.definition.name),
    documentation: 'https://bluelytics.com.ar/mcp',
  },
});

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handler.fetch(request, { db: env.DB, now: () => new Date().toISOString() });
  },
};
