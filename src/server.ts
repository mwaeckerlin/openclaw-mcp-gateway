import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import {
  ALLOWED_GATEWAY_OPERATIONS,
  GatewayConfig,
  isAllowedToolName,
  loadGatewayConfig
} from "./commands.js";
import { TOOL_DEFINITIONS } from "./tools.js";

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

function messageSuggestsNotSupported(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("endpoint_disabled") ||
    normalized.includes("tool_not_allowlisted") ||
    normalized.includes("not allowlisted") ||
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

    const errorCode =
      parsed.error?.code && typeof parsed.error.code === "string" ? parsed.error.code : undefined;
    const errorType =
      parsed.error?.type && typeof parsed.error.type === "string" ? parsed.error.type : undefined;
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

async function runAllowedTool(toolName: string, gatewayConfig: GatewayConfig): Promise<string> {
  if (!isAllowedToolName(toolName)) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
  }

  const operation = ALLOWED_GATEWAY_OPERATIONS[toolName];
  const payload = gatewayConfig.invokePayloads[toolName];
  if (!payload) {
    throw new McpError(
      ErrorCode.InternalError,
      `${toolName} is not supported by the current Gateway API (missing ${operation.payloadEnvVar})`
    );
  }

  const url = new URL("/tools/invoke", gatewayConfig.baseUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), operation.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayConfig.token}`
      },
      body: JSON.stringify(payload),
      signal: abortController.signal
    });

    const responseText = await response.text();

    if (!response.ok) {
      const details = parseGatewayErrorMessage(responseText);
      if (isGatewayCapabilityError(response.status, details)) {
        throw new McpError(
          ErrorCode.InternalError,
          `${toolName} is not supported by the current Gateway API`
        );
      }

      const suffix = details ? `: ${details}` : "";
      throw new McpError(
        ErrorCode.InternalError,
        `Gateway request failed (${response.status} ${response.statusText})${suffix}`
      );
    }

    const invokeMessage = parseGatewayErrorMessage(responseText);
    if (messageSuggestsNotSupported(invokeMessage)) {
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

async function main(): Promise<void> {
  const gatewayConfig = loadGatewayConfig();

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

    if (!isAllowedToolName(toolName)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
    }

    const output = await runAllowedTool(toolName, gatewayConfig);

    return {
      content: [
        {
          type: "text",
          text: output
        }
      ]
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenClaw MCP Gateway started over stdio");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start server: ${message}`);
  process.exit(1);
});
