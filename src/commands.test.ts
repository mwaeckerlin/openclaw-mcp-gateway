import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_HTTP_GATEWAY_OPERATIONS,
  buildHttpInvokePayload,
  loadGatewayConfig,
  shapeHttpToolResponse,
  validateHttpToolArguments
} from "./commands.js";

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

test("openclaw_sessions_list uses fixed verified /tools/invoke payload mapping", () => {
  assert.deepEqual(ALLOWED_HTTP_GATEWAY_OPERATIONS.openclaw_sessions_list, {
    requestKind: "invoke",
    timeoutMs: 12_000,
    description: "List visible OpenClaw sessions with strict local filtering and bounded paging.",
    tool: "sessions_list",
    action: "json"
  });
});

test("openclaw_sessions_list validates bounded paging arguments", () => {
  const args = validateHttpToolArguments("openclaw_sessions_list", {
    kind: "main",
    activeMinutes: 60,
    limit: 10,
    offset: 2
  });
  assert.deepEqual(args, { kind: "main", activeMinutes: 60, limit: 10, offset: 2 });
});

test("openclaw_session_status requires exactly one explicit target", () => {
  assert.throws(
    () => validateHttpToolArguments("openclaw_session_status", { sessionKey: "main", sessionId: "abc" }),
    /exactly one of sessionKey or sessionId/i
  );
});

test("buildHttpInvokePayload maps validated arguments to /tools/invoke payload", () => {
  const payload = buildHttpInvokePayload("openclaw_sessions_list", { kind: "main", limit: 5 });
  assert.deepEqual(payload, {
    tool: "sessions_list",
    action: "json",
    args: { kind: "main", limit: 5 }
  });
});

test("shapeHttpToolResponse curates openclaw_gateway_status fields using allowlist", () => {
  const response = new Response(
    JSON.stringify({
      ok: true,
      status: "ready",
      uptimeMs: 1234,
      secret: "must-not-leak"
    }),
    { headers: { "content-type": "application/json" } }
  );
  const text = shapeHttpToolResponse("openclaw_gateway_status", response, `{
    "ok": true,
    "status": "ready",
    "uptimeMs": 1234,
    "secret": "must-not-leak"
  }`, {});
  const parsed = JSON.parse(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.uptimeMs, 1234);
  assert.equal(Object.hasOwn(parsed, "secret"), false);
});

test("loadGatewayConfig reads gateway URL and token from env vars", () => {
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

test("loadGatewayConfig defaults OPENCLAW_GATEWAY_URL to http://openclaw:18789", () => {
  withEnv(
    {
      OPENCLAW_GATEWAY_URL: undefined,
      OPENCLAW_GATEWAY_TOKEN: "token-value"
    },
    () => {
      const config = loadGatewayConfig();
      assert.equal(config.baseUrl, "http://openclaw:18789/");
      assert.equal(config.token, "token-value");
    }
  );
});
