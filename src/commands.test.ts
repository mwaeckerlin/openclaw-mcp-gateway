import assert from "node:assert/strict";
import test from "node:test";
import { ALLOWED_HTTP_GATEWAY_OPERATIONS, loadGatewayConfig } from "./commands.js";

const ENV_KEYS = [
  "OPENCLAW_GATEWAY_URL",
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_KEY"
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

test("openclaw_status uses fixed verified /tools/invoke payload mapping", () => {
  assert.deepEqual(ALLOWED_HTTP_GATEWAY_OPERATIONS.openclaw_status, {
    requestKind: "invoke",
    timeoutMs: 12_000,
    description: "Return overall OpenClaw status from the Gateway API.",
    payload: {
      tool: "sessions_list",
      action: "json",
      args: {}
    }
  });
});

test("loadGatewayConfig reads required gateway URL and token without payload env vars", () => {
  withEnv(
    {
      OPENCLAW_GATEWAY_URL: "https://gateway.example.invalid/",
      OPENCLAW_GATEWAY_TOKEN: "token-value"
    },
    () => {
      const config = loadGatewayConfig();
      assert.equal(config.baseUrl, "https://gateway.example.invalid/");
      assert.equal(config.token, "token-value");
    }
  );
});
