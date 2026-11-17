import { createInterface } from "node:readline";
import { createHostClient, resolveHostUrl, type HostClient } from "./host-client.ts";
import { MCP_CLIENT_ID, TOOL_DEFINITIONS, callTool } from "./tools.ts";

export {
  DEFAULT_HOST_URL,
  HostError,
  createHostClient,
  resolveHostUrl,
} from "./host-client.ts";
export type {
  HostApprovalOutcome,
  HostBounds,
  HostClient,
  HostHomeCandidate,
  HostIntentOutcome,
  HostIntentRequest,
  HostState,
  HostTickOutcome,
  HostWorldSnapshot,
  McpIntentOperation,
} from "./host-client.ts";
export { MCP_CLIENT_ID, TOOL_DEFINITIONS, TOOL_NAMES, ToolInputError } from "./tools.ts";
export type { JsonSchema, McpToolDefinition } from "./tools.ts";

/**
 * Protocol revision this server implements. It is deliberately a fixed subset:
 * initialize, notifications/initialized, tools/list, tools/call and ping only.
 * There is no streaming, resources or prompts support, so capabilities advertise
 * tools alone and no other capability is claimed.
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05" as const;

export const MCP_SERVER_INFO = Object.freeze({ name: "fangcun-mcp", version: "0.1.0" });

export const JSON_RPC_ERROR_CODES = Object.freeze({
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
});

export type JsonRpcId = string | number | null;

export type JsonRpcFailure = Readonly<{
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: Readonly<{ code: number; message: string }>;
}>;

export type JsonRpcSuccess = Readonly<{ jsonrpc: "2.0"; id: JsonRpcId; result: unknown }>;
export type JsonRpcResponse = JsonRpcFailure | JsonRpcSuccess;

export type McpToolResult = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;

export type McpServerOptions = Readonly<{
  /** Loopback Host base URL; defaults to FANGCUN_HOST or http://127.0.0.1:8765. */
  hostUrl?: string;
  /** Test seam; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Intent client id; defaults to "mcp-agent". */
  clientId?: string;
}>;

const INITIALIZE_RESULT = Object.freeze({
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: Object.freeze({ tools: Object.freeze({}) }),
  serverInfo: MCP_SERVER_INFO,
  instructions: "Fangcun is a 16x16x16 voxel world owned by a local Host. Only the tools listed by tools/list are supported; this server does not implement resources, prompts or streaming.",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return Object.freeze({ jsonrpc: "2.0" as const, id, result });
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcFailure {
  return Object.freeze({ jsonrpc: "2.0" as const, id, error: Object.freeze({ code, message }) });
}

function readJsonRpcId(value: unknown): JsonRpcId | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function toolResult(text: string, isError: boolean): McpToolResult {
  return Object.freeze({
    content: Object.freeze([Object.freeze({ type: "text" as const, text })]),
    ...(isError ? { isError: true } : {}),
  });
}

function shortErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Tool failed";
  // Newlines would break the one-line JSON-RPC framing and stacks/paths are not useful to a model.
  const singleLine = message.replace(/[\r\n]+/g, " ").trim();
  return singleLine.length === 0 ? "Tool failed" : singleLine.slice(0, 300);
}

/**
 * One MCP session over newline-delimited JSON-RPC 2.0. Instances are cheap and
 * stateless apart from the intent sequence counter, so tests can construct one per case.
 */
export class McpServer {
  readonly #host: HostClient;
  readonly #clientId: string;
  #seq = 0;

  constructor(options: McpServerOptions = {}) {
    this.#host = createHostClient(resolveHostUrl(options.hostUrl), options.fetch ?? globalThis.fetch);
    this.#clientId = options.clientId ?? MCP_CLIENT_ID;
  }

  #nextSeq(): number {
    this.#seq += 1;
    return this.#seq;
  }

  /** Handles one JSON-RPC message; returns the response line, or null for notifications and blank lines. */
  async handleLine(line: string): Promise<string | null> {
    // A blank line is framing noise (e.g. a keepalive write), not a JSON-RPC request.
    if (line.trim().length === 0) return null;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return JSON.stringify(failure(null, JSON_RPC_ERROR_CODES.parseError, "Parse error"));
    }
    try {
      const response = await this.handleMessage(message);
      return response === null ? null : JSON.stringify(response);
    } catch {
      return JSON.stringify(failure(null, JSON_RPC_ERROR_CODES.internalError, "Internal error"));
    }
  }

  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isRecord(message)) return failure(null, JSON_RPC_ERROR_CODES.invalidRequest, "Invalid Request");
    const isNotification = !Object.hasOwn(message, "id");
    if (!isNotification && readJsonRpcId(message.id) === undefined) {
      return failure(null, JSON_RPC_ERROR_CODES.invalidRequest, "Invalid Request");
    }
    const id: JsonRpcId = isNotification ? null : readJsonRpcId(message.id) ?? null;
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return isNotification ? null : failure(id, JSON_RPC_ERROR_CODES.invalidRequest, "Invalid Request");
    }
    const method = message.method;
    if (method === "initialize") return isNotification ? null : success(id, INITIALIZE_RESULT);
    if (method === "notifications/initialized") return null;
    if (method === "ping") return isNotification ? null : success(id, Object.freeze({}));
    if (method === "tools/list") return isNotification ? null : success(id, Object.freeze({ tools: TOOL_DEFINITIONS }));
    if (method === "tools/call") return isNotification ? null : this.#handleToolCall(id, message.params);
    return isNotification ? null : failure(id, JSON_RPC_ERROR_CODES.methodNotFound, `Method not found: ${method}`);
  }

  async #handleToolCall(id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> {
    if (!isRecord(params) || typeof params.name !== "string" || params.name.length === 0) {
      return failure(id, JSON_RPC_ERROR_CODES.invalidParams, "tools/call requires a tool name");
    }
    if (params.arguments !== undefined && !isRecord(params.arguments)) {
      return failure(id, JSON_RPC_ERROR_CODES.invalidParams, "tools/call arguments must be an object");
    }
    try {
      const value = await callTool(params.name, params.arguments, {
        host: this.#host,
        clientId: this.#clientId,
        nextIntentSeq: () => this.#nextSeq(),
      });
      return success(id, toolResult(JSON.stringify(value) ?? "null", false));
    } catch (error) {
      // Tool and Host failures are domain results, not transport failures: report isError
      // so the model can read the message and retry with corrected input.
      return success(id, toolResult(shortErrorMessage(error), true));
    }
  }
}

/**
 * Runs the server until stdin closes. stdout is reserved for JSON-RPC responses, so
 * diagnostics must go to stderr; writing them to stdout would corrupt the stream.
 */
export async function runStdioServer(options: McpServerOptions = {}): Promise<void> {
  const server = new McpServer(options);
  process.stdout.on("error", () => {
    // The client closed its end; the stdin loop will observe EOF and shut down.
  });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const response = await server.handleLine(line);
    if (response !== null) process.stdout.write(`${response}\n`);
  }
}
