import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { runAllowedToolWithArguments } from "./server.js";
import { __testing as rpcTesting } from "./gateway-rpc.js";

const TEST_CONFIG = {
  baseUrl: "http://gateway.example.invalid/",
  token: "test-token"
};

// ---------------------------------------------------------- FakeWebSocket

class FakeWebSocket extends EventEmitter {
  public readonly sent: string[] = [];
  public readyState = 1;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  emitOpen(): void {
    this.emit("open");
  }

  emitMessage(payload: unknown): void {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.emit("message", Buffer.from(text, "utf8"));
  }
}

function parseFrame(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------- fetch mock

async function withFetch(
  mock: typeof globalThis.fetch,
  run: () => Promise<void>
): Promise<void> {
  const saved = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = saved;
  }
}

function statusTextFor(status: number): string {
  const map: Record<number, string> = {
    200: "OK",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    501: "Not Implemented"
  };
  return map[status] ?? "Unknown";
}

function makeResponse(status: number, body: string, contentType = "text/plain"): Response {
  return new Response(body, {
    status,
    statusText: statusTextFor(status),
    headers: { "Content-Type": contentType }
  });
}

function makeJsonResponse(status: number, body: unknown): Response {
  return makeResponse(status, JSON.stringify(body), "application/json; charset=utf-8");
}

// ---------------------------------------------------------- HTTP tool tests

test("runAllowedToolWithArguments returns text body for openclaw_gateway_status on 200", async () => {
  await withFetch(async () => makeResponse(200, "ok"), async () => {
    const result = await runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG);
    assert.equal(result.trim(), "ok");
  });
});

test("runAllowedToolWithArguments returns (no output) for empty 200 body", async () => {
  await withFetch(async () => makeResponse(200, "   "), async () => {
    const result = await runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG);
    assert.equal(result, "(no output)");
  });
});

test("runAllowedToolWithArguments returns formatted JSON for openclaw_sessions_list on 200", async () => {
  const body = {
    ok: true,
    result: {
      details: {
        count: 2,
        sessions: [
          { sessionKey: "main", kind: "main", model: "gpt-5.4", filePath: "/hidden" },
          { sessionKey: "child", kind: "cron" }
        ]
      }
    }
  };
  await withFetch(async () => makeJsonResponse(200, body), async () => {
    const result = await runAllowedToolWithArguments("openclaw_sessions_list", {}, TEST_CONFIG);
    const parsed = JSON.parse(result);
    assert.equal(parsed.total, 2);
    assert.equal(parsed.returned, 2);
    assert.equal(parsed.sessions[0].sessionKey, "main");
    assert.equal(Object.hasOwn(parsed.sessions[0], "filePath"), false);
  });
});

test("runAllowedToolWithArguments validates openclaw_sessions_list pagination input", async () => {
  await assert.rejects(
    runAllowedToolWithArguments("openclaw_sessions_list", { limit: 0 }, TEST_CONFIG),
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InvalidParams &&
      /validation mismatch/i.test(error.message)
  );
});

test("runAllowedToolWithArguments returns curated openclaw_session_status fields", async () => {
  const body = {
    ok: true,
    result: {
      details: {
        sessionKey: "main",
        status: "active",
        model: "gpt-5.4",
        usage: { totalTokens: 100, internalDebug: "drop" },
        task: { runId: "run-1", status: "running", secretPath: "/tmp/secret" }
      }
    }
  };
  await withFetch(async () => makeJsonResponse(200, body), async () => {
    const result = await runAllowedToolWithArguments("openclaw_session_status", { sessionKey: "main" }, TEST_CONFIG);
    const parsed = JSON.parse(result);
    assert.equal(parsed.sessionKey, "main");
    assert.equal(parsed.usage.totalTokens, 100);
    assert.equal(Object.hasOwn(parsed.usage, "internalDebug"), false);
    assert.equal(Object.hasOwn(parsed.task, "secretPath"), false);
  });
});

test("runAllowedToolWithArguments throws capability McpError on gateway 404", async () => {
  await withFetch(async () => makeResponse(404, "not found"), async () => {
    await assert.rejects(
      runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InternalError &&
        /not supported/.test(error.message)
    );
  });
});

