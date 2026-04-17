import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const E2E_GATEWAY_URL = process.env.OPENCLAW_E2E_GATEWAY_URL?.trim();
const E2E_GATEWAY_TOKEN = process.env.OPENCLAW_E2E_GATEWAY_TOKEN?.trim();
const E2E_STATUS_PAYLOAD_JSON =
  process.env.OPENCLAW_E2E_STATUS_PAYLOAD_JSON?.trim() ??
  '{"tool":"sessions_list","action":"json","args":{}}';

const shouldRunE2E = Boolean(E2E_GATEWAY_URL && E2E_GATEWAY_TOKEN);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function createTestEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.OPENCLAW_GATEWAY_URL = E2E_GATEWAY_URL!;
  env.OPENCLAW_GATEWAY_TOKEN = E2E_GATEWAY_TOKEN!;
  env.OPENCLAW_STATUS_PAYLOAD_JSON = E2E_STATUS_PAYLOAD_JSON;
  return env;
}

test(
  "MCP stdio server calls live OpenClaw Gateway for openclaw_status",
  {
    skip:
      shouldRunE2E ?
        false
      : "Set OPENCLAW_E2E_GATEWAY_URL and OPENCLAW_E2E_GATEWAY_TOKEN to run live Gateway integration tests"
  },
  async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/server.ts"],
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
      assert.ok(tools.tools.some((tool) => tool.name === "openclaw_status"));

      const result = await client.callTool({
        name: "openclaw_status"
      });

      assert.ok(Array.isArray(result.content));
      const textOutput = result.content.find((entry) => entry.type === "text");
      assert.ok(textOutput && typeof textOutput.text === "string");
      assert.ok(textOutput.text.trim().length > 0);
    } finally {
      await client.close();
    }
  }
);
