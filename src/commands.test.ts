import assert from "node:assert/strict";
import test from "node:test";
import { loadGatewayConfig } from "./commands.js";

const ENV_KEYS = [
  "OPENCLAW_GATEWAY_URL",
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN_FILE",
  "OPENCLAW_GATEWAY_KEY",
  "OPENCLAW_GATEWAY_KEY_FILE",
  "OPENCLAW_STATUS_PAYLOAD_JSON",
  "OPENCLAW_LOGS_PAYLOAD_JSON"
] as const;

function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => void): void {
  const previous = new Map<(typeof ENV_KEYS)[number], string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("loadGatewayConfig accepts documented args payload field", () => {
  withEnv(
    {
      OPENCLAW_GATEWAY_URL: "https://gateway.example.invalid/",
      OPENCLAW_GATEWAY_TOKEN: "token-value",
      OPENCLAW_STATUS_PAYLOAD_JSON: '{"tool":"sessions_list","action":"json","args":{"limit":5}}'
    },
    () => {
      const config = loadGatewayConfig();
      assert.deepEqual(config.invokePayloads.openclaw_status, {
        tool: "sessions_list",
        action: "json",
        args: { limit: 5 }
      });
    }
  );
});

test("loadGatewayConfig rejects undocumented arguments payload field", () => {
  withEnv(
    {
      OPENCLAW_GATEWAY_URL: "https://gateway.example.invalid/",
      OPENCLAW_GATEWAY_TOKEN: "token-value",
      OPENCLAW_STATUS_PAYLOAD_JSON: '{"tool":"sessions_list","arguments":{"limit":5}}'
    },
    () => {
      assert.throws(
        () => loadGatewayConfig(),
        /unsupported field 'arguments' \(allowed: tool, action, args, sessionKey, dryRun\)/
      );
    }
  );
});