test("runAllowedToolWithArguments throws capability McpError on gateway 501", async () => {
  await withFetch(async () => makeResponse(501, "not implemented"), async () => {
    await assert.rejects(
      runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InternalError &&
        /not supported/.test(error.message)
    );
  });
});

test("runAllowedToolWithArguments throws McpError on gateway 500", async () => {
  await withFetch(async () => makeResponse(500, "server error"), async () => {
    await assert.rejects(
      runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InternalError &&
        /500/.test(error.message)
    );
  });
});

test("runAllowedToolWithArguments throws capability McpError when 200 body contains endpoint_disabled", async () => {
  const body = { error: { code: "endpoint_disabled", message: "endpoint_disabled" } };
  await withFetch(async () => makeJsonResponse(200, body), async () => {
    await assert.rejects(
      runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InternalError &&
        /not supported/.test(error.message)
    );
  });
});

test("runAllowedToolWithArguments throws timeout McpError on AbortError from fetch", async () => {
  await withFetch(async () => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  }, async () => {
    await assert.rejects(
      runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InternalError &&
        /timed out/.test(error.message)
    );
  });
});

test("runAllowedToolWithArguments throws McpError on fetch network failure", async () => {
  await withFetch(async () => {
    throw new Error("ECONNREFUSED");
  }, async () => {
    await assert.rejects(
      runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InternalError &&
        /ECONNREFUSED/.test(error.message)
    );
  });
});

test("runAllowedToolWithArguments throws InvalidParams McpError for unknown tool", async () => {
  await assert.rejects(
    runAllowedToolWithArguments("not_a_real_tool", {}, TEST_CONFIG),
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InvalidParams &&
      /unknown tool/i.test(error.message)
  );
});

test("runAllowedToolWithArguments rejects disabled tools with clear error", async () => {
  await assert.rejects(
    runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG, new Set(["openclaw_gateway_status"])),
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InvalidParams &&
      /disabled by DISABLE_TOOLS/i.test(error.message)
  );
});

test("runAllowedToolWithArguments includes error details from JSON gateway error body", async () => {
  const body = { error: { code: "RATE_LIMITED", message: "too many requests" } };
  await withFetch(async () => makeJsonResponse(429, body), async () => {
    await assert.rejects(
      runAllowedToolWithArguments("openclaw_gateway_status", {}, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InternalError &&
        /RATE_LIMITED|too many/.test(error.message)
    );
  });
});

test("runAllowedToolWithArguments dispatches openclaw_status via status RPC family", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_status", { type: "default" }, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  assert.equal(methodFrame.method, "status");
  ws.emitMessage({
    type: "res",
    id: methodFrame.id,
    ok: true,
    payload: { runtimeVersion: "2026.4.15", sessions: { total: 0 } }
  });

  const parsed = JSON.parse(await promise);
  assert.equal(parsed.type, "default");
  assert.equal(parsed.status.runtimeVersion, "2026.4.15");
  rpcTesting.resetWebSocketFactory();
});

test("runAllowedToolWithArguments rejects openclaw_logs follow mode", async () => {
  await assert.rejects(
    runAllowedToolWithArguments("openclaw_logs", { follow: true }, TEST_CONFIG),
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InvalidParams &&
      /follow mode is not supported/i.test(error.message)
  );
});

test("runAllowedToolWithArguments blocks sensitive config_get path", async () => {
  await assert.rejects(
      runAllowedToolWithArguments("openclaw_config_get", { path: "channels.telegram.token" }, TEST_CONFIG),
      (error: unknown) =>
        error instanceof McpError &&
        error.code === ErrorCode.InvalidParams &&
        /secret-bearing config paths are blocked/i.test(error.message)
  );
});

// ---------------------------------------------------------- skills RPC tool tests

