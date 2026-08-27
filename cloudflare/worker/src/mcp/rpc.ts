/**
 * MCP application layer: JSON-RPC 2.0 over the Streamable HTTP transport
 * (POST-only, no SSE — every tool here is request/response). Implements the
 * handshake, tools, and prompts; tool execution delegates to tools.ts.
 */

import { PROTOCOL_VERSION, PROMPTS, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "./instructions";
import { findTool, TOOLS, ToolError, type McpCtx } from "./tools";

const JSON_RPC_VERSION = "2.0";

/**
 * Shared with mcp/index.ts, which enforces this while streaming the request
 * body (see readLimitedBody there) — this is the single source of truth for
 * the cap so the two layers can't drift out of sync.
 */
export const MAX_BODY_BYTES = 30_000_000;

/**
 * A JSON-RPC 2.0 payload may be a batch (a JSON array of requests). Without a
 * cap, a single HTTP request — which only counts once against the per-minute
 * rate limit — could carry an unbounded number of `tools/call` entries, each
 * triggering real D1/R2 work. That turns the batch array into a request-count
 * amplifier that bypasses rate limiting entirely. Capping it keeps the
 * worst-case cost of one HTTP request bounded and predictable.
 */
const MAX_BATCH_SIZE = 25;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

function result(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

function error(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } };
}

export const ERR_PARSE = -32700;
export const ERR_METHOD = -32601;
export const ERR_PARAMS = -32602;

function toolText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Handles one batch-or-single JSON-RPC payload. Returns null for pure notifications (→ HTTP 202). */
export async function handleRpc(ctx: McpCtx, body: unknown): Promise<unknown[] | null> {
  const entries = Array.isArray(body) ? body : [body];
  if (!entries.length) return [error(null, ERR_PARSE, "Empty batch")];
  if (entries.length > MAX_BATCH_SIZE) {
    return [error(null, ERR_PARAMS, `Batch too large — max ${MAX_BATCH_SIZE} requests per call, got ${entries.length}`)];
  }
  const responses: unknown[] = [];
  let sawNotification = false;
  for (const entry of entries as JsonRpcRequest[]) {
    if (!entry || entry.jsonrpc !== JSON_RPC_VERSION || typeof entry.method !== "string") {
      responses.push(error(entry?.id ?? null, ERR_PARSE, "Not a JSON-RPC 2.0 request"));
      continue;
    }
    const isNotification = entry.id === undefined || entry.id === null;
    if (isNotification && entry.method.startsWith("notifications/")) {
      sawNotification = true;
      continue;
    }
    try {
      const outcome = await dispatch(ctx, entry);
      if (outcome === NOTIFICATION_RESULT) {
        sawNotification = true;
        continue;
      }
      responses.push(isNotification ? null : result(entry.id, outcome));
    } catch (e: any) {
      if (isNotification) continue;
      const code = typeof e?.rpcCode === "number" ? e.rpcCode : e instanceof SyntaxError ? ERR_PARSE : -32000;
      responses.push(error(entry.id, code, String(e?.message ?? "Internal error")));
    }
  }
  // A payload made only of notifications produces no response at all (HTTP 202).
  const meaningful = responses.filter((r) => r !== null);
  return meaningful.length ? meaningful : null;
}

const NOTIFICATION_RESULT = Symbol("notification");

async function dispatch(ctx: McpCtx, req: JsonRpcRequest): Promise<unknown> {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, logging: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      };
    case "ping":
      return {};
    case "tools/list":
      // Handlers are not serializable — advertise name/description/schema only.
      return {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      };
    case "tools/call": {
      const name = typeof req.params?.name === "string" ? req.params.name : "";
      const tool = findTool(name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: ERR_METHOD });
      // Tool-logic failures are results with isError:true so the agent can
      // read and react to them; only protocol problems become JSON-RPC errors.
      let value: unknown;
      try {
        value = await tool.run(ctx, req.params?.arguments ?? {});
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        value = { error: e.message };
        return { content: [{ type: "text", text: e.message }], structuredContent: value, isError: true };
      }
      // Both shapes: text content for maximal client compatibility,
      // structuredContent for clients that prefer machine-readable results.
      return { content: [{ type: "text", text: toolText(value) }], structuredContent: value };
    }
    case "prompts/list":
      return {
        prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({
          name,
          title,
          description,
          arguments: args.map(({ name: n, description: d, required }) => ({ name: n, description: d, required: !!required })),
        })),
      };
    case "prompts/get": {
      const prompt = PROMPTS.find((p) => p.name === req.params?.name);
      if (!prompt) throw Object.assign(new Error("Unknown prompt"), { rpcCode: ERR_METHOD });
      const args: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.params?.arguments ?? {})) args[k] = String(v ?? "");
      return {
        description: prompt.description,
        messages: [
          {
            role: "user",
            content: { type: "text", text: prompt.build(args) },
          },
        ],
      };
    }
    default:
      throw Object.assign(new Error(`Method not supported: ${req.method}`), { rpcCode: ERR_METHOD });
  }
}
