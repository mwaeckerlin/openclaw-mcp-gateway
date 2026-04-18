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

test("runAllowedToolWithArguments returns formatted JSON for openclaw_status on 200", async () => {
  const body = { sessions: [{ id: "s1" }] };
  await withFetch(async () => makeJsonResponse(200, body), async () => {
    const result = await runAllowedToolWithArguments("openclaw_status", {}, TEST_CONFIG);
    assert.deepEqual(JSON.parse(result), body);
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
