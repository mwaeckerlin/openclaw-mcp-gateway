import { execFile } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { ALLOWED_COMMANDS, isAllowedToolName } from "./commands.js";
import { TOOL_DEFINITIONS } from "./tools.js";

function runAllowedCommand(toolName: string): Promise<string> {
  if (!isAllowedToolName(toolName)) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
  }

  const command = ALLOWED_COMMANDS[toolName];

  return new Promise((resolve, reject) => {
    execFile(
      command.binary,
      command.args,
      {
        timeout: command.timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve((stdout ?? "").trimEnd());
          return;
        }

        const normalizedStderr = (stderr ?? "").trim();
        const err = error as NodeJS.ErrnoException & {
          code?: number | string;
          signal?: NodeJS.Signals;
          killed?: boolean;
        };

        if (err.code === "ENOENT") {
          reject(new McpError(ErrorCode.InternalError, "openclaw binary not found"));
          return;
        }

        if (err.killed || err.signal === "SIGTERM") {
          reject(new McpError(ErrorCode.InternalError, `Command timed out after ${command.timeoutMs}ms`));
          return;
        }

        const code = typeof err.code === "number" ? err.code : "unknown";
        const details = normalizedStderr ? `: ${normalizedStderr}` : "";
        reject(new McpError(ErrorCode.InternalError, `Command failed (exit ${code})${details}`));
      }
    );
  });
}

async function main(): Promise<void> {
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

    const output = await runAllowedCommand(toolName);

    return {
      content: [
        {
          type: "text",
          text: output || "(no output)"
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