test("runAllowedToolWithArguments dispatches openclaw_skills_list via skills.status RPC", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_skills_list", { limit: 1 }, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  assert.equal(methodFrame.method, "skills.status");
  ws.emitMessage({
    type: "res",
    id: methodFrame.id,
    ok: true,
    payload: {
      skills: [
        { name: "weather", skillKey: "weather", description: "Weather", eligible: true, filePath: "/secret" }
      ]
    }
  });

  const result = JSON.parse(await promise);
  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.skills[0].name, "weather");
  assert.equal(Object.hasOwn(result.skills[0], "filePath"), false);
  rpcTesting.resetWebSocketFactory();
});

test("runAllowedToolWithArguments returns selected skill detail", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_skills_detail", { skillKey: "weather" }, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  ws.emitMessage({
    type: "res",
    id: methodFrame.id,
    ok: true,
    payload: {
      skills: [
        { name: "calendar", skillKey: "calendar", description: "Calendar" },
        { name: "weather", skillKey: "weather", description: "Weather" }
      ]
    }
  });

  const result = JSON.parse(await promise);
  assert.equal(methodFrame.method, "skills.status");
  assert.equal(result.skillKey, "weather");
  rpcTesting.resetWebSocketFactory();
});

// ---------------------------------------------------------- cron RPC tool tests

test("runAllowedToolWithArguments dispatches cron.status via RPC and returns payload", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_cron_status", {}, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  assert.equal(methodFrame.method, "cron.status");
  ws.emitMessage({
    type: "res",
    id: methodFrame.id,
    ok: true,
    payload: { enabled: true, jobCount: 3 }
  });

  const result = await promise;
  assert.ok(result.includes("enabled"));
  rpcTesting.resetWebSocketFactory();
});

test("runAllowedToolWithArguments dispatches cron.list via RPC and returns job list", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_cron_list", { limit: 5 }, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  assert.equal(methodFrame.method, "cron.list");
  assert.deepEqual((methodFrame.params as Record<string, unknown>).limit, 5);
  ws.emitMessage({
    type: "res",
    id: methodFrame.id,
    ok: true,
    payload: { jobs: [], total: 0 }
  });

  const result = await promise;
  assert.ok(result.includes("jobs"));
  rpcTesting.resetWebSocketFactory();
});

test("runAllowedToolWithArguments throws InvalidParams McpError on cron validation failure", async () => {
  await assert.rejects(
    runAllowedToolWithArguments("openclaw_cron_add", { name: "" }, TEST_CONFIG),
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InvalidParams &&
      /validation mismatch/i.test(error.message)
  );
});

test("runAllowedToolWithArguments throws McpError with auth on cron RPC auth failure", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_cron_list", {}, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({
    type: "res",
    id: connectFrame.id,
    ok: false,
    error: { code: "auth_failed", message: "unauthorized token" }
  });

  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InternalError &&
      /auth/i.test(error.message)
  );
  rpcTesting.resetWebSocketFactory();
});

test("runAllowedToolWithArguments throws McpError with capability on cron RPC not-supported response", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_cron_status", {}, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  ws.emitMessage({
    type: "res",
    id: methodFrame.id,
    ok: false,
    error: { code: "method_not_found", message: "not supported" }
  });

  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InternalError &&
      /not supported.*capability/i.test(error.message)
  );
  rpcTesting.resetWebSocketFactory();
});

test("runAllowedToolWithArguments throws McpError with protocol on cron RPC generic failure", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments("openclaw_cron_remove", { id: "job-1" }, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  assert.equal(methodFrame.method, "cron.remove");
  ws.emitMessage({
    type: "res",
    id: methodFrame.id,
    ok: false,
    error: { code: "not_found", message: "job not found" }
  });

  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof McpError &&
      error.code === ErrorCode.InternalError
  );
  rpcTesting.resetWebSocketFactory();
});

test("runAllowedToolWithArguments passes correct params to cron.update RPC call", async () => {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments(
    "openclaw_cron_update",
    { id: "job-99", patch: { enabled: false } },
    TEST_CONFIG
  );

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  assert.equal(methodFrame.method, "cron.update");
  const params = methodFrame.params as Record<string, unknown>;
  assert.equal(params.id, "job-99");
  assert.deepEqual(params.patch, { enabled: false });

  ws.emitMessage({ type: "res", id: methodFrame.id, ok: true, payload: { ok: true } });
  await promise;
  rpcTesting.resetWebSocketFactory();
});

