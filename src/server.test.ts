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
