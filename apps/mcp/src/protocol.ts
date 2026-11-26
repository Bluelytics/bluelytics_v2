/**
 * The Model Context Protocol, server side, for a server that only offers tools. JSON-RPC 2.0 messages
 * in, responses out; no I/O here (the HTTP transport is `http.ts`).
 *
 * Stateless: no message depends on an earlier one. `initialize` is answered but never required, no
 * session id is issued, and the server never sends requests of its own, so any isolate can answer any
 * message.
 */

/** Revisions this server speaks, newest first. `initialize` settles on one of them. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];

export function isSupportedProtocolVersion(version: string): boolean {
  return (PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

export const ERROR_CODE = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type RequestId = string | number;

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: RequestId;
  result: JsonObject;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  /** `null` when the request was too malformed to carry an id. */
  id: RequestId | null;
  error: { code: number; message: string };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export function failure(id: RequestId | null, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** What `tools/list` says about a tool. */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** JSON Schema of the arguments (an object schema). */
  inputSchema: JsonObject;
}

/**
 * A problem the caller can fix: a bad argument, a date without data. It is returned as a tool result
 * with `isError`, which the model reads and corrects, not as a protocol error.
 */
export class ToolError extends Error {
  override name = 'ToolError';
}

export interface Tool<Context> {
  definition: ToolDefinition;
  /** The result object; throws {@link ToolError} for a problem with the arguments. */
  call(args: Record<string, unknown>, context: Context): Promise<JsonObject>;
}

export interface ServerOptions<Context> {
  /** `serverInfo` of the `initialize` result. */
  info: { name: string; title: string; version: string; websiteUrl: string };
  /** How to use the server, given to the model by clients that support it. */
  instructions: string;
  tools: readonly Tool<Context>[];
  /** Called with an unexpected exception of a tool (the caller only learns that it failed). */
  onError?: (tool: string, error: unknown) => void;
}

export interface Server<Context> {
  /**
   * Answers one JSON-RPC message. `null` when the message needs no answer: a notification, or a
   * response to a request (this server sends none).
   */
  handle(message: unknown, context: Context): Promise<JsonRpcResponse | null>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolResult(value: JsonObject): JsonObject {
  // The same object twice: `structuredContent` for programs, its JSON as text for every client
  // (the specification asks for both, for clients that predate structured results).
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

function toolFailure(message: string): JsonObject {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createServer<Context>(options: ServerOptions<Context>): Server<Context> {
  const tools = new Map(options.tools.map((tool) => [tool.definition.name, tool]));
  const listed: Json[] = options.tools.map((tool) => ({
    ...tool.definition,
    // Every tool reads Bluelytics' own data and changes nothing.
    annotations: { title: tool.definition.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));

  function initialize(params: Record<string, unknown>): JsonObject {
    const requested = params['protocolVersion'];
    // The client's revision when this server speaks it, else the newest it does: the client then
    // decides whether it can continue.
    const protocolVersion = typeof requested === 'string' && isSupportedProtocolVersion(requested) ? requested : LATEST_PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { ...options.info },
      instructions: options.instructions,
    };
  }

  async function callTool(id: RequestId, params: Record<string, unknown>, context: Context): Promise<JsonRpcResponse> {
    const name = params['name'];
    if (typeof name !== 'string') return failure(id, ERROR_CODE.invalidParams, 'tools/call needs a tool name');
    const tool = tools.get(name);
    if (tool === undefined) return failure(id, ERROR_CODE.invalidParams, `Unknown tool: ${name}`);
    const args = params['arguments'] ?? {};
    if (!isObject(args)) return failure(id, ERROR_CODE.invalidParams, 'tools/call arguments must be an object');
    try {
      return { jsonrpc: '2.0', id, result: toolResult(await tool.call(args, context)) };
    } catch (error) {
      if (error instanceof ToolError) return { jsonrpc: '2.0', id, result: toolFailure(error.message) };
      options.onError?.(name, error);
      return { jsonrpc: '2.0', id, result: toolFailure('Bluelytics could not answer right now. Try again in a moment.') };
    }
  }

  return {
    async handle(message, context) {
      if (!isObject(message) || message['jsonrpc'] !== '2.0') return failure(null, ERROR_CODE.invalidRequest, 'Not a JSON-RPC 2.0 message');
      const { id, method } = message;
      if (typeof method !== 'string') {
        // A response to a request: this server sends none, so there is nothing to match it with.
        if ('result' in message || 'error' in message) return null;
        return failure(null, ERROR_CODE.invalidRequest, 'The message has no method');
      }
      // No id: a notification (`notifications/initialized`, `notifications/cancelled`…), never answered.
      if (id === undefined) return null;
      if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id))) {
        return failure(null, ERROR_CODE.invalidRequest, 'The request id must be a string or a number');
      }
      const params = message['params'] ?? {};
      if (!isObject(params)) return failure(id, ERROR_CODE.invalidParams, 'params must be an object');

      switch (method) {
        case 'initialize':
          return { jsonrpc: '2.0', id, result: initialize(params) };
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: listed } };
        case 'tools/call':
          return callTool(id, params, context);
        default:
          return failure(id, ERROR_CODE.methodNotFound, `Method not found: ${method}`);
      }
    },
  };
}