// ---------------------------------------------------------- helpers for per-tool RPC dispatch tests

// Drives a single-RPC-call tool through the full FakeWebSocket handshake.
// Returns { parsed, methodFrame } where parsed is the JSON-decoded result.
async function driveSimpleRpc(
  toolName: string,
  toolArgs: Record<string, unknown>,
  expectedMethod: string,
  responsePayload: unknown
): Promise<{ parsed: Record<string, unknown>; methodFrame: Record<string, unknown> }> {
  const ws = new FakeWebSocket();
  rpcTesting.setWebSocketFactory(() => ws);

  const promise = runAllowedToolWithArguments(toolName, toolArgs, TEST_CONFIG);

  ws.emitOpen();
  ws.emitMessage({ type: "event", event: "connect.challenge" });
  const connectFrame = parseFrame(ws.sent[0]!);
  ws.emitMessage({ type: "res", id: connectFrame.id, ok: true, payload: {} });
  const methodFrame = parseFrame(ws.sent[1]!);
  assert.equal(methodFrame.method, expectedMethod, `${toolName} should call ${expectedMethod}`);

  ws.emitMessage({ type: "res", id: methodFrame.id, ok: true, payload: responsePayload });

  const result = await promise;
  rpcTesting.resetWebSocketFactory();
  return { parsed: JSON.parse(result) as Record<string, unknown>, methodFrame };
}

// ---------------------------------------------------------- new readonly RPC tool dispatch tests

test("openclaw_health dispatches to health RPC with probe param", async () => {
  const { parsed, methodFrame } = await driveSimpleRpc(
    "openclaw_health", { verbose: true },
    "health",
    { ok: true, durationMs: 12, version: "1.0" }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.probe, true, "verbose=true should send probe=true");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.durationMs, 12);
});

test("openclaw_health dispatches to health RPC without probe when verbose is false", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_health", {},
    "health",
    { ok: true, durationMs: 5 }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.probe, false, "verbose omitted should send probe=false");
});

test("openclaw_logs dispatches to logs.tail RPC", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_logs", { limit: 50 },
    "logs.tail",
    { lines: ["line1", "line2"] }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.limit, 50);
  assert.ok(Array.isArray(parsed.lines));
});

test("openclaw_gateway_usage_cost dispatches to usage.cost with days param", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_gateway_usage_cost", { days: 7 },
    "usage.cost",
    { totalCost: 0.5, sessions: 10 }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.days, 7);
  assert.equal(parsed.totalCost, 0.5);
});

test("openclaw_gateway_usage_cost uses default 30 days when not specified", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_gateway_usage_cost", {},
    "usage.cost",
    { totalCost: 0 }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.days, 30);
});

test("openclaw_channels_status dispatches to channels.status with probe param", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_channels_status", { probe: true },
    "channels.status",
    { channels: [] }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.probe, true);
});

test("openclaw_channels_list dispatches to config.get and extracts channels", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_channels_list", {},
    "config.get",
    { parsed: { channels: { telegram: { botUsername: "mybot" } } } }
  );
  assert.equal(parsed.total, 1);
  assert.ok("telegram" in (parsed.channels as Record<string, unknown>));
});

test("openclaw_channels_logs dispatches to logs.tail and filters by channel", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_channels_logs", { channel: "telegram", lines: 5 },
    "logs.tail",
    { lines: [
      "2026-04-01 gateway/channels/telegram: msg1",
      "2026-04-01 gateway/channels/discord: msg2",
      "2026-04-01 gateway/channels/telegram: msg3"
    ]}
  );
  assert.ok((methodFrame.params as Record<string, unknown>).limit !== undefined);
  assert.equal(parsed.channel, "telegram");
  // Only telegram lines should be in the result
  const lines = parsed.lines as string[];
  assert.ok(lines.every((l) => l.includes("telegram")));
  assert.equal(lines.length, 2);
});

test("openclaw_plugins_list dispatches to plugins.list with enabledOnly param", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_plugins_list", { enabledOnly: true },
    "plugins.list",
    { plugins: [{ id: "p1", enabled: true }] }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.enabledOnly, true);
});

