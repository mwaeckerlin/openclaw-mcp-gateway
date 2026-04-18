import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import {
  ALLOWED_HTTP_GATEWAY_OPERATIONS,
  GatewayConfig,
  isHttpToolName,
  loadGatewayConfig
} from "./commands.js";
import { CRON_RPC_OPERATIONS, isCronToolName, validateCronToolArguments } from "./cron.js";
import { callGatewayRpc, GatewayRpcError } from "./gateway-rpc.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

function normalizeResponseBody(response: Response, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "(no output)";
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }

  return bodyText.trimEnd();
}

function formatErrorBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "";
  }

  const maxLength = 500;
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}...`;
}

function normalizeUnknownResponseBody(body: unknown): string {
  if (body === null || body === undefined) {
    return "(no output)";
  }
  if (typeof body === "string") {
    return body.trim() ? body : "(no output)";
  }
  return JSON.stringify(body, null, 2);
}

function messageSuggestsNotSupported(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("endpoint_disabled") ||
    normalized.includes("tool_not_allowlisted") ||
    normalized.includes("not supported") ||
    normalized.includes("not found")
  );
}

function parseGatewayErrorMessage(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: unknown; code?: unknown; type?: unknown };
      message?: unknown;
    };

    const errorCode = typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
    const errorType = typeof parsed.error?.type === "string" ? parsed.error.type : undefined;
    const errorMessage =
      parsed.error?.message && typeof parsed.error.message === "string"
        ? parsed.error.message
        : parsed.message && typeof parsed.message === "string"
          ? parsed.message
          : undefined;

    return [errorCode, errorType, errorMessage].filter(Boolean).join(": ");
  } catch {
    return formatErrorBody(trimmed);
  }
}

function isGatewayCapabilityError(status: number, details: string): boolean {
  if ([404, 405, 501].includes(status)) {
    return true;
  }

  return messageSuggestsNotSupported(details);
}

export async function runAllowedTool(toolName: string, gatewayConfig: GatewayConfig): Promise<string> {
  return runAllowedToolWithArguments(toolName, {}, gatewayConfig);
}

export async function runAllowedToolWithArguments(
  toolName: string,
  toolArguments: unknown,
  gatewayConfig: GatewayConfig
): Promise<string> {
  if (!isHttpToolName(toolName) && !isCronToolName(toolName)) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
  }

  if (isCronToolName(toolName)) {
    const operation = CRON_RPC_OPERATIONS[toolName];
    let params: Record<string, unknown>;
    try {
      params = validateCronToolArguments(toolName, toolArguments);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InvalidParams, `Validation mismatch: ${message}`);
    }

    try {
      const payload = await callGatewayRpc(gatewayConfig, operation.method, params, operation.timeoutMs);
      return normalizeUnknownResponseBody(payload);
    } catch (error: unknown) {
      if (error instanceof GatewayRpcError) {
        if (error.kind === "capability") {
          throw new McpError(
            ErrorCode.InternalError,
            `${toolName} is not supported by the current Gateway RPC capability`
          );
        }
        if (error.kind === "auth") {
          throw new McpError(ErrorCode.InternalError, `Gateway auth failure: ${error.message}`);
        }
        if (error.kind === "timeout") {
          throw new McpError(ErrorCode.InternalError, `Gateway transport timeout: ${error.message}`);
        }
        if (error.kind === "protocol") {
          throw new McpError(ErrorCode.InternalError, `Gateway protocol failure: ${error.message}`);
        }
        throw new McpError(ErrorCode.InternalError, `Gateway transport failure: ${error.message}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Gateway request failed: ${message}`);
    }
  }

  const operation = ALLOWED_HTTP_GATEWAY_OPERATIONS[toolName];
  const method = operation.requestKind === "check" ? "GET" : "POST";
  const url = new URL(operation.requestKind === "check" ? "/api/v1/check" : "/tools/invoke", gatewayConfig.baseUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), operation.timeoutMs);

  try {
    let body: string | undefined;
    if (operation.requestKind === "invoke") {
      body = JSON.stringify(operation.payload);
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        ...(operation.requestKind === "invoke" ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${gatewayConfig.token}`
      },
      ...(body ? { body } : {}),
      signal: abortController.signal
    });

    const responseText = await response.text();
    const gatewayMessage = parseGatewayErrorMessage(responseText);

    if (!response.ok) {
      if (isGatewayCapabilityError(response.status, gatewayMessage)) {
        throw new McpError(
          ErrorCode.InternalError,
          `${toolName} is not supported by the current Gateway API`
        );
      }

      const suffix = gatewayMessage ? `: ${gatewayMessage}` : "";
      throw new McpError(
        ErrorCode.InternalError,
        `Gateway request failed (${response.status} ${response.statusText})${suffix}`
      );
    }

    // Some gateways return HTTP 200 with a structured error payload for unsupported tools.
    if (messageSuggestsNotSupported(gatewayMessage)) {
      throw new McpError(
        ErrorCode.InternalError,
        `${toolName} is not supported by the current Gateway API`
      );
    }

    return normalizeResponseBody(response, responseText);
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new McpError(
        ErrorCode.InternalError,
        `Gateway request timed out after ${operation.timeoutMs}ms`
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Gateway request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function createMcpServer(gatewayConfig: GatewayConfig): Server {
  const server = new Server(
    {
      name: "openclaw-mcp-gateway",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;

    if (!isHttpToolName(toolName) && !isCronToolName(toolName)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
    }

    const output = await runAllowedToolWithArguments(toolName, request.params.arguments, gatewayConfig);

    return {
      content: [
        {
          type: "text",
          text: output
        }
      ]
    };
  });

  return server;
}

function getMcpListenPort(): number {
  const rawPort = process.env.OPENCLAW_MCP_PORT?.trim();
  if (!rawPort) {
    return 4000;
  }

  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("OPENCLAW_MCP_PORT must be an integer between 1 and 65535");
  }

  return parsed;
}

function getMcpListenHost(): string {
  return process.env.OPENCLAW_MCP_HOST?.trim() || "0.0.0.0";
}

function respondJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  gatewayConfig: GatewayConfig
): Promise<void> {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/healthz" && req.method === "GET") {
    respondJson(res, 200, { ok: true, status: "ready" });
    return;
  }

  if (requestUrl.pathname !== "/") {
    respondJson(res, 404, { error: "not_found", message: "Unknown endpoint" });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  const server = createMcpServer(gatewayConfig);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function main(): Promise<void> {
  const gatewayConfig = loadGatewayConfig();
  const port = getMcpListenPort();
  const host = getMcpListenHost();

  const httpServer = createServer((req, res) => {
    void handleMcpHttpRequest(req, res, gatewayConfig).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`HTTP request handling failed: ${message}`);

      if (!res.headersSent) {
        respondJson(res, 500, {
          error: "internal_error",
          message: "Internal server error"
        });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  console.error(`OpenClaw MCP Gateway listening on http://${host}:${port}`);
}

const entryPoint = process.argv[1];
const isDirectRun = typeof entryPoint === "string" && pathToFileURL(entryPoint).href === import.meta.url;

if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start server: ${message}`);
    process.exit(1);
  });
}
