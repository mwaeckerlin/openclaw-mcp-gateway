import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import {
  ALLOWED_GATEWAY_REQUESTS,
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

async function runAllowedTool(toolName: string, gatewayConfig: GatewayConfig): Promise<string> {
  if (!isAllowedToolName(toolName)) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
  }

  const requestSpec = ALLOWED_GATEWAY_REQUESTS[toolName];
  const url = new URL(requestSpec.path, gatewayConfig.baseUrl);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), requestSpec.timeoutMs);

  try {
    const response = await fetch(url, {
      method: requestSpec.method,
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        Authorization: `Bearer ${gatewayConfig.key}`,
        "X-API-Key": gatewayConfig.key
      },
      signal: abortController.signal
    });

    const responseText = await response.text();

    if (!response.ok) {
      if (response.status === 404 && requestSpec.notSupportedOn404) {
        throw new McpError(
          ErrorCode.InternalError,
          `${toolName} is not supported by the current Gateway API`
        );
      }

      const details = formatErrorBody(responseText);
      const suffix = details ? `: ${details}` : "";
      throw new McpError(
        ErrorCode.InternalError,
        `Gateway request failed (${response.status} ${response.statusText})${suffix}`
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
        `Gateway request timed out after ${requestSpec.timeoutMs}ms`
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
