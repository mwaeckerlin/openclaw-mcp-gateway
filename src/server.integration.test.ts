import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const E2E_GATEWAY_URL = process.env.OPENCLAW_E2E_GATEWAY_URL?.trim();
const E2E_GATEWAY_TOKEN = process.env.OPENCLAW_E2E_GATEWAY_TOKEN?.trim();
const E2E_STATUS_PAYLOAD_JSON = '{"tool":"sessions_list","action":"json","args":{}}';

const shouldRunE2E = Boolean(E2E_GATEWAY_URL && E2E_GATEWAY_TOKEN);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRYPOINT = resolve(REPO_ROOT, "src/server.ts");

function createTestEnvironment(): Record<string, string> {
  if (!E2E_GATEWAY_URL || !E2E_GATEWAY_TOKEN) {
    throw new Error("Missing OPENCLAW_E2E_GATEWAY_URL or OPENCLAW_E2E_GATEWAY_TOKEN");
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.OPENCLAW_GATEWAY_URL = E2E_GATEWAY_URL;
  env.OPENCLAW_GATEWAY_TOKEN = E2E_GATEWAY_TOKEN;
  return env;
}

async function waitForGatewayReady(timeoutMs = 120_000): Promise<void> {
  if (!E2E_GATEWAY_URL || !E2E_GATEWAY_TOKEN) {
    throw new Error("Missing OPENCLAW_E2E_GATEWAY_URL or OPENCLAW_E2E_GATEWAY_TOKEN");
  }

  const deadline = Date.now() + timeoutMs;
  const endpoint = new URL("/tools/invoke", E2E_GATEWAY_URL);

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${E2E_GATEWAY_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: E2E_STATUS_PAYLOAD_JSON
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient startup/network errors while gateway is booting.
    }

    await new Promise((done) => setTimeout(done, 1_000));
  }

  throw new Error(`Gateway did not become ready within ${timeoutMs}ms`);
}

function isTextContent(entry: unknown): entry is { type: "text"; text: string } {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const typedEntry = entry as { type?: unknown; text?: unknown };
  return typedEntry.type === "text" && typeof typedEntry.text === "string";
}

function hasIsErrorTrue(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("isError" in value)) {
    return false;
  }
  return value.isError === true;
}

test(
  "MCP stdio server calls live OpenClaw Gateway for all tools and handles negative cases",
  {
    skip:
      shouldRunE2E ?
        false
      : "Set OPENCLAW_E2E_GATEWAY_URL and OPENCLAW_E2E_GATEWAY_TOKEN to run live Gateway integration tests"
  },
  async () => {
    await waitForGatewayReady();

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", SERVER_ENTRYPOINT],
      cwd: REPO_ROOT,
      env: createTestEnvironment()
    });
    const client = new Client({
      name: "openclaw-mcp-gateway-e2e-test",
      version: "1.0.0"
    });

    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const toolNames = new Set(tools.tools.map((tool) => tool.name));
      assert.ok(toolNames.has("openclaw_status"));
      assert.ok(toolNames.has("openclaw_gateway_status"));

      const statusResult = await client.callTool({
        name: "openclaw_status"
      });
      assert.ok(Array.isArray(statusResult.content));
      const statusTextOutput = statusResult.content.find(isTextContent);
      assert.ok(statusTextOutput);
      assert.ok(statusTextOutput.text.trim().length > 0);

      let gatewayStatusHandled = false;
      try {
        const gatewayStatusResult = await client.callTool({
          name: "openclaw_gateway_status"
        });
        assert.ok(Array.isArray(gatewayStatusResult.content));
        const gatewayStatusTextOutput = gatewayStatusResult.content.find(isTextContent);
        assert.ok(gatewayStatusTextOutput);
        assert.ok(gatewayStatusTextOutput.text.trim().length > 0);
        gatewayStatusHandled = true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /not supported/i);
        gatewayStatusHandled = true;
      }
      assert.equal(gatewayStatusHandled, true);

      try {
        const unknownToolResult = await client.callTool({
          name: "not_allowed_tool_name"
        });
        assert.equal(hasIsErrorTrue(unknownToolResult), true);
        assert.match(JSON.stringify(unknownToolResult), /unknown tool|not found|invalid/i);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /unknown tool|not found|invalid/i);
      }
    } finally {
      await client.close();
    }
  }
);
