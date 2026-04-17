import assert from "node:assert/strict";
import test from "node:test";
import { loadGatewayConfig } from "./commands.js";
import { runAllowedTool } from "./server.js";

const E2E_GATEWAY_URL = process.env.OPENCLAW_E2E_GATEWAY_URL?.trim();
const E2E_GATEWAY_TOKEN = process.env.OPENCLAW_E2E_GATEWAY_TOKEN?.trim();
const E2E_STATUS_PAYLOAD_JSON =
  process.env.OPENCLAW_E2E_STATUS_PAYLOAD_JSON?.trim() ??
  '{"tool":"sessions_list","action":"json","args":{}}';

const shouldRunE2E = Boolean(E2E_GATEWAY_URL && E2E_GATEWAY_TOKEN);

function withGatewayEnv(run: () => Promise<void>): Promise<void> {
  const previous = {
    OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL,
    OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN,
    OPENCLAW_STATUS_PAYLOAD_JSON: process.env.OPENCLAW_STATUS_PAYLOAD_JSON
  };

  process.env.OPENCLAW_GATEWAY_URL = E2E_GATEWAY_URL;
  process.env.OPENCLAW_GATEWAY_TOKEN = E2E_GATEWAY_TOKEN;
  process.env.OPENCLAW_STATUS_PAYLOAD_JSON = E2E_STATUS_PAYLOAD_JSON;

  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test(
  "runAllowedTool(openclaw_status) works against live OpenClaw Gateway",
  {
    skip:
      shouldRunE2E ?
        false
      : "Set OPENCLAW_E2E_GATEWAY_URL and OPENCLAW_E2E_GATEWAY_TOKEN to run live Gateway integration tests"
  },
  async () => {
    await withGatewayEnv(async () => {
      const config = loadGatewayConfig();
      const output = await runAllowedTool("openclaw_status", config);
      assert.equal(typeof output, "string");
      assert.ok(output.trim().length > 0);
    });
  }
);