test("openclaw_plugins_inspect dispatches to plugins.inspect with id param", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_plugins_inspect", { id: "my-plugin" },
    "plugins.inspect",
    { id: "my-plugin", version: "1.0", enabled: true }
  );
  assert.equal((methodFrame.params as Record<string, unknown>).id, "my-plugin");
  assert.equal(parsed.id, "my-plugin");
});

test("openclaw_plugins_doctor dispatches to plugins.doctor", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_plugins_doctor", {},
    "plugins.doctor",
    { ok: true, issues: [] }
  );
  assert.equal(methodFrame.method, "plugins.doctor");
});

test("openclaw_models_status dispatches to models.authStatus", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_models_status", { probe: false },
    "models.authStatus",
    { providers: [{ name: "openai", status: "ok" }] }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.refresh, false);
  assert.ok(parsed.status !== undefined);
});

test("openclaw_models_status check=true adds check result", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_models_status", { check: true },
    "models.authStatus",
    { providers: [{ name: "openai", status: "ok" }, { name: "bad", status: "missing" }] }
  );
  const check = parsed.check as Record<string, unknown>;
  assert.equal(check.ok, false);
  assert.equal(check.failingProviders, 1);
});

test("openclaw_models_list dispatches to models.list", async () => {
  await driveSimpleRpc("openclaw_models_list", {}, "models.list", { models: ["gpt-5.4"] });
});

test("openclaw_models_aliases_list dispatches to config.get and returns aliases", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_models_aliases_list", {},
    "config.get",
    { parsed: { models: { aliases: { fast: "gpt-5-mini" }, fallbacks: {} } } }
  );
  assert.deepEqual(parsed, { fast: "gpt-5-mini" });
});

test("openclaw_models_fallbacks_list dispatches to config.get and returns fallbacks", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_models_fallbacks_list", {},
    "config.get",
    { parsed: { models: { fallbacks: ["gpt-5.4", "gpt-5-mini"] } } }
  );
  assert.deepEqual(parsed, ["gpt-5.4", "gpt-5-mini"]);
});

test("openclaw_config_get dispatches to config.get and extracts path value", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_config_get", { path: "server.port" },
    "config.get",
    { parsed: { server: { port: 18789 } }, valid: true }
  );
  assert.equal(methodFrame.method, "config.get");
  assert.equal(parsed.path, "server.port");
  assert.equal(parsed.exists, true);
  assert.equal(parsed.value, 18789);
});

test("openclaw_config_get returns exists=false for missing path", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_config_get", { path: "nonexistent.key" },
    "config.get",
    { parsed: { server: {} }, valid: true }
  );
  assert.equal(parsed.exists, false);
  assert.equal(parsed.value, null);
});

test("openclaw_config_file dispatches to config.get and returns path/exists", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_config_file", {},
    "config.get",
    { path: "/etc/openclaw/config.yml", exists: true }
  );
  assert.equal(parsed.path, "/etc/openclaw/config.yml");
  assert.equal(parsed.exists, true);
});

test("openclaw_config_validate dispatches to config.get and returns valid/issues/warnings", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_config_validate", {},
    "config.get",
    { valid: true, issues: [], warnings: ["deprecated field x"] }
  );
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.warnings, ["deprecated field x"]);
});

test("openclaw_config_schema dispatches to config.schema", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_config_schema", {},
    "config.schema",
    { schema: { type: "object" } }
  );
  assert.equal(methodFrame.method, "config.schema");
});

test("openclaw_config_schema_lookup dispatches to config.schema.lookup with path", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_config_schema_lookup", { path: "server.port" },
    "config.schema.lookup",
    { path: "server.port", type: "integer", description: "Port to listen on" }
  );
  assert.equal((methodFrame.params as Record<string, unknown>).path, "server.port");
  assert.equal(parsed.type, "integer");
});

test("openclaw_security_audit dispatches to security.audit with deep param", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_security_audit", { deep: true },
    "security.audit",
    { ok: true, findings: [] }
  );
  assert.equal((methodFrame.params as Record<string, unknown>).deep, true);
});

