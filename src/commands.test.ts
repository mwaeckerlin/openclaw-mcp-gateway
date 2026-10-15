import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ALLOWED_HTTP_GATEWAY_OPERATIONS,
  GATEWAY_TOKEN_SECRET_FILES,
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

// the secret files in a directory of the test, in the order of the server:
// the Docker default first, the path of the earlier README second
function withSecretFiles(contents: (string | undefined)[], run: (paths: string[]) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "gateway-token-"));
  try {
    const paths = contents.map((_, index) => join(dir, `secret-${index}`));
    contents.forEach((content, index) => {
      if (content !== undefined) writeFileSync(paths[index], content);
    });
    withEnv({ OPENCLAW_GATEWAY_TOKEN: undefined, OPENCLAW_GATEWAY_KEY: undefined }, () => run(paths));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the gateway token is looked up as Docker secret under /run/secrets, then under /run/secret", () => {
  assert.deepEqual(GATEWAY_TOKEN_SECRET_FILES, [
    "/run/secrets/openclaw_gateway_token",
    "/run/secret/openclaw_gateway_token"
  ]);
});

test("loadGatewayConfig reads the token from the Docker secret file", () => {
  withSecretFiles(["secret-token\n", undefined], (paths) => {
    assert.equal(loadGatewayConfig(paths).token, "secret-token");
  });
});

test("loadGatewayConfig reads the token from the second secret file when the first is missing", () => {
  withSecretFiles([undefined, "legacy-token\n"], (paths) => {
    assert.equal(loadGatewayConfig(paths).token, "legacy-token");
  });
});

test("loadGatewayConfig prefers the first secret file over the second", () => {
  withSecretFiles(["secret-token", "legacy-token"], (paths) => {
    assert.equal(loadGatewayConfig(paths).token, "secret-token");
  });
});

test("loadGatewayConfig without token names the variables and every secret file", () => {
  withSecretFiles([undefined, undefined], (paths) => {
    assert.throws(
      () => loadGatewayConfig(paths),
      (error: Error) =>
        error.message.includes("OPENCLAW_GATEWAY_TOKEN") && paths.every((path) => error.message.includes(path))
    );
  });
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
