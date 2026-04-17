import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const E2E_GATEWAY_URL = process.env.OPENCLAW_E2E_GATEWAY_URL?.trim();
const E2E_GATEWAY_TOKEN = process.env.OPENCLAW_E2E_GATEWAY_TOKEN?.trim();
const E2E_MCP_URL = process.env.OPENCLAW_E2E_MCP_URL?.trim() ?? "http://127.0.0.1:4000/mcp";
const shouldRunE2E = Boolean(E2E_GATEWAY_URL && E2E_GATEWAY_TOKEN && E2E_MCP_URL);

async function waitForGatewayReady(timeoutMs = 120_000): Promise<void> {
  if (!E2E_GATEWAY_URL || !E2E_GATEWAY_TOKEN) {
    throw new Error("Missing OPENCLAW_E2E_GATEWAY_URL or OPENCLAW_E2E_GATEWAY_TOKEN");
  }

  const deadline = Date.now() + timeoutMs;
  const endpoint = new URL("/healthz", E2E_GATEWAY_URL);

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        method: "GET"
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

async function waitForMcpGatewayReady(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const endpoint = new URL("/healthz", E2E_MCP_URL);

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        method: "GET"
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient startup/network errors while service is booting.
    }

    await new Promise((done) => setTimeout(done, 1_000));
  }

  throw new Error(`MCP gateway did not become ready within ${timeoutMs}ms`);
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
  "MCP HTTP gateway calls live OpenClaw Gateway for all tools and handles negative cases",
  {
    skip:
      shouldRunE2E ?
        false
      : "Set OPENCLAW_E2E_GATEWAY_URL, OPENCLAW_E2E_GATEWAY_TOKEN, and OPENCLAW_E2E_MCP_URL to run live Gateway integration tests"
  },
  async () => {
    await waitForMcpGatewayReady();
    if (!E2E_GATEWAY_TOKEN) {
      throw new Error("Missing OPENCLAW_E2E_GATEWAY_TOKEN");
    }

    const transport = new StreamableHTTPClientTransport(new URL(E2E_MCP_URL), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${E2E_GATEWAY_TOKEN}`
        }
      }
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