test("openclaw_secrets_audit dispatches to secrets.audit with check + allowExec params", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_secrets_audit", { check: true, allowExec: false },
    "secrets.audit",
    { ok: true, residues: [] }
  );
  const mp = methodFrame.params as Record<string, unknown>;
  assert.equal(mp.check, true);
  assert.equal(mp.allowExec, false);
});

test("openclaw_secrets_audit redacts sensitive values in response", async () => {
  const { parsed } = await driveSimpleRpc(
    "openclaw_secrets_audit", {},
    "secrets.audit",
    { ok: true, token: "sk-real-secret-token", residues: [] }
  );
  assert.equal(parsed.token, "[REDACTED]");
});

test("openclaw_approvals_get target=local returns local-only note without RPC", async () => {
  // No WebSocket interaction expected for target=local (returns static note)
  const result = await runAllowedToolWithArguments("openclaw_approvals_get", { target: "local" }, TEST_CONFIG);
  const parsed = JSON.parse(result) as Record<string, unknown>;
  assert.equal(parsed.target, "local");
  assert.ok(typeof parsed.note === "string");
});

test("openclaw_approvals_get target=gateway dispatches to exec.approvals.get", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_approvals_get", { target: "gateway" },
    "exec.approvals.get",
    { policy: "strict" }
  );
  assert.equal(methodFrame.method, "exec.approvals.get");
});

test("openclaw_approvals_get target=node dispatches to exec.approvals.node.get with nodeId", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_approvals_get", { target: "node", node: "node-abc" },
    "exec.approvals.node.get",
    { nodeId: "node-abc", policy: "allow" }
  );
  assert.equal((methodFrame.params as Record<string, unknown>).nodeId, "node-abc");
});

test("openclaw_devices_list dispatches to device.pair.list and redacts tokens", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_devices_list", {},
    "device.pair.list",
    { paired: [{ deviceId: "d1", token: "secret-tok" }], pending: [] }
  );
  assert.equal(methodFrame.method, "device.pair.list");
  const paired = (parsed.paired as Record<string, unknown>[])[0];
  assert.equal(paired.token, "[REDACTED]");
});

test("openclaw_nodes_pending dispatches to node.pair.list and returns pending only", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_nodes_pending", {},
    "node.pair.list",
    { pending: [{ nodeId: "n1", requestedAt: 123 }], paired: [] }
  );
  assert.equal(methodFrame.method, "node.pair.list");
  assert.ok(Array.isArray(parsed.pending));
  assert.equal((parsed.pending as unknown[]).length, 1);
  // paired should not appear in nodes_pending response
  assert.ok(!("paired" in parsed));
});

test("openclaw_skills_check dispatches to skills.status and counts eligible", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_skills_check", {},
    "skills.status",
    { skills: [
      { skillKey: "weather", eligible: true },
      { skillKey: "calendar", eligible: false }
    ]}
  );
  assert.equal(methodFrame.method, "skills.status");
  assert.equal(parsed.ready, 1);
  assert.equal(parsed.total, 2);
});

test("openclaw_sandbox_explain dispatches to sandbox.explain with sessionKey", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_sandbox_explain", { sessionKey: "main" },
    "sandbox.explain",
    { policy: "isolated", sessionKey: "main" }
  );
  assert.equal((methodFrame.params as Record<string, unknown>).sessionKey, "main");
});

test("openclaw_sandbox_list dispatches to sandbox.list with browser param", async () => {
  const { methodFrame } = await driveSimpleRpc(
    "openclaw_sandbox_list", { browserOnly: true },
    "sandbox.list",
    { runtimes: [{ name: "chromium" }] }
  );
  assert.equal((methodFrame.params as Record<string, unknown>).browser, true);
});

test("openclaw_system_presence dispatches to system-presence", async () => {
  const { methodFrame, parsed } = await driveSimpleRpc(
    "openclaw_system_presence", {},
    "system-presence",
    [{ type: "gateway", id: "gw1" }]
  );
  assert.equal(methodFrame.method, "system-presence");
  assert.ok(Array.isArray(parsed) || typeof parsed === "object");
});
